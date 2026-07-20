import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import morgan from "morgan";
import cors from "cors";
import dotenv from "dotenv";
import { Server } from "socket.io";
import { createServer } from "node:http";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
import { utilsAuthentication as authWebSocket } from "./controllers/authWebSocket.js";
import { utilsSockets } from "../utils/sockets.js";
import { utilsAuthentication as auth } from "./controllers/auth.js";
import { chatsController } from "./controllers/chats.js";
import { methods as decrypMethods } from "../utils/crypto.js";
import notificationsClient from "../utils/notificationsClient.js";
import { verifyToken } from "../utils/jwtVerify.js";
dotenv.config();

const __dirname = process.cwd();
const app = express();
const port = process.env.PORT ?? 4003;
//Creamos el servidor http
const server = createServer(app);
let trayectos_origin = process.env.TRAYECTOS_URL;
let frontend_origin = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
//Creamos el servidor socket.io
const io = new Server(server, {
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

  try {
    const decoded = verifyToken(token);
    socket.user = decoded;
    const userKey = getUserKeyFromUser(socket.user);
    if (userKey) {
      socket.userKey = userKey;
      socket.handshake.auth.id = userKey;
    }
  } catch (error) {
    console.error("Error al validar el token del socket:", error.message);
    const fallback = socket.handshake.auth?.id;
    if (fallback) socket.userKey = String(fallback);
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
    origin: [frontend_origin, trayectos_origin, "https://www.youconnext.es"], // Cambia esto a la URL de tu frontend
    methods: "GET,POST,PUT,PATCH,DELETE",
    credentials: true, // Permite el uso de cookies
  }),
);

//BASE DE DATOS — Las tablas se gestionan con Prisma (prisma/schema.prisma)

async function getOrCreateDirectChatId(userA, userB) {
  if (!userA || !userB) throw new Error("userA/userB requeridos");
  if (String(userA) === String(userB)) throw new Error("Chat inválido");

  const existing = await prisma.chat.findFirst({
    where: {
      is_group: false,
      AND: [
        { participants: { some: { user_id: String(userA) } } },
        { participants: { some: { user_id: String(userB) } } },
      ],
    },
    select: { id: true },
  });

  if (existing) return existing.id;

  const chat = await prisma.chat.create({
    data: {
      is_group: false,
      chat_type: "DIRECT",
      participants: {
        create: [{ user_id: String(userA) }, { user_id: String(userB) }],
      },
    },
  });

  return chat.id;
}

async function requireChatParticipant(chatId, userKey) {
  const participant = await prisma.chatParticipant.findFirst({
    where: { chat_id: Number(chatId), user_id: String(userKey) },
    select: { chat_id: true },
  });
  return Boolean(participant);
}

async function chatExists(chatId) {
  const chat = await prisma.chat.findUnique({
    where: { id: Number(chatId) },
    select: { id: true },
  });
  return Boolean(chat);
}

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
      const unreadMessages = await prisma.$queryRaw`
        SELECT m.id, m.chat_id, m.sender_id, m.content, m.created_at
        FROM messages m
        JOIN chat_participants cp ON cp.chat_id = m.chat_id
        JOIN (
            SELECT chat_id, MAX(id) AS max_id
            FROM messages
            WHERE is_read = 0 AND sender_id <> ${userKey}
            GROUP BY chat_id
        ) t ON t.chat_id = m.chat_id AND t.max_id = m.id
        WHERE cp.user_id = ${userKey}
        ORDER BY m.id DESC
        LIMIT 20
      `;

      unreadMessages.forEach((row) => {
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
      const chatInfo = await prisma.chat.findUnique({
        where: { id: chatId },
        select: { is_group: true },
      });
      const isGroup = chatInfo?.is_group === true;
    } catch (err) {
      console.error("Error fetching otherUser name:", err);
    }

    socket.emit("join_group", { room, otherUser });
    if (legacyAlsoEmitJoinChat) socket.emit("join_chat", { room, otherUser });

    const serverOffset = Number(serverOffsetRaw ?? 0);
    const totalMessages =
      serverOffset > 0
        ? await prisma.message.findMany({
            where: { chat_id: chatId, id: { gt: serverOffset } },
            orderBy: { id: "asc" },
          })
        : await prisma.message.findMany({
            where: { chat_id: chatId },
            orderBy: { id: "desc" },
            take: 50,
          });

    const arrayTotal = [...totalMessages];
    if (serverOffset === 0) arrayTotal.reverse();

    arrayTotal.forEach(async (row) => {
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

    await prisma.message.updateMany({
      where: { chat_id: chatId, sender_id: { not: userKey }, is_read: false },
      data: { is_read: true },
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
        const chatCheck = await prisma.chat.findUnique({
          where: { id: potentialChatId },
          select: { is_group: true },
        });

        if (chatCheck && chatCheck.is_group === true) {
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

      socket.emit("join_chat", { room: nameRoom, otherUser });

      const chatId = await getOrCreateDirectChatId(userKey, peerKey);
      socket.join(`chat:${chatId}`);

      const serverOffset = Number(socket.handshake.auth?.serverOffset ?? 0);
      const totalMessages =
        serverOffset > 0
          ? await prisma.message.findMany({
              where: { chat_id: chatId, id: { gt: serverOffset } },
              orderBy: { id: "asc" },
            })
          : await prisma.message.findMany({
              where: { chat_id: chatId },
              orderBy: { id: "desc" },
              take: 50,
            });

      const arrayTotal = [...totalMessages];
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

      await prisma.message.updateMany({
        where: { chat_id: chatId, sender_id: { not: userKey }, is_read: false },
        data: { is_read: true },
      });
    } catch (error) {}
  });

  socket.on("chat_message", async (data, ack) => {
    let newMessage;
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

      now = new Date();
      newMessage = await prisma.message.create({
        data: {
          chat_id: chatId,
          sender_id: String(send_by),
          content: message,
          type: "TEXT",
          is_read: false,
          created_at: now,
        },
      });

      try {
        await prisma.chat.update({
          where: { id: chatId },
          data: {
            last_message_content: message,
            last_message_at: now,
            last_message_sender_id: String(send_by),
          },
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
      serverOffset: String(newMessage.id),
      send_to: send_to,
      send_by: send_by,
      sender_name: senderName,
      created_at: now?.toISOString() ?? new Date().toISOString(),
      chatId: chatId,
    };

    socket.emit("chat_message", sendData);

    if (isGroup) {
      const participants = await prisma.chatParticipant.findMany({
        where: { chat_id: chatId },
        select: { user_id: true },
      });

      const recipientIds = participants
        .filter((row) => String(row.user_id) !== String(send_by))
        .map((row) => row.user_id);

      participants.forEach((row) => {
        if (String(row.user_id) === String(send_by)) return;
        io.to(`user:${row.user_id}`).emit("chat_message", sendData);

        io.to(`user:${row.user_id}`).emit("receiveNotification", {
          sender: send_by,
          chatId: chatId,
          sender_name: senderName,
          content: message,
        });
      });

      if (recipientIds.length > 0) {
        const pushTitle = senderName ? senderName : "Nuevo mensaje";
        const pushBody =
          message.length > 100 ? message.slice(0, 100) + "…" : message;
        for (const recipientId of recipientIds) {
          notificationsClient
            .sendPushToUser({
              userId: recipientId,
              title: pushTitle,
              body: pushBody,
              data: {
                type: "new_message",
                chatId: String(chatId),
                senderId: String(send_by),
              },
            })
            .catch((err) => {
              console.error(
                "[push notification] Error enviando push a",
                recipientId,
                err,
              );
            });
        }
      }
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
