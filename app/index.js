import express from "express";
import cookieParser from "cookie-parser"
import path from "path"
import morgan from "morgan"
import cors from "cors"
import dotenv from "dotenv"
import { Server } from "socket.io"
import { createServer } from "node:http";
import db from "./database.js";
import {utilsAuthentication as authWebSocket} from "./controllers/authWebSocket.js";
import { utilsSockets } from "../utils/sockets.js";
import {utilsAuthentication as auth} from "./controllers/auth.js";
dotenv.config()

const __dirname = process.cwd()
const app = express();
const port = process.env.PORT?? 4003;
//Creamos el servidor http
const server = createServer(app);
let frontend_origin= process.env.FRONTEND_ORIGIN?? "http://localhost:5173";
//Creamos el servidor socket.io
const io = new Server(server, {
    maxDisconnectionDelay: 5000,
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
    },
    cors: {
        origin: [frontend_origin, "https://carpooling-webapp-ten.vercel.app"],
        methods: ["GET", "POST"],
    },
});
app.use(cors({
    origin: [frontend_origin ], // Cambia esto a la URL de tu frontend
    methods: "GET,POST,PUT,PATCH,DELETE",
    credentials: true // Permite el uso de cookies
}))

//BASE DE DATOS

await db.execute(`
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message TEXT NOT NULL,
        send_by TEXT NOT NULL,
        send_to TEXT NOT NULL,
        readed TINYINT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`)

try { await db.execute("ALTER TABLE messages ADD COLUMN send_by TEXT"); } catch {}
try { await db.execute("ALTER TABLE messages ADD COLUMN send_to TEXT"); } catch {}
try { await db.execute("ALTER TABLE messages ADD COLUMN readed TINYINT DEFAULT 0"); } catch {}

try { await db.execute("CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages (send_to, send_by, id)"); } catch {}
try { await db.execute("CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages (send_to, readed, id)"); } catch {}
await db.execute(`
CREATE TABLE IF NOT EXISTS pre_register (city TEXT NOT NULL, email TEXT NOT NULL PRIMARY KEY);
`)


//MIDDLEWARES
app.disable("x-powered-by") // Desactiva el encabezado x-powered-by
app.set("port",port)

server.listen(port, () => {
    console.log(`Listening on port ${app.get("port")}`);
});

app.use(express.static(__dirname + "\\public"))
app.use(morgan("dev")) // Middleware para registrar las peticiones HTTP en la consola
app.use(express.json())
app.use(cookieParser())
app.use(cors({
    origin: ["http://localhost:5173", "http://192.168.0.36:5173"], // Cambia esto a la URL de tu frontend
    methods: "GET,POST,PUT,PATCH,DELETE",
    credentials: true // Permite el uso de cookies
}))

io.on("connection", async (socket) => {
    console.log("Un cliente se ha conectado");
    if (socket.handshake.auth?.username) {
        socket.join(`user:${socket.handshake.auth.username}`);
        try {
            const unreadLastBySender = await db.execute({
                sql: `
                    SELECT m.id, m.send_by, m.send_to, m.message, m.created_at
                    FROM messages m
                    JOIN (
                        SELECT send_by, MAX(id) AS max_id
                        FROM messages
                        WHERE send_to = ? AND readed = 0
                        GROUP BY send_by
                    ) t ON m.id = t.max_id
                    ORDER BY m.id DESC
                    LIMIT 20
                `,
                args: [socket.handshake.auth.username]
            });

            unreadLastBySender.rows.forEach((row) => {
                socket.emit('receiveNotification', {
                    sender: row.send_by,
                    chatId: row.send_by,
                    content: row.message,
                    pending: true,
                    serverOffset: row.id
                });
            })
        } catch (error) {
            console.log(error)
        }
    }
    socket.on('setUserId', (username) => {
        if (username) socket.join(`user:${username}`);
    });
    socket.on("disconnect", () => {
        console.log("Un cliente se ha desconectado");
    });
    

    socket.on("join_chat", async (data) => {
        let nameRoom = utilsSockets.createNameChatRooms(socket.handshake.auth.username, data);
        socket.join(nameRoom);
        console.log("El usuario " + socket.handshake.auth.username + " se ha unido al chat con el id " + socket.id);
        console.log(`para hablar con ${data}`)

        socket.emit("join_chat", nameRoom);

                try {
        const serverOffset = Number(socket.handshake.auth?.serverOffset ?? 0);
        const sqlBase = "((send_to = ? AND send_by = ?) OR (send_to = ? AND send_by = ?))";
        const argsBase = [data, socket.handshake.auth.username, socket.handshake.auth.username, data];

        const totalMessages = serverOffset > 0
            ? await db.execute({
                sql: `SELECT id, message, send_to, send_by, created_at FROM messages WHERE id > ? AND ${sqlBase} ORDER BY id ASC`,
                args: [serverOffset, ...argsBase]
            })
            : await db.execute({
                sql: `SELECT id, message, send_to, send_by, created_at FROM messages WHERE ${sqlBase} ORDER BY id DESC LIMIT 50`,
                args: argsBase
            })

        const arrayTotal = [...totalMessages.rows];
        if (serverOffset === 0) arrayTotal.reverse();
        //Ordenar por la hora de creacion
        arrayTotal.forEach((row) => {
        let sendData = {
            message: row.message,
            serverOffset: row.id,
            send_to: row.send_to,
            send_by: row.send_by,
            created_at: row.created_at
        }
                socket.emit("chat_message", sendData);
            })

        await db.execute({
            sql: "UPDATE messages SET readed = 1 WHERE send_to = ? AND send_by = ? AND readed = 0",
            args: [socket.handshake.auth.username, data]
        })
            
        } catch (error) {
            console.log(error)
        }
    })

    // socket.on("leave_chat", async (data) => {
    //     let nameRoom = utilsSockets.createNameChatRooms(socket.handshake.auth.username, data);
    //     socket.leave(nameRoom);
    //     console.log(socket.rooms);
    //     console.log("El usuario " + socket.handshake.auth.username + " se ha ido del chat con el id " + socket.id);
    //     console.log(`para hablar con ${data}`)
    //     socket.emit("leave_chat", "Hasta luego");
    // })

    socket.on("chat_message", async (data, ack) => {
    let result;
    const send_by = socket.handshake.auth.username;
    let message = data.message;
    let send_to = data.send_to;
    try {
        result = await db.execute({
            sql: "INSERT INTO messages (message, send_by, send_to, readed, created_at) VALUES (?, ?, ?, 0, ?)",
            args: [message, send_by, send_to, new Date().toISOString()]
        })
    } catch (error) {
        console.log(error)
        if (typeof ack === "function") {
            ack({ status: "error", message: "No se pudo guardar el mensaje" });
        }
        socket.emit("chat_error", { message: "No se pudo guardar el mensaje" });
        return
    }
    let sendData = {
        message: message,
        serverOffset: result.lastInsertRowid.toString(),
        send_to: send_to,
        send_by: send_by,
        created_at: new Date().toISOString()
    }

    const room = utilsSockets.createNameChatRooms(send_by, send_to);
    socket.join(room);

    socket.emit("chat_message", sendData);
    socket.to(room).emit("chat_message", sendData);

    io.to(`user:${send_to}`).emit('receiveNotification', {
        sender: send_by,
        chatId: send_to,
        content: message
    });

    if (typeof ack === "function") {
        ack({ status: "ok", serverOffset: sendData.serverOffset });
    }
    
    });


    if(!socket.recovered || socket.handshake.auth.serverOffset === 0){
        // console.log("Recovering messages");
        // try {
        // const result = await db.execute({
        //     sql: "SELECT * FROM messages WHERE id > ?", //agregar la seccion para recuperar mensajes que me han enviado.
        //     args: [socket.handshake.auth.serverOffset]
        // })
        //     result.rows.forEach((row) => {
        // let sendData = {
        //     message: row.message,
        //     serverOffset: row.id,
        //     send_to: row.send_to,
        //     send_by: row.send_by
        // }
        //         socket.emit("chat_message", sendData);
        //     })
            
        // } catch (error) {
        //     console.log(error)
        // }
    }

});

app.get("/api/chats", auth.authenticate, async (req, res) => {
    try {
        //Query para recuperar el nombre de todos los usuarios con los que he chateado UNICOS y el ultimo mensaje enviado
        const result = await db.execute({
            sql: "SELECT DISTINCT send_by, send_to FROM messages WHERE send_to = ? OR send_by = ? ORDER BY created_at DESC",
            args: [req.user.username, req.user.username]
        })


        const arrayTotal = [...result.rows];
        for(let i = 0; i < arrayTotal.length; i++){
            const result2 = await db.execute({
                sql: "SELECT message, created_at FROM messages WHERE send_to = ? AND send_by = ? ORDER BY created_at DESC LIMIT 1",
                args: [arrayTotal[i].send_to, arrayTotal[i].send_by]
            });
            let lastMessage = {
                message: result2.rows[0]?.message,
                send_by: arrayTotal[i].send_by,
                created_at: result2.rows[0]?.created_at
            };
            arrayTotal[i].lastMessage = lastMessage;
        }

        const uniqueChats = []
        for (let i = 0; i < arrayTotal.length; i++) {
            const chat = arrayTotal[i];
            let findedChat = uniqueChats.find((c) => 
                ((c.send_by === chat.send_to && c.send_to === chat.send_by) || 
                (c.send_by === chat.send_by && c.send_to === chat.send_to)) 
            )
            if(findedChat){
                if(new Date(findedChat.lastMessage.created_at) < new Date(chat.lastMessage.created_at)){
                    uniqueChats.splice(uniqueChats.indexOf(findedChat), 1);
                    uniqueChats.push(chat);
                }
            }else{
                uniqueChats.push(chat);
            }
            
        }

        return res.json(uniqueChats)
    } catch (error) {
        console.log(error)
        return res.status(500).json({ error: "Error al obtener los chats" })
    }
})

app.get("/", (req, res) => {
    res.sendFile(__dirname + "\\public\\main.html")
})