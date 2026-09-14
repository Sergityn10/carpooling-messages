import amqp from "amqplib";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const RABBITMQ_URL =
  process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
const EXCHANGE = process.env.RABBITMQ_EXCHANGE || "carpooling_events";
const QUEUE_JOIN = "messages.reserva.chat.join";
const QUEUE_LEAVE = "messages.reserva.chat.leave";
const ROUTING_KEY_JOIN = "reserva.chat.join";
const ROUTING_KEY_LEAVE = "reserva.chat.leave";

let channel = null;

export async function connectRabbitMQ() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();

    await channel.assertExchange(EXCHANGE, "topic", { durable: true });

    await channel.assertQueue(QUEUE_JOIN, { durable: true });
    await channel.bindQueue(QUEUE_JOIN, EXCHANGE, ROUTING_KEY_JOIN);

    await channel.assertQueue(QUEUE_LEAVE, { durable: true });
    await channel.bindQueue(QUEUE_LEAVE, EXCHANGE, ROUTING_KEY_LEAVE);

    console.log(
      `[RabbitMQ] Conectado. Escuchando eventos en colas "${QUEUE_JOIN}" y "${QUEUE_LEAVE}"`,
    );

    const handleMessage = async (msg) => {
      if (!msg) return;

      try {
        const payload = JSON.parse(msg.content.toString());
        console.log("[RabbitMQ] Evento recibido:", payload.event);

        if (payload.event === "reserva.chat.join") {
          await handleReservaChatJoin(payload.data);
        } else if (payload.event === "reserva.chat.leave") {
          await handleReservaChatLeave(payload.data);
        }

        channel.ack(msg);
      } catch (error) {
        console.error("[RabbitMQ] Error procesando evento:", error);
        channel.nack(msg, false, false);
      }
    };

    channel.consume(QUEUE_JOIN, handleMessage);
    channel.consume(QUEUE_LEAVE, handleMessage);

    connection.on("close", () => {
      console.warn("[RabbitMQ] Conexión cerrada. Reintentando en 5s...");
      setTimeout(connectRabbitMQ, 5000);
    });

    connection.on("error", (err) => {
      console.error("[RabbitMQ] Error de conexión:", err.message);
    });
  } catch (error) {
    console.error("[RabbitMQ] No se pudo conectar:", error.message);
    console.error("[RabbitMQ] Reintentando en 5s...");
    setTimeout(connectRabbitMQ, 5000);
  }
}

async function handleReservaChatJoin(data) {
  const { id_reserva, user_id, trayecto_id, conductor_id } = data;

  if (!user_id || !trayecto_id) {
    console.error("[RabbitMQ] Datos incompletos en reserva.chat.join:", data);
    return;
  }

  console.log(
    `[RabbitMQ] reserva.chat.join: user=${user_id}, trayecto=${trayecto_id}, conductor=${conductor_id}`,
  );

  let chat = await prisma.chat.findFirst({
    where: {
      is_group: true,
      chat_type: "TRAYECTO",
      trip_id: trayecto_id,
    },
  });

  if (!chat) {
    console.log(
      `[RabbitMQ] No existe chat para trayecto ${trayecto_id}. Creando...`,
    );
    chat = await prisma.chat.create({
      data: {
        is_group: true,
        chat_type: "TRAYECTO",
        trip_id: trayecto_id,
        admin_id: conductor_id || null,
        name: `Chat trayecto ${trayecto_id}`,
        participants: {
          create: [
            { user_id: String(conductor_id) },
            { user_id: String(user_id) },
          ],
        },
      },
    });
    console.log(`[RabbitMQ] Chat creado con id=${chat.id}`);
    return;
  }

  const existing = await prisma.chatParticipant.findUnique({
    where: {
      chat_id_user_id: {
        chat_id: chat.id,
        user_id: String(user_id),
      },
    },
  });

  if (existing) {
    console.log(
      `[RabbitMQ] Usuario ${user_id} ya es participante del chat ${chat.id}`,
    );
    return;
  }

  await prisma.chatParticipant.create({
    data: {
      chat_id: chat.id,
      user_id: String(user_id),
    },
  });

  console.log(`[RabbitMQ] Usuario ${user_id} añadido al chat ${chat.id}`);
}

async function handleReservaChatLeave(data) {
  const { id_reserva, user_id, trayecto_id } = data;

  if (!user_id || !trayecto_id) {
    console.error("[RabbitMQ] Datos incompletos en reserva.chat.leave:", data);
    return;
  }

  console.log(
    `[RabbitMQ] reserva.chat.leave: user=${user_id}, trayecto=${trayecto_id}`,
  );

  const chat = await prisma.chat.findFirst({
    where: {
      is_group: true,
      chat_type: "TRAYECTO",
      trip_id: trayecto_id,
    },
  });

  if (!chat) {
    console.log(
      `[RabbitMQ] No existe chat para trayecto ${trayecto_id}. Nada que hacer.`,
    );
    return;
  }

  const existing = await prisma.chatParticipant.findUnique({
    where: {
      chat_id_user_id: {
        chat_id: chat.id,
        user_id: String(user_id),
      },
    },
  });

  if (!existing) {
    console.log(
      `[RabbitMQ] Usuario ${user_id} no es participante del chat ${chat.id}. Nada que hacer.`,
    );
    return;
  }

  if (String(chat.admin_id) === String(user_id)) {
    console.log(
      `[RabbitMQ] Usuario ${user_id} es admin del chat ${chat.id}. No se elimina al admin.`,
    );
    return;
  }

  await prisma.chatParticipant.delete({
    where: {
      chat_id_user_id: {
        chat_id: chat.id,
        user_id: String(user_id),
      },
    },
  });

  console.log(`[RabbitMQ] Usuario ${user_id} eliminado del chat ${chat.id}`);
}

export function getChannel() {
  return channel;
}

export default { connectRabbitMQ, getChannel };
