import { z } from "zod";
import db from "../database.js";

function getAuthUserKey(req) {
  const user = req.user ?? {};
  const raw =
    user.id ?? user.user_id ?? user.userId ?? user.username ?? user.email;
  if (raw === undefined || raw === null) return null;
  return String(raw);
}

async function getGroupChatById(chatId) {
  const result = await db.execute({
    sql: "SELECT * FROM chats WHERE id = ? AND is_group = 1",
    args: [chatId],
  });
  return result.rows?.[0] ?? null;
}

async function isParticipant(chatId, userKey) {
  const result = await db.execute({
    sql: "SELECT 1 AS ok FROM chat_participants WHERE chat_id = ? AND user_id = ? LIMIT 1",
    args: [chatId, userKey],
  });
  return Boolean(result.rows?.[0]?.ok);
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
  .union([z.string().min(1), z.number().int()])
  .transform((v) => String(v));

const createGroupChatSchema = z.object({
  name: z.string().min(1).optional(),
  trip_id: z.number().int().nullable().optional(),
  admin_id: userKeySchema.optional(),
  participant_ids: z.array(userKeySchema).optional(),
});

const updateGroupChatSchema = z
  .object({
    name: z.string().min(1).optional(),
    trip_id: z.number().int().nullable().optional(),
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
  const result = await db.execute({
    sql: `
            SELECT c.*
            FROM chats c
            JOIN chat_participants cp ON cp.chat_id = c.id
            WHERE c.is_group = 1 AND cp.user_id = ?
            ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
        `,
    args: [userKey],
  });
  return result.rows ?? [];
}

async function listAllChatsByUserKey(userKey) {
  const directResult = await db.execute({
    sql: `
            SELECT c.id AS chat_id, c.*, other.user_id AS peer_id
            FROM chats c
            JOIN chat_participants me ON me.chat_id = c.id AND me.user_id = ?
            LEFT JOIN chat_participants other ON other.chat_id = c.id AND other.user_id <> me.user_id
            WHERE c.is_group = 0
            ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
        `,
    args: [userKey],
  });

  const groupResult = await db.execute({
    sql: `
            SELECT c.id AS chat_id, c.*
            FROM chats c
            JOIN chat_participants me ON me.chat_id = c.id AND me.user_id = ?
            WHERE c.is_group = 1
            ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
        `,
    args: [userKey],
  });

  const directChats = (directResult.rows ?? []).map((c) => ({
    send_by: userKey,
    send_to: c.peer_id,
    chat_id: c.chat_id,
    is_group: 0,
    lastMessage: {
      message: c.last_message_content ?? null,
      send_by: c.last_message_sender_id ?? null,
      created_at: c.last_message_at ?? c.created_at,
    },
  }));

  const groupChats = (groupResult.rows ?? []).map((c) => ({
    ...c,
    chat_id: c.chat_id,
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
  const last = await db.execute({
    sql: `
            SELECT id, sender_id, content, created_at
            FROM messages
            WHERE chat_id = ?
            ORDER BY id DESC
            LIMIT 1
        `,
    args: [chatId],
  });
  const row = last.rows?.[0];
  if (!row) {
    await db.execute({
      sql: "UPDATE chats SET last_message_content = NULL, last_message_at = NULL, last_message_sender_id = NULL WHERE id = ?",
      args: [chatId],
    });
    return;
  }
  await db.execute({
    sql: "UPDATE chats SET last_message_content = ?, last_message_at = ?, last_message_sender_id = ? WHERE id = ?",
    args: [row.content, row.created_at, row.sender_id, chatId],
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

    const now = new Date().toISOString();
    const result = await db.execute({
      sql: "INSERT INTO chats (is_group, name, trip_id, admin_id, created_at) VALUES (1, ?, ?, ?, ?)",
      args: [
        parsed.data.name ?? null,
        parsed.data.trip_id ?? null,
        adminKey,
        now,
      ],
    });

    const chatId = Number(result.lastInsertRowid);
    const participants = new Set([
      adminKey,
      ...(parsed.data.participant_ids ?? []),
    ]);
    for (const userKey of participants) {
      try {
        await db.execute({
          sql: "INSERT INTO chat_participants (chat_id, user_id, joined_at) VALUES (?, ?, ?)",
          args: [chatId, userKey, now],
        });
      } catch {}
    }

    const chat = await getGroupChatById(chatId);
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
    const tripId = Number(req.params.tripId);
    if (!Number.isFinite(tripId))
      return res.status(400).json({ error: "tripId inválido" });

    const result = await db.execute({
      sql: "SELECT * FROM chats WHERE is_group = 1 AND trip_id = ? LIMIT 1",
      args: [tripId],
    });
    console.log(result);
    const chat = result.rows?.[0] ?? null;
    console.log("Chat", chat);
    if (!chat) return res.status(404).json({ error: "Chat no encontrado" });
    console.log("Pasa el chat");
    const userKey = await requireParticipant(req, res, Number(chat.id));
    console.log(userKey);
    if (!userKey) return;

    const participants = await db.execute({
      sql: "SELECT user_id, joined_at FROM chat_participants WHERE chat_id = ? ORDER BY joined_at ASC",
      args: [Number(chat.id)],
    });

    return res.json({ chat, participants: participants.rows ?? [] });
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

    const participants = await db.execute({
      sql: "SELECT user_id, joined_at FROM chat_participants WHERE chat_id = ? ORDER BY joined_at ASC",
      args: [chatId],
    });

    return res.json({ chat, participants: participants.rows ?? [] });
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

    await db.execute({
      sql: "UPDATE chats SET name = COALESCE(?, name), trip_id = COALESCE(?, trip_id), admin_id = COALESCE(?, admin_id) WHERE id = ? AND is_group = 1",
      args: [
        parsed.data.name ?? null,
        parsed.data.trip_id ?? null,
        parsed.data.admin_id ?? null,
        chatId,
      ],
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

    await db.execute({
      sql: "DELETE FROM chats WHERE id = ? AND is_group = 1",
      args: [chatId],
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

    const result = await db.execute({
      sql: "SELECT user_id, joined_at FROM chat_participants WHERE chat_id = ? ORDER BY joined_at ASC",
      args: [chatId],
    });
    return res.json(result.rows ?? []);
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

    const now = new Date().toISOString();
    try {
      await db.execute({
        sql: "INSERT INTO chat_participants (chat_id, user_id, joined_at) VALUES (?, ?, ?)",
        args: [chatId, parsed.data.user_id, now],
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

    await db.execute({
      sql: "DELETE FROM chat_participants WHERE chat_id = ? AND user_id = ?",
      args: [chatId, userKeyToRemove],
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

    const where = beforeId ? "chat_id = ? AND id < ?" : "chat_id = ?";
    const args = beforeId ? [chatId, beforeId] : [chatId];
    const result = await db.execute({
      sql: `
                SELECT id, chat_id, sender_id, content, type, is_read, created_at
                FROM messages
                WHERE ${where}
                ORDER BY id DESC
                LIMIT ?
            `,
      args: [...args, limit],
    });
    const rows = result.rows ?? [];
    rows.reverse();
    return res.json(rows);
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

    const now = new Date().toISOString();
    const result = await db.execute({
      sql: "INSERT INTO messages (chat_id, sender_id, content, type, is_read, created_at) VALUES (?, ?, ?, ?, 0, ?)",
      args: [
        chatId,
        userKey,
        parsed.data.content,
        parsed.data.type ?? "TEXT",
        now,
      ],
    });

    await db.execute({
      sql: "UPDATE chats SET last_message_content = ?, last_message_at = ?, last_message_sender_id = ? WHERE id = ? AND is_group = 1",
      args: [parsed.data.content, now, userKey, chatId],
    });

    return res.status(201).json({
      id: Number(result.lastInsertRowid),
      chat_id: chatId,
      sender_id: userKey,
      content: parsed.data.content,
      type: parsed.data.type ?? "TEXT",
      is_read: 0,
      created_at: now,
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

    const msg = await db.execute({
      sql: "SELECT id, sender_id FROM messages WHERE id = ? AND chat_id = ?",
      args: [messageId, chatId],
    });
    const row = msg.rows?.[0];
    if (!row) return res.status(404).json({ error: "Mensaje no encontrado" });

    const chat = await getGroupChatById(chatId);
    const isAdmin = chat && String(chat.admin_id) === String(userKey);
    if (!isAdmin && String(row.sender_id) !== String(userKey)) {
      return res.status(403).json({ error: "No puedes editar este mensaje" });
    }

    await db.execute({
      sql: "UPDATE messages SET content = ? WHERE id = ? AND chat_id = ?",
      args: [parsed.data.content, messageId, chatId],
    });

    const last = await db.execute({
      sql: "SELECT id FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 1",
      args: [chatId],
    });
    const lastId = last.rows?.[0]?.id;
    if (Number(lastId) === Number(messageId)) {
      await db.execute({
        sql: "UPDATE chats SET last_message_content = ?, last_message_sender_id = ? WHERE id = ? AND is_group = 1",
        args: [parsed.data.content, row.sender_id, chatId],
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

    const msg = await db.execute({
      sql: "SELECT id, sender_id FROM messages WHERE id = ? AND chat_id = ?",
      args: [messageId, chatId],
    });
    const row = msg.rows?.[0];
    if (!row) return res.status(404).json({ error: "Mensaje no encontrado" });

    const chat = await getGroupChatById(chatId);
    const isAdmin = chat && String(chat.admin_id) === String(userKey);
    if (!isAdmin && String(row.sender_id) !== String(userKey)) {
      return res.status(403).json({ error: "No puedes eliminar este mensaje" });
    }

    const last = await db.execute({
      sql: "SELECT id FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 1",
      args: [chatId],
    });
    const lastIdBefore = last.rows?.[0]?.id;

    await db.execute({
      sql: "DELETE FROM messages WHERE id = ? AND chat_id = ?",
      args: [messageId, chatId],
    });

    if (Number(lastIdBefore) === Number(messageId)) {
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

    const now = new Date().toISOString();
    try {
      await db.execute({
        sql: "INSERT INTO chat_participants (chat_id, user_id, joined_at) VALUES (?, ?, ?)",
        args: [chatId, userKey, now],
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

    await db.execute({
      sql: "DELETE FROM chat_participants WHERE chat_id = ? AND user_id = ?",
      args: [chatId, userKey],
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
