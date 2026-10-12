import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import morgan from "morgan";
import cors from "cors";
import helmet from "helmet";
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
import { connectRabbitMQ } from "../utils/rabbitmq.js";
import { verifyToken, normalizeUserContext } from "../utils/jwtVerify.js";
import {
  generalLimiter,
  messageCreateLimiter,
  chatMutationLimiter,
} from "./middleware/rate-limiter.js";

dotenv.config();

const __dirname = process.cwd();
const app = express();
const port = process.env.PORT ?? 4003;

// Creamos el servidor http
const server = createServer(app);
const trayectos_origin = process.env.TRAYECTOS_URL;
const frontend_origin = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";

const allowedOrigins = [
  frontend_origin,
  trayectos_origin,
  "https://www.youconnext.es",
  "https://admin.youconnext.es",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:5174",
].filter(Boolean);

// Creamos el servidor socket.io
const io = new Server(server, {
  maxDisconnectionDelay: 5000,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
  },
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Middleware obligatorio de autenticación WebSocket (FRONT-04, CRIT-01, CRIT-02)
io.use(async (socket, next) => {
  try {
    authWebSocket.authenticateSocket(socket);
    return next();
  } catch (error) {
    console.warn("[Socket.io] Conexión rechazada por autenticación:", error.message);
    return next(new Error("Authentication error: " + error.message));
  }
});

// Rate limiting en memoria para mensajes de WebSocket (protección DoS)
const socketMessageRateMap = new Map();
function checkSocketRateLimit(socketId, maxPerWindow = 30, windowMs = 10000) {
  const now = Date.now();
  let timestamps = socketMessageRateMap.get(socketId) || [];
  timestamps = timestamps.filter((t) => now - t < windowMs);
  if (timestamps.length >= maxPerWindow) {
    return false;
  }
  timestamps.push(now);
  socketMessageRateMap.set(socketId, timestamps);
  return true;
}

// Hardening de cabeceras de seguridad y banners (LOW-01 a LOW-13, MED-01 a MED-04)
app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https:", "wss:", "ws:"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    frameguard: { action: "deny" },
    noSniff: true,
  }),
);

app.use(
  cors({
    origin: allowedOrigins,
    methods: "GET,POST,PUT,PATCH,DELETE",
    credentials: true,
  }),
);

app.set("port", port);

// Rate limiting general para toda la API (MED-10 a MED-22, MED-23 a MED-25)
app.use(generalLimiter);

app.use(express.static(path.join(__dirname, "public")));
app.use(morgan("dev"));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

// Endpoint de salud y resiliencia (CRIT-03, CRIT-04, ENS/ISO)
app.get("/health", async (req, res) => {
  let dbStatus = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    dbStatus = "error";
  }

  const isHealthy = dbStatus === "ok";
  return res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? "ok" : "degraded",
    service: "carpooling-messages",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {
      database: dbStatus,
    },
  });
});

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

// Gestión de conexiones Socket.io
io.on("connection", async (socket) => {
  const socketUserKey = String(socket.userKey || "");
  console.log(`[Socket.io] Usuario autenticado conectado: ${socketUserKey} (socket ${socket.id})`);

  if (socketUserKey) {
    socket.join(`user:${socketUserKey}`);
    try {
      const userKey = socketUserKey;
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
    } catch (error) {
      console.error("[Socket.io] Error al recuperar notificaciones iniciales:", error.message);
    }
  }

  // Prevenir suplantación de sala mediante setUserId (CRIT-02)
  socket.on("setUserId", (id) => {
    if (String(id) === socketUserKey) {
      socket.join(`user:${socketUserKey}`);
    } else {
      console.warn(`[Socket.io] Intento bloqueado de unirse a sala ajena: ${id} por ${socketUserKey}`);
    }
  });

  socket.on("disconnect", () => {
    socketMessageRateMap.delete(socket.id);
  });

  async function handleJoinGroup(
    chatIdRaw,
    serverOffsetRaw,
    legacyAlsoEmitJoinChat,
  ) {
    const userKey = socket.userKey;
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

    arrayTotal.forEach((row) => {
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
      console.error("[Socket.io] Error en join_group:", error);
    }
  });

  socket.on("join_chat", async (data) => {
    try {
      const userKey = socket.userKey;
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
      }

      if (data && typeof data === "object" && data.chatId !== undefined) {
        await handleJoinGroup(data.chatId, data.serverOffset, true);
        return;
      }

      const peerKey = String(data);
      let nameRoom = utilsSockets.createNameChatRooms(userKey, peerKey);
      socket.join(nameRoom);

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
    } catch (error) {
      console.error("[Socket.io] Error en join_chat:", error);
    }
  });

  socket.on("chat_message", async (data, ack) => {
    // Control de flujo / Rate limiting en WebSocket (MED-23 a MED-25)
    if (!checkSocketRateLimit(socket.id)) {
      const errPayload = { message: "Demasiados mensajes enviados. Espere un momento." };
      if (typeof ack === "function") ack({ status: "error", message: errPayload.message });
      socket.emit("chat_error", errPayload);
      return;
    }

    let newMessage;
    const send_by = socket.userKey; // Siempre extraído del token criptográfico verificado (CRIT-02)
    let senderName = socket.user?.name
      ? decrypMethods.decrypt(socket.user.name)
      : null;
    let message = typeof data?.message === "string" ? data.message.trim() : "";
    let send_to = data?.send_to;
    let now;
    let chatId;
    let isGroup = false;

    try {
      if (!send_by) throw new Error("Usuario no autenticado");
      if (!message || message.length === 0) throw new Error("Mensaje vacío");
      if (message.length > 5000) throw new Error("El mensaje excede el límite permitido");

      if (data && typeof data === "object" && data.chatId !== undefined) {
        isGroup = true;
        chatId = Number(data.chatId);
        if (!Number.isFinite(chatId)) throw new Error("chatId inválido");

        const chat = await prisma.chat.findUnique({ where: { id: chatId } });
        if (!chat) throw new Error("Chat no existe");
        if (chat.status === "INACTIVE") throw new Error("El chat está inactivo");

        const ok = await requireChatParticipant(chatId, send_by);
        if (!ok) throw new Error("No eres participante de este chat");
      } else if (
        send_to !== undefined &&
        send_to !== null &&
        /^\d+$/.test(String(send_to))
      ) {
        const candidateChatId = Number(send_to);
        const chat = await prisma.chat.findUnique({ where: { id: candidateChatId } });
        const exists = Boolean(chat);
        const ok = exists ? await requireChatParticipant(candidateChatId, send_by) : false;

        if (exists && ok) {
          if (chat.status === "INACTIVE") throw new Error("El chat está inactivo");
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
          sender_id: send_by,
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
            last_message_sender_id: send_by,
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
                err?.message ?? err,
              );
            });
        }
      }
    } else {
      io.to(`user:${send_to}`).emit("chat_message", sendData);

      io.to(`user:${send_to}`).emit("receiveNotification", {
        sender: send_by,
        senderName: senderName,
        chatId: chatId,
        content: message,
      });
    }

    if (typeof ack === "function") {
      ack({ status: "ok", serverOffset: sendData.serverOffset });
    }
  });
});

// Rutas REST protegidas con autenticación, autorización anti-BOLA y rate limiting

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

app.patch(
  "/api/chats/trip/:tripId/disable",
  auth.authenticate,
  chatMutationLimiter,
  chatsController.disableChatByTripId,
);

app.post(
  "/api/chats",
  auth.authenticate,
  chatMutationLimiter,
  chatsController.createGroupChat,
);

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
  chatMutationLimiter,
  chatsController.updateGroupChat,
);

app.patch(
  "/api/chats/:chatId/status",
  auth.authenticate,
  chatMutationLimiter,
  chatsController.updateChatStatus,
);

app.delete(
  "/api/chats/:chatId",
  auth.authenticate,
  chatMutationLimiter,
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
  chatMutationLimiter,
  chatsController.addParticipant,
);

app.delete(
  "/api/chats/:chatId/participants/:userKey",
  auth.authenticate,
  chatMutationLimiter,
  chatsController.removeParticipant,
);

app.post(
  "/api/chats/:chatId/join",
  auth.authenticate,
  chatMutationLimiter,
  chatsController.joinGroupChat,
);

app.post(
  "/api/chats/:chatId/leave",
  auth.authenticate,
  chatMutationLimiter,
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
  messageCreateLimiter,
  chatsController.createMessage,
);

app.patch(
  "/api/chats/:chatId/messages/:messageId",
  auth.authenticate,
  messageCreateLimiter,
  chatsController.updateMessage,
);

app.delete(
  "/api/chats/:chatId/messages/:messageId",
  auth.authenticate,
  chatMutationLimiter,
  chatsController.deleteMessage,
);

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "main.html"));
});

// Manejador global de errores
app.use((err, req, res, next) => {
  console.error("[Error Handler]", err);
  const status = err.status || 500;
  return res.status(status).json({
    status: "Error",
    message: err.message || "Error interno del servidor",
  });
});

server.listen(port, () => {
  console.log(`Listening on port ${app.get("port")}`);
  connectRabbitMQ();
});

export { app, server, io };
