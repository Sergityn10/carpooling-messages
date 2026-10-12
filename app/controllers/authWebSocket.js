import dotenv from "dotenv";
import {
  verifyToken,
  normalizeUserContext,
} from "../../utils/jwtVerify.js";
dotenv.config();

/**
 * Extrae el token JWT del handshake del socket (auth.token, cabecera Authorization o cookies)
 */
function extractSocketToken(socket) {
  const authToken = socket.handshake.auth?.token;
  if (authToken && typeof authToken === "string") {
    return authToken.trim();
  }

  const authHeader = socket.handshake.headers?.authorization;
  if (
    typeof authHeader === "string" &&
    authHeader.toLowerCase().startsWith("bearer ")
  ) {
    return authHeader.slice(7).trim();
  }

  const cookieHeader = socket.handshake.headers?.cookie;
  if (typeof cookieHeader === "string") {
    const match = cookieHeader.match(/(?:^|;\s*)access_token=([^;]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
  }

  return null;
}

/**
 * Autentica estrictamente una conexión WebSocket con RS256 (FRONT-04)
 * Lanza un error si el token es inexistente o no es válido.
 */
function authenticateSocket(socket) {
  const token = extractSocketToken(socket);
  if (!token) {
    throw new Error("No se proporcionó un token de acceso");
  }

  const decoded = verifyToken(token);
  const user = normalizeUserContext(decoded);

  if (!user) {
    throw new Error("Token inválido: identificador de usuario no encontrado");
  }

  socket.user = user;
  socket.userKey = String(user.id);
  socket.userId = String(user.id);
  if (socket.handshake.auth) {
    socket.handshake.auth.id = String(user.id);
  }

  return user;
}

export const utilsAuthentication = {
  extractSocketToken,
  authenticateSocket,
};

export default utilsAuthentication;
