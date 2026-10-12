import rateLimit from "express-rate-limit";

// Rate limiting multinivel según el Plan de Remediación DAST (FASE 3)

// Rate limiter general para toda la API (MED-10 a MED-22, MED-23 a MED-25)
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  limit: 1000, // 1000 peticiones por ventana para uso general
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    status: "Error",
    code: "TOO_MANY_REQUESTS",
    message: "Demasiadas peticiones desde esta IP. Inténtelo de nuevo más tarde.",
  },
});

// Rate limiter estricto para envío de mensajes (protección contra spam/inundación y DoS)
export const messageCreateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  limit: 60, // 60 mensajes por minuto por IP/cliente
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    status: "Error",
    code: "TOO_MANY_REQUESTS",
    message: "Límite de mensajes excedido. Por favor, espere antes de enviar más mensajes.",
  },
});

// Rate limiter para mutación de chats (creación, edición, eliminación de grupos)
export const chatMutationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  limit: 30, // 30 operaciones por minuto
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    status: "Error",
    code: "TOO_MANY_REQUESTS",
    message: "Límite de operaciones excedido. Por favor, espere un momento.",
  },
});
