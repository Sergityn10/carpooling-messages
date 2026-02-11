import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import morgan from "morgan";
import cors from "cors";
import dotenv from "dotenv";
import { Server } from "socket.io";
import { createServer } from "node:http";
import db from "./database.js";
import { utilsAuthentication as authWebSocket } from "./controllers/authWebSocket.js";
import { utilsSockets } from "../utils/sockets.js";
import { utilsAuthentication as auth } from "./controllers/auth.js";
import { chatsController } from "./controllers/chats.js";
import { methods as decrypMethods } from "../utils/crypto.js";
dotenv.config();

const __dirname = process.cwd();
const app = express();
const port = process.env.PORT ?? 4003;
//Creamos el servidor http
const server = createServer(app);
let frontend_origin = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
//Creamos el servidor socket.io
const io = new Server(server, {
  withCredentials: true, // <--- OBLIGATORIO para que viajen las cookies/JWT
  transports: ["websocket", "polling"], // Intenta websocket primero
  autoConnect: true,
  maxDisconnectionDelay: 5000,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
  },
  cors: {
    origin: [frontend_origin],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

function getUserKeyFromUser(user) {
  const raw = user?.id ?? user?.user_id ?? user?.userId ?? user?.email;
  if (raw === undefined || raw === null) return null;
  return String(raw);
}

async function authenticateSocketIfPossible(socket) {
  const token = socket.handshake.auth?.token;
  if (!token) {
    const fallback = socket.handshake.auth?.id;
    if (fallback) socket.userKey = String(fallback);
    return;
  }

  const usuariosUrl = process.env.USUARIOS_URL;
  if (!usuariosUrl) {
    const fallback = socket.handshake.auth?.id;
    if (fallback) socket.userKey = String(fallback);
    return;
  }

  const cookieHeaderValue = `access_token=${token}`;
  const response = await fetch(`${usuariosUrl}/api/auth/validate`, {
    method: "GET",
    credentials: "include",
    headers: {
      Cookie: cookieHeaderValue,
    },
  });

  if (!response.ok) {
    const fallback = socket.handshake.auth?.id;
    if (fallback) socket.userKey = String(fallback);
    return;
  }

  const data = await response.json();
  socket.user = data?.data;
  const userKey = getUserKeyFromUser(socket.user);
  if (userKey) {
    socket.userKey = userKey;
    socket.handshake.auth.id = userKey;
  }
}

io.use(async (socket, next) => {
  try {
    await authenticateSocketIfPossible(socket);
    return next();
  } catch (error) {
    return next(error);
  }
});
app.use(
  cors({
    origin: [frontend_origin], // Cambia esto a la URL de tu frontend
    methods: "GET,POST,PUT,PATCH,DELETE",
    credentials: true, // Permite el uso de cookies
  }),
);

//BASE DE DATOS

await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password TEXT NULL,
        img_perfil TEXT,
        name TEXT,
        phone TEXT,
        fecha_nacimiento TEXT NULL,
        dni TEXT NULL UNIQUE,
        genero TEXT NULL CHECK (genero IN ('Masculino','Femenino','Otro')),
        stripe_account TEXT,
        stripe_customer_account TEXT,
        ciudad TEXT NULL,
        provincia TEXT NULL,
        codigo_postal TEXT NULL,
        direccion TEXT NULL,
        onboarding_ended INTEGER NOT NULL DEFAULT 0,
        about_me TEXT,
        auth_method TEXT CHECK (auth_method IN ('password', 'google', 'other')) NOT NULL DEFAULT 'password',
        google_id TEXT NULL,
        created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
        updated_at TEXT DEFAULT (CURRENT_TIMESTAMP)
    );
`);

await db.execute(`
    CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        is_group INTEGER DEFAULT 0,
        name TEXT,
        trip_id INTEGER,
        admin_id INTEGER,
        last_message_content TEXT,
        last_message_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

try {
  await db.execute("ALTER TABLE chats ADD COLUMN last_message_sender_id TEXT");
} catch {}

await db.execute(`
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    sender_id TEXT NOT NULL, -- Quién lo envió
    
    content TEXT NOT NULL,
    type TEXT DEFAULT 'TEXT',   -- 'TEXT', 'IMAGE', 'SYSTEM'
    
    is_read INTEGER DEFAULT 0,  -- 0 = No leído, 1 = Leído
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
`);

try {
  const fk = await db.execute("PRAGMA foreign_key_list(messages)");
  const info = await db.execute("PRAGMA table_info(messages)");

  const fks = fk.rows ?? [];
  const cols = info.rows ?? [];
  const byName = new Set(cols.map((c) => String(c.name)));
  const senderCol = cols.find((c) => String(c.name) === "sender_id");
  const senderType = String(senderCol?.type ?? "").toUpperCase();

  const needsMigration =
    fks.some((r) => String(r.table) === "users") ||
    !byName.has("chat_id") ||
    !byName.has("sender_id") ||
    !senderType.includes("TEXT") ||
    !byName.has("content");

  if (needsMigration) {
    const tables = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('messages', 'messages_old')",
    });
    const existingNames = new Set(
      (tables.rows ?? []).map((r) => String(r.name)),
    );

    if (existingNames.has("messages") && !existingNames.has("messages_old")) {
      await db.execute("ALTER TABLE messages RENAME TO messages_old");

      await db.execute(`
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  sender_id TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT DEFAULT 'TEXT',
  is_read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
`);

      const oldInfo = await db.execute("PRAGMA table_info(messages_old)");
      const oldCols = oldInfo.rows ?? [];
      const oldByName = new Set(oldCols.map((c) => String(c.name)));

      const has = (name) => oldByName.has(name);
      const selectId = has("id") ? "id" : null;
      const selectChatId = has("chat_id")
        ? "chat_id"
        : has("conversation_id")
          ? "conversation_id"
          : null;

      if (selectChatId) {
        const senderExpr = has("sender_id")
          ? "CAST(sender_id AS TEXT)"
          : has("send_by")
            ? "CAST(send_by AS TEXT)"
            : "NULL";
        const contentExpr = has("content")
          ? "content"
          : has("message")
            ? "message"
            : "''";
        const typeExpr = has("type") ? "type" : "'TEXT'";
        const isReadExpr = has("is_read")
          ? "is_read"
          : has("readed")
            ? "readed"
            : "0";
        const createdExpr = has("created_at")
          ? "created_at"
          : "CURRENT_TIMESTAMP";

        if (selectId) {
          await db.execute({
            sql: `INSERT INTO messages (id, chat_id, sender_id, content, type, is_read, created_at)
                  SELECT ${selectId}, ${selectChatId} AS chat_id, ${senderExpr} AS sender_id, ${contentExpr} AS content, ${typeExpr} AS type, ${isReadExpr} AS is_read, ${createdExpr} AS created_at
                  FROM messages_old
                  WHERE ${selectChatId} IS NOT NULL AND ${senderExpr} IS NOT NULL`,
          });
        } else {
          await db.execute({
            sql: `INSERT INTO messages (chat_id, sender_id, content, type, is_read, created_at)
                  SELECT ${selectChatId} AS chat_id, ${senderExpr} AS sender_id, ${contentExpr} AS content, ${typeExpr} AS type, ${isReadExpr} AS is_read, ${createdExpr} AS created_at
                  FROM messages_old
                  WHERE ${selectChatId} IS NOT NULL AND ${senderExpr} IS NOT NULL`,
          });
        }
      }
    }
  }
} catch {}

await db.execute(`
    CREATE TABLE IF NOT EXISTS chat_participants (
        chat_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (chat_id, user_id)
    )
`);

try {
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_chat_participants_user ON chat_participants (user_id, chat_id)",
  );
} catch {}
try {
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_chats_group_inbox ON chats (is_group, last_message_at, created_at)",
  );
} catch {}

async function getOrCreateDirectChatId(userA, userB) {
  if (!userA || !userB) throw new Error("userA/userB requeridos");
  if (String(userA) === String(userB)) throw new Error("Chat inválido");

  const existing = await db.execute({
    sql: `
            SELECT c.id
            FROM chats c
            JOIN chat_participants cp1 ON cp1.chat_id = c.id AND cp1.user_id = ?
            JOIN chat_participants cp2 ON cp2.chat_id = c.id AND cp2.user_id = ?
            WHERE c.is_group = 0
            LIMIT 1
        `,
    args: [String(userA), String(userB)],
  });

  const row = existing.rows?.[0];
  if (row?.id !== undefined && row?.id !== null) return Number(row.id);

  const now = new Date().toISOString();
  const result = await db.execute({
    sql: "INSERT INTO chats (is_group, created_at) VALUES (0, ?)",
    args: [now],
  });
  const chatId = Number(result.lastInsertRowid);

  for (const userKey of [String(userA), String(userB)]) {
    try {
      await db.execute({
        sql: "INSERT INTO chat_participants (chat_id, user_id, joined_at) VALUES (?, ?, ?)",
        args: [chatId, userKey, now],
      });
    } catch {}
  }

  return chatId;
}

async function requireChatParticipant(chatId, userKey) {
  const result = await db.execute({
    sql: "SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ? LIMIT 1",
    args: [Number(chatId), String(userKey)],
  });
  const row = result.rows?.[0] ?? null;
  return Boolean(row);
}

async function chatExists(chatId) {
  const result = await db.execute({
    sql: "SELECT 1 FROM chats WHERE id = ? LIMIT 1",
    args: [Number(chatId)],
  });
  const row = result.rows?.[0] ?? null;
  return Boolean(row);
}

try {
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages (chat_id, id)",
  );
} catch {}
try {
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_messages_unread_chat ON messages (chat_id, is_read, id)",
  );
} catch {}
await db.execute(`
CREATE TABLE IF NOT EXISTS pre_register (city TEXT NOT NULL, email TEXT NOT NULL PRIMARY KEY);
`);

//MIDDLEWARES
app.disable("x-powered-by"); // Desactiva el encabezado x-powered-by
app.set("port", port);

server.listen(port, () => {
  console.log(`Listening on port ${app.get("port")}`);
});

app.use(express.static(__dirname + "\\public"));
app.use(morgan("dev")); // Middleware para registrar las peticiones HTTP en la consola
app.use(express.json());
app.use(cookieParser());

io.on("connection", async (socket) => {
  const socketUserKey =
    socket.userKey ?? String(socket.handshake.auth?.id ?? "");
  console.log("Usuario conectado");
  if (socketUserKey) {
    socket.join(`user:${socketUserKey}`);
    try {
      const userKey = String(socketUserKey);
      const unreadLastByChat = await db.execute({
        sql: `
                    SELECT m.id, m.chat_id, m.sender_id, m.content, m.created_at
                    FROM messages m
                    JOIN chat_participants cp ON cp.chat_id = m.chat_id
                    JOIN (
                        SELECT chat_id, MAX(id) AS max_id
                        FROM messages
                        WHERE is_read = 0 AND sender_id <> ?
                        GROUP BY chat_id
                    ) t ON t.chat_id = m.chat_id AND t.max_id = m.id
                    WHERE cp.user_id = ?
                    ORDER BY m.id DESC
                    LIMIT 20
                `,
        args: [userKey, userKey],
      });

      unreadLastByChat.rows.forEach((row) => {
        socket.emit("receiveNotification", {
          sender: row.sender_id,
          chatId: row.chat_id,
          content: row.content,
          pending: true,
          serverOffset: row.id,
        });
      });
    } catch (error) {}
  }
  socket.on("setUserId", (id) => {
    if (id) socket.join(`user:${id}`);
  });
  socket.on("disconnect", () => {});

  async function handleJoinGroup(
    chatIdRaw,
    serverOffsetRaw,
    legacyAlsoEmitJoinChat,
  ) {
    const userKey = socket.userKey ?? String(socket.handshake.auth?.id ?? "");
    if (!userKey) return;

    const chatId = Number(chatIdRaw);
    if (!Number.isFinite(chatId)) {
      socket.emit("chat_error", { message: "chatId inválido" });
      return;
    }

    const ok = await requireChatParticipant(chatId, userKey);
    if (!ok) {
      socket.emit("chat_error", {
        message: "No eres participante de este chat",
      });
      return;
    }

    const exists = await chatExists(chatId);
    if (!exists) {
      socket.emit("chat_error", { message: "Chat no existe" });
      return;
    }

    const room = `chat:${chatId}`;
    socket.join(room);

    let otherUser = null;
    try {
      const chatInfo = await db.execute({
        sql: "SELECT is_group FROM chats WHERE id = ?",
        args: [chatId],
      });
      const isGroup = chatInfo.rows?.[0]?.is_group === 1;

      // if (!isGroup) {
      //   const otherParticipant = await db.execute({
      //     sql: "SELECT user_id FROM chat_participants WHERE chat_id = ? AND user_id <> ? LIMIT 1",
      //     args: [chatId, userKey],
      //   });
      //   const otherUserId = otherParticipant.rows?.[0]?.user_id;

      //   if (otherUserId) {
      // const userRes = await db.execute({
      //   sql: "SELECT name FROM users WHERE id = ?",
      //   args: [otherUserId],
      // });
      //     otherUser = decrypMethods.decrypt(userRes.rows?.[0]?.name);
      //     console.log(otherUser);
      //   }
      // }
    } catch (err) {
      console.error("Error fetching otherUser name:", err);
    }

    socket.emit("join_group", { room, otherUser });
    if (legacyAlsoEmitJoinChat) socket.emit("join_chat", { room, otherUser });

    const serverOffset = Number(serverOffsetRaw ?? 0);
    const totalMessages =
      serverOffset > 0
        ? await db.execute({
            sql: `SELECT id, chat_id, sender_id, content, type, is_read, created_at FROM messages WHERE chat_id = ? AND id > ? ORDER BY id ASC`,
            args: [chatId, serverOffset],
          })
        : await db.execute({
            sql: `SELECT id, chat_id, sender_id, content, type, is_read, created_at FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 50`,
            args: [chatId],
          });

    const arrayTotal = [...totalMessages.rows];
    if (serverOffset === 0) arrayTotal.reverse();

    arrayTotal.forEach(async (row) => {
      const userRes = await db.execute({
        sql: "SELECT name FROM users WHERE id = ?",
        args: [row.sender_id],
      });
      const otherUser = decrypMethods.decrypt(userRes.rows?.[0]?.name);
      let sendData = {
        message: row.content,
        serverOffset: row.id,
        send_to: null,
        send_by: row.sender_id,
        sender_name: otherUser,
        created_at: row.created_at,
        chatId: row.chat_id,
      };

      socket.emit("chat_message", sendData);
    });

    await db.execute({
      sql: "UPDATE messages SET is_read = 1 WHERE chat_id = ? AND sender_id <> ? AND is_read = 0",
      args: [chatId, userKey],
    });
  }

  socket.on("join_group", async (data) => {
    try {
      if (data && typeof data === "object" && data.chatId !== undefined) {
        await handleJoinGroup(data.chatId, data.serverOffset, false);
        return;
      }
      await handleJoinGroup(data, 0, false);
    } catch (error) {
      console.log(error);
    }
  });

  socket.on("join_chat", async (data) => {
    try {
      const userKey = socket.userKey ?? String(socket.handshake.auth?.id ?? "");
      if (!userKey) return;

      if (
        (typeof data === "number" && Number.isFinite(data)) ||
        (typeof data === "string" && /^\d+$/.test(data))
      ) {
        const potentialChatId = Number(data);
        const isPart = await requireChatParticipant(potentialChatId, userKey);

        if (isPart) {
          await handleJoinGroup(data, 0, true);
          return;
        }

        // Not a participant. Check if it is a group.
        const chatCheck = await db.execute({
          sql: "SELECT is_group FROM chats WHERE id = ?",
          args: [potentialChatId],
        });
        const chatRow = chatCheck.rows?.[0];

        if (chatRow && chatRow.is_group === 1) {
          socket.emit("chat_error", {
            message: "No eres participante de este chat",
          });
          return;
        }
        // Fallthrough to treat as peerKey (User ID)
      }

      if (data && typeof data === "object" && data.chatId !== undefined) {
        await handleJoinGroup(data.chatId, data.serverOffset, true);
        return;
      }

      const peerKey = String(data);
      let nameRoom = utilsSockets.createNameChatRooms(userKey, peerKey);
      socket.join(nameRoom);
      console.log(
        "El usuario " + userKey + " se ha unido al chat con el id " + socket.id,
      );
      console.log(`para hablar con ${peerKey}`);

      let otherUser = null;
      try {
        const userRes = await db.execute({
          sql: "SELECT name FROM users WHERE id = ?",
          args: [peerKey],
        });
        // otherUser = userRes.rows?.[0]?.name;
        otherUser = decrypMethods.decrypt(userRes.rows?.[0]?.name);
      } catch (err) {
        console.error("Error fetching otherUser name for peerKey:", err);
      }

      socket.emit("join_chat", { room: nameRoom, otherUser });

      const chatId = await getOrCreateDirectChatId(userKey, peerKey);
      socket.join(`chat:${chatId}`);

      const serverOffset = Number(socket.handshake.auth?.serverOffset ?? 0);
      const totalMessages =
        serverOffset > 0
          ? await db.execute({
              sql: `SELECT id, chat_id, sender_id, content, type, is_read, created_at FROM messages WHERE chat_id = ? AND id > ? ORDER BY id ASC`,
              args: [chatId, serverOffset],
            })
          : await db.execute({
              sql: `SELECT id, chat_id, sender_id, content, type, is_read, created_at FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 50`,
              args: [chatId],
            });

      const arrayTotal = [...totalMessages.rows];
      if (serverOffset === 0) arrayTotal.reverse();

      arrayTotal.forEach((row) => {
        let sendData = {
          message: row.content,
          serverOffset: row.id,
          send_to: peerKey,
          send_by: row.sender_id,
          created_at: row.created_at,
          chatId: row.chat_id,
        };
        socket.emit("chat_message", sendData);
      });

      await db.execute({
        sql: "UPDATE messages SET is_read = 1 WHERE chat_id = ? AND sender_id <> ? AND is_read = 0",
        args: [chatId, userKey],
      });
    } catch (error) {}
  });

  socket.on("chat_message", async (data, ack) => {
    let result;
    const send_by = socket.userKey ?? String(socket.handshake.auth?.id ?? "");
    let senderName = socket.user?.name
      ? decrypMethods.decrypt(socket.user.name)
      : null;
    let message = data.message;
    let send_to = data.send_to;
    let now;
    let chatId;
    let isGroup = false;
    try {
      if (!send_by) throw new Error("Usuario no autenticado");
      if (!message) throw new Error("Mensaje vacío");

      if (data && typeof data === "object" && data.chatId !== undefined) {
        isGroup = true;
        chatId = Number(data.chatId);
        if (!Number.isFinite(chatId)) throw new Error("chatId inválido");

        const exists = await chatExists(chatId);
        if (!exists) throw new Error("Chat no existe");

        const ok = await requireChatParticipant(chatId, String(send_by));
        if (!ok) throw new Error("No eres participante de este chat");
      } else if (
        send_to !== undefined &&
        send_to !== null &&
        /^\d+$/.test(String(send_to))
      ) {
        const candidateChatId = Number(send_to);
        const exists = await chatExists(candidateChatId);
        const ok = exists
          ? await requireChatParticipant(candidateChatId, String(send_by))
          : false;

        if (exists && ok) {
          isGroup = true;
          chatId = candidateChatId;
          send_to = null;
        } else {
          if (!send_to) throw new Error("send_to requerido");
          chatId = await getOrCreateDirectChatId(send_by, send_to);
        }
      } else {
        if (!send_to) throw new Error("send_to requerido");
        chatId = await getOrCreateDirectChatId(send_by, send_to);
      }

      now = new Date().toISOString();
      result = await db.execute({
        sql: "INSERT INTO messages (chat_id, sender_id, content, type, is_read, created_at) VALUES (?, ?, ?, ?, 0, ?)",
        args: [chatId, String(send_by), message, "TEXT", now],
      });

      try {
        await db.execute({
          sql: "UPDATE chats SET last_message_content = ?, last_message_at = ?, last_message_sender_id = ? WHERE id = ?",
          args: [message, now, String(send_by), chatId],
        });
      } catch {}
    } catch (error) {
      if (typeof ack === "function") {
        ack({
          status: "error",
          message: error?.message ?? "No se pudo guardar el mensaje",
        });
      }
      socket.emit("chat_error", {
        message: error?.message ?? "No se pudo guardar el mensaje",
      });
      return;
    }
    let sendData = {
      message: message,
      serverOffset: result.lastInsertRowid.toString(),
      send_to: send_to,
      send_by: send_by,
      sender_name: senderName,
      created_at: now ?? new Date().toISOString(),
      chatId: chatId,
    };

    socket.emit("chat_message", sendData);

    if (isGroup) {
      const participants = await db.execute({
        sql: "SELECT user_id FROM chat_participants WHERE chat_id = ?",
        args: [chatId],
      });

      const recipients = (participants.rows ?? [])
        .map((r) => String(r.user_id))
        .filter((id) => id !== String(send_by));

      (participants.rows ?? []).forEach((row) => {
        if (String(row.user_id) === String(send_by)) return;
        io.to(`user:${row.user_id}`).emit("chat_message", sendData);

        io.to(`user:${row.user_id}`).emit("receiveNotification", {
          sender: send_by,
          chatId: chatId,
          sender_name: senderName,
          content: message,
        });
      });
    } else {
      io.to(`user:${send_to}`).emit("chat_message", sendData);

      io.to(`user:${send_to}`).emit("receiveNotification", {
        sender: send_by,
        senderName: senderName,
        chatId: await getOrCreateDirectChatId(send_by, send_to),
        content: message,
      });
    }

    if (typeof ack === "function") {
      ack({ status: "ok", serverOffset: sendData.serverOffset });
    }
  });

  if (!socket.recovered || socket.handshake.auth.serverOffset === 0) {
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

app.get("/api/chats", auth.authenticate, chatsController.listMyChats);

app.get(
  "/api/chats/user/:userKey",
  auth.authenticate,
  chatsController.listChatsByUser,
);
app.get(
  "/api/chats/trip/:tripId",
  auth.authenticate,
  chatsController.getChatByTripId,
);

app.post("/api/chats", auth.authenticate, chatsController.createGroupChat);
app.get("/api/chats/me", auth.authenticate, chatsController.listMyGroupChats);
app.get(
  "/api/chats/user/:userKey/groups",
  auth.authenticate,
  chatsController.listGroupChatsByUser,
);
app.get("/api/chats/:chatId", auth.authenticate, chatsController.getGroupChat);
app.patch(
  "/api/chats/:chatId",
  auth.authenticate,
  chatsController.updateGroupChat,
);
app.delete(
  "/api/chats/:chatId",
  auth.authenticate,
  chatsController.deleteGroupChat,
);

app.get(
  "/api/chats/:chatId/participants",
  auth.authenticate,
  chatsController.listParticipants,
);
app.post(
  "/api/chats/:chatId/participants",
  auth.authenticate,
  chatsController.addParticipant,
);
app.delete(
  "/api/chats/:chatId/participants/:userKey",
  auth.authenticate,
  chatsController.removeParticipant,
);

app.post(
  "/api/chats/:chatId/join",
  auth.authenticate,
  chatsController.joinGroupChat,
);
app.post(
  "/api/chats/:chatId/leave",
  auth.authenticate,
  chatsController.leaveGroupChat,
);

app.get(
  "/api/chats/:chatId/messages",
  auth.authenticate,
  chatsController.listMessages,
);
app.post(
  "/api/chats/:chatId/messages",
  auth.authenticate,
  chatsController.createMessage,
);
app.patch(
  "/api/chats/:chatId/messages/:messageId",
  auth.authenticate,
  chatsController.updateMessage,
);
app.delete(
  "/api/chats/:chatId/messages/:messageId",
  auth.authenticate,
  chatsController.deleteMessage,
);

app.get("/", (req, res) => {
  res.sendFile(__dirname + "\\public\\main.html");
});
