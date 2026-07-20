import { z } from "zod";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function getAuthUserKey(req) {
  const user = req.user ?? {};
  const raw =
    user.id ??
    user.user_id ??
    user.userId ??
    user.email ??
    user.sub ??
    user.uid;
  if (raw === undefined || raw === null) return null;
  return String(raw);
}

async function getGroupChatById(chatId) {
  return await prisma.chat.findFirst({
    where: { id: chatId, is_group: true },
  });
}

const CHAT_TYPES = ["DIRECT", "TRAYECTO", "VIAJE", "EVENT"];
const chatTypeSchema = z.enum(CHAT_TYPES);

async function isParticipant(chatId, userKey) {
  const participant = await prisma.chatParticipant.findFirst({
    where: { chat_id: chatId, user_id: userKey },
  });
  return Boolean(participant);
}

async function requireParticipant(req, res, chatId) {
  const userKey = getAuthUserKey(req);
  if (!userKey) {
    res
      .status(400)
      .json({ error: "No se pudo determinar el usuario autenticado" });
    return null;
  }
  // const ok = await isParticipant(chatId, userKey);
  // if (!ok) {
  //   console.log(ok);
  //   res.status(403).json({ error: "No eres participante de este chat" });
  //   return null;
  // }
  return userKey;
}

async function requireAdmin(req, res, chatId) {
  const userKey = getAuthUserKey(req);
  if (!userKey) {
    res
      .status(400)
      .json({ error: "No se pudo determinar el usuario autenticado" });
    return null;
  }
  const chat = await getGroupChatById(chatId);
  if (!chat) {
    res.status(404).json({ error: "Chat no encontrado" });
    return null;
  }
  if (String(chat.admin_id) !== String(userKey)) {
    res.status(403).json({ error: "Solo el admin puede realizar esta acción" });
    return null;
  }
  return userKey;
}

const userKeySchema = z
  .string()
  .uuid()
  .transform((v) => String(v));

const createGroupChatSchema = z.object({
  name: z.string().min(1).optional(),
  chat_type: chatTypeSchema.default("TRAYECTO"),
  trip_id: z.string().uuid().nullable().optional(),
  admin_id: userKeySchema.optional(),
  participant_ids: z.array(userKeySchema).optional(),
});

const updateGroupChatSchema = z
  .object({
    name: z.string().min(1).optional(),
    chat_type: chatTypeSchema.optional(),
    trip_id: z.string().uuid().nullable().optional(),
    admin_id: userKeySchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "No hay campos para actualizar",
  });

const addParticipantSchema = z.object({
  user_id: userKeySchema,
});

const createMessageSchema = z.object({
  content: z.string().min(1),
  type: z.string().min(1).optional(),
});

const updateMessageSchema = z.object({
  content: z.string().min(1),
});

async function listGroupChatsByUserKey(userKey) {
  const chats = await prisma.chat.findMany({
    where: {
      is_group: true,
      participants: { some: { user_id: userKey } },
    },
  });
  chats.sort((a, b) => {
    const da = new Date(a.last_message_at ?? a.created_at).getTime();
    const dbb = new Date(b.last_message_at ?? b.created_at).getTime();
    return dbb - da;
  });
  return chats;
}

async function listAllChatsByUserKey(userKey) {
  const directChatsRaw = await prisma.chat.findMany({
    where: {
      is_group: false,
      participants: { some: { user_id: userKey } },
    },
    include: {
      participants: {
        where: { user_id: { not: userKey } },
        select: { user_id: true },
      },
    },
  });

  const groupChatsRaw = await prisma.chat.findMany({
    where: {
      is_group: true,
      participants: { some: { user_id: userKey } },
    },
  });

  const directChats = directChatsRaw.map((c) => ({
    send_by: userKey,
    send_to: c.participants[0]?.user_id ?? null,
    chat_id: c.id,
    is_group: 0,
    lastMessage: {
      message: c.last_message_content ?? null,
      send_by: c.last_message_sender_id ?? null,
      created_at: c.last_message_at ?? c.created_at,
    },
  }));

  const groupChats = groupChatsRaw.map((c) => ({
    ...c,
    chat_id: c.id,
    is_group: 1,
    lastMessage: {
      message: c.last_message_content ?? null,
      send_by: c.last_message_sender_id ?? null,
      created_at: c.last_message_at ?? c.created_at,
    },
  }));

  const all = [...directChats, ...groupChats];
  all.sort((a, b) => {
    const da = new Date(
      a.lastMessage?.created_at ?? a.created_at ?? 0,
    ).getTime();
    const dbb = new Date(
      b.lastMessage?.created_at ?? b.created_at ?? 0,
    ).getTime();
    return dbb - da;
  });
  return all;
}

async function recomputeAndUpdateLastMessage(chatId) {
  const lastMessage = await prisma.message.findFirst({
    where: { chat_id: chatId },
    orderBy: { id: "desc" },
  });
  if (!lastMessage) {
    await prisma.chat.update({
      where: { id: chatId },
      data: {
        last_message_content: null,
        last_message_at: null,
        last_message_sender_id: null,
      },
    });
    return;
  }
  await prisma.chat.update({
    where: { id: chatId },
    data: {
      last_message_content: lastMessage.content,
      last_message_at: lastMessage.created_at,
      last_message_sender_id: lastMessage.sender_id,
    },
  });
}

async function createGroupChat(req, res) {
  try {
    const parsed = createGroupChatSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.message });

    const authUserKey = getAuthUserKey(req);
    const adminKey = parsed.data.admin_id ?? authUserKey;
    if (!adminKey) return res.status(400).json({ error: "admin_id requerido" });

    const participants = new Set([
      adminKey,
      ...(parsed.data.participant_ids ?? []),
    ]);

    const chat = await prisma.chat.create({
      data: {
        is_group: true,
        chat_type: parsed.data.chat_type,
        name: parsed.data.name ?? null,
        trip_id: parsed.data.trip_id ?? null,
        admin_id: adminKey,
        participants: {
          create: [...participants].map((userKey) => ({
            user_id: userKey,
          })),
        },
      },
      include: { participants: true },
    });

    return res.status(201).json({ chat });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error al crear el chat de grupo" });
  }
}

async function listMyChats(req, res) {
  try {
    const userKey = getAuthUserKey(req);
    if (!userKey)
      return res
        .status(400)
        .json({ error: "No se pudo determinar el usuario autenticado" });

    const chats = await listAllChatsByUserKey(userKey);
    return res.json(chats);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error al obtener los chats" });
  }
}

async function listChatsByUser(req, res) {
  try {
    const userKey = String(req.params.userKey);
    if (!userKey) return res.status(400).json({ error: "userKey inválido" });

    const chats = await listAllChatsByUserKey(userKey);
    return res.json(chats);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error al obtener los chats" });
  }
}

async function getChatByTripId(req, res) {
  try {
    const tripId = String(req.params.tripId);
    if (!tripId) return res.status(400).json({ error: "tripId inválido" });

    const chatType = req.query.type ?? "TRAYECTO";
    if (!CHAT_TYPES.includes(chatType) || chatType === "DIRECT") {
      return res.status(400).json({ error: "type inválido" });
    }

    const chat = await prisma.chat.findFirst({
      where: { is_group: true, chat_type: chatType, trip_id: tripId },
    });
    if (!chat) return res.status(404).json({ error: "Chat no encontrado" });
    const userKey = await requireParticipant(req, res, Number(chat.id));
    if (!userKey) return;

    const participants = await prisma.chatParticipant.findMany({
      where: { chat_id: Number(chat.id) },
      orderBy: { joined_at: "asc" },
    });

    return res.json({ chat, participants });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error al obtener el chat" });
  }
}

async function listMyGroupChats(req, res) {
  try {
    const userKey = getAuthUserKey(req);
    if (!userKey)
      return res
        .status(400)
        .json({ error: "No se pudo determinar el usuario autenticado" });

    const chats = await listGroupChatsByUserKey(userKey);
    return res.json(chats);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error al obtener los chats" });
  }
}

async function listGroupChatsByUser(req, res) {
  try {
    const userKey = String(req.params.userKey);
    if (!userKey) return res.status(400).json({ error: "userKey inválido" });

    const chats = await listGroupChatsByUserKey(userKey);
    return res.json(chats);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error al obtener los chats" });
  }
}

async function getGroupChat(req, res) {
  try {
    const chatId = Number(req.params.chatId);
    if (!Number.isFinite(chatId))
      return res.status(400).json({ error: "chatId inválido" });

    const userKey = await requireParticipant(req, res, chatId);
    if (!userKey) return;

    const chat = await getGroupChatById(chatId);
    if (!chat) return res.status(404).json({ error: "Chat no encontrado" });

    const participants = await prisma.chatParticipant.findMany({
      where: { chat_id: chatId },
      orderBy: { joined_at: "asc" },
    });

    return res.json({ chat, participants });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error al obtener el chat" });
  }
}

async function updateGroupChat(req, res) {
  try {
    const chatId = Number(req.params.chatId);
    if (!Number.isFinite(chatId))
      return res.status(400).json({ error: "chatId inválido" });

    const adminKey = await requireAdmin(req, res, chatId);
    if (!adminKey) return;

    const parsed = updateGroupChatSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.message });

    const data = {};
    if (parsed.data.name) data.name = parsed.data.name;
    if (parsed.data.chat_type) data.chat_type = parsed.data.chat_type;
    if (parsed.data.trip_id) data.trip_id = parsed.data.trip_id;
    if (parsed.data.admin_id) data.admin_id = parsed.data.admin_id;

    await prisma.chat.updateMany({
      where: { id: chatId, is_group: true },
      data,
    });

    const chat = await getGroupChatById(chatId);
    return res.json({ chat });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error al actualizar el chat" });
  }
}

async function deleteGroupChat(req, res) {
  try {
    const chatId = Number(req.params.chatId);
    if (!Number.isFinite(chatId))
      return res.status(400).json({ error: "chatId inválido" });

    const adminKey = await requireAdmin(req, res, chatId);
    if (!adminKey) return;

    await prisma.chat.deleteMany({
      where: { id: chatId, is_group: true },
    });

    return res.status(204).send();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error al eliminar el chat" });
  }
}

async function listParticipants(req, res) {
  try {
    const chatId = Number(req.params.chatId);
    if (!Number.isFinite(chatId))
      return res.status(400).json({ error: "chatId inválido" });

    const userKey = await requireParticipant(req, res, chatId);
    if (!userKey) return;

    const participants = await prisma.chatParticipant.findMany({
      where: { chat_id: chatId },
      orderBy: { joined_at: "asc" },
    });
    return res.json(participants);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error al obtener participantes" });
  }
}

async function addParticipant(req, res) {
  try {
    const chatId = Number(req.params.chatId);
    if (!Number.isFinite(chatId))
      return res.status(400).json({ error: "chatId inválido" });

    const adminKey = await requireAdmin(req, res, chatId);
    if (!adminKey) return;

    const parsed = addParticipantSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.message });

    try {
      await prisma.chatParticipant.create({
        data: { chat_id: chatId, user_id: parsed.data.user_id },
      });
    } catch {
      return res.status(409).json({ error: "El usuario ya es participante" });
    }

    return res
      .status(201)
      .json({ chat_id: chatId, user_id: parsed.data.user_id });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error al añadir participante" });
  }
}

async function removeParticipant(req, res) {
  try {
    const chatId = Number(req.params.chatId);
    const userKeyToRemove = String(req.params.userKey);
    if (!Number.isFinite(chatId) || !userKeyToRemove) {
      return res.status(400).json({ error: "Parámetros inválidos" });
    }

    const adminKey = await requireAdmin(req, res, chatId);
    if (!adminKey) return;

    await prisma.chatParticipant.deleteMany({
      where: { chat_id: chatId, user_id: userKeyToRemove },
    });

    return res.status(204).send();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error al eliminar participante" });
  }
}

async function listMessages(req, res) {
  try {
    const chatId = Number(req.params.chatId);
    if (!Number.isFinite(chatId))
      return res.status(400).json({ error: "chatId inválido" });

    const userKey = await requireParticipant(req, res, chatId);
    if (!userKey) return;

    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
    const beforeId = req.query.before_id ? Number(req.query.before_id) : null;

    const messages = await prisma.message.findMany({
      where: beforeId
        ? { chat_id: chatId, id: { lt: beforeId } }
        : { chat_id: chatId },
      orderBy: { id: "desc" },
      take: limit,
    });
    messages.reverse();
    return res.json(messages);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error al obtener mensajes" });
  }
}

async function createMessage(req, res) {
  try {
    const chatId = Number(req.params.chatId);
    if (!Number.isFinite(chatId))
      return res.status(400).json({ error: "chatId inválido" });

    const userKey = await requireParticipant(req, res, chatId);
    if (!userKey) return;

    const parsed = createMessageSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.message });

    const message = await prisma.message.create({
      data: {
        chat_id: chatId,
        sender_id: userKey,
        content: parsed.data.content,
        type: parsed.data.type ?? "TEXT",
        is_read: false,
      },
    });

    await prisma.chat.updateMany({
      where: { id: chatId, is_group: true },
      data: {
        last_message_content: parsed.data.content,
        last_message_at: message.created_at,
        last_message_sender_id: userKey,
      },
    });

    return res.status(201).json({
      id: message.id,
      chat_id: chatId,
      sender_id: userKey,
      content: parsed.data.content,
      type: parsed.data.type ?? "TEXT",
      is_read: false,
      created_at: message.created_at,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error al crear mensaje" });
  }
}

async function updateMessage(req, res) {
  try {
    const chatId = Number(req.params.chatId);
    const messageId = Number(req.params.messageId);
    if (!Number.isFinite(chatId) || !Number.isFinite(messageId)) {
      return res.status(400).json({ error: "Parámetros inválidos" });
    }

    const userKey = await requireParticipant(req, res, chatId);
    if (!userKey) return;

    const parsed = updateMessageSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.message });

    const msg = await prisma.message.findFirst({
      where: { id: messageId, chat_id: chatId },
      select: { id: true, sender_id: true },
    });
    if (!msg) return res.status(404).json({ error: "Mensaje no encontrado" });

    const chat = await getGroupChatById(chatId);
    const isAdmin = chat && String(chat.admin_id) === String(userKey);
    if (!isAdmin && String(msg.sender_id) !== String(userKey)) {
      return res.status(403).json({ error: "No puedes editar este mensaje" });
    }

    await prisma.message.update({
      where: { id: messageId },
      data: { content: parsed.data.content },
    });

    const last = await prisma.message.findFirst({
      where: { chat_id: chatId },
      orderBy: { id: "desc" },
      select: { id: true },
    });
    if (last && last.id === messageId) {
      await prisma.chat.updateMany({
        where: { id: chatId, is_group: true },
        data: {
          last_message_content: parsed.data.content,
          last_message_sender_id: msg.sender_id,
        },
      });
    }

    return res.json({
      id: messageId,
      chat_id: chatId,
      content: parsed.data.content,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error al actualizar mensaje" });
  }
}

async function deleteMessage(req, res) {
  try {
    const chatId = Number(req.params.chatId);
    const messageId = Number(req.params.messageId);
    if (!Number.isFinite(chatId) || !Number.isFinite(messageId)) {
      return res.status(400).json({ error: "Parámetros inválidos" });
    }

    const userKey = await requireParticipant(req, res, chatId);
    if (!userKey) return;

    const msg = await prisma.message.findFirst({
      where: { id: messageId, chat_id: chatId },
      select: { id: true, sender_id: true },
    });
    if (!msg) return res.status(404).json({ error: "Mensaje no encontrado" });

    const chat = await getGroupChatById(chatId);
    const isAdmin = chat && String(chat.admin_id) === String(userKey);
    if (!isAdmin && String(msg.sender_id) !== String(userKey)) {
      return res.status(403).json({ error: "No puedes eliminar este mensaje" });
    }

    const last = await prisma.message.findFirst({
      where: { chat_id: chatId },
      orderBy: { id: "desc" },
      select: { id: true },
    });
    const lastIdBefore = last?.id;

    await prisma.message.deleteMany({
      where: { id: messageId, chat_id: chatId },
    });

    if (lastIdBefore === messageId) {
      await recomputeAndUpdateLastMessage(chatId);
    }

    return res.status(204).send();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error al eliminar mensaje" });
  }
}

async function joinGroupChat(req, res) {
  try {
    const chatId = Number(req.params.chatId);
    if (!Number.isFinite(chatId))
      return res.status(400).json({ error: "chatId inválido" });

    const userKey = getAuthUserKey(req);
    if (!userKey)
      return res
        .status(400)
        .json({ error: "No se pudo determinar el usuario autenticado" });

    const chat = await getGroupChatById(chatId);
    if (!chat) return res.status(404).json({ error: "Chat no encontrado" });

    try {
      await prisma.chatParticipant.create({
        data: { chat_id: chatId, user_id: userKey },
      });
    } catch {
      return res.status(409).json({ error: "Ya eres participante" });
    }

    return res.status(201).json({ chat_id: chatId, user_id: userKey });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error al unirse al chat" });
  }
}

async function leaveGroupChat(req, res) {
  try {
    const chatId = Number(req.params.chatId);
    if (!Number.isFinite(chatId))
      return res.status(400).json({ error: "chatId inválido" });

    const userKey = getAuthUserKey(req);
    if (!userKey)
      return res
        .status(400)
        .json({ error: "No se pudo determinar el usuario autenticado" });

    const chat = await getGroupChatById(chatId);
    if (!chat) return res.status(404).json({ error: "Chat no encontrado" });

    if (String(chat.admin_id) === String(userKey)) {
      return res.status(403).json({
        error:
          "El admin no puede salir del chat (transfiere admin o elimina el chat)",
      });
    }

    await prisma.chatParticipant.deleteMany({
      where: { chat_id: chatId, user_id: userKey },
    });

    return res.status(204).send();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error al salir del chat" });
  }
}

export const chatsController = {
  createGroupChat,
  listMyChats,
  listChatsByUser,
  getChatByTripId,
  listMyGroupChats,
  listGroupChatsByUser,
  getGroupChat,
  updateGroupChat,
  deleteGroupChat,
  joinGroupChat,
  leaveGroupChat,
  listParticipants,
  addParticipant,
  removeParticipant,
  listMessages,
  createMessage,
  updateMessage,
  deleteMessage,
};
