import dotenv from "dotenv";
import { verifyToken } from "../../utils/jwtVerify.js";
dotenv.config();

async function authenticate(socket) {
  const token = socket.handshake.auth.token;
  if (!token) {
    return socket.emit("error", "No se proporcionó un token de acceso");
  }

  try {
    const decoded = verifyToken(token);
    socket.user = decoded;
    socket.emit("auth", "Autenticación exitosa");
  } catch (error) {
    console.error("Error al validar el token:", error.message);
    return socket.emit("error", "No se proporcionó un token de acceso válido");
  }
}

export const utilsAuthentication = {
  authenticate,
};
