import dotenv from "dotenv";
import { verifyToken } from "../../utils/jwtVerify.js";
dotenv.config();

async function authenticate(req, res, next) {
  const authHeader = req.headers?.authorization;
  const bearerToken =
    typeof authHeader === "string"
      ? authHeader.match(/^Bearer\s+(.+)$/i)?.[1]
      : undefined;
  const cookieToken = req.cookies?.access_token;
  const token = bearerToken || cookieToken;
  if (!token) {
    return res
      .status(401)
      .send({
        status: "Error",
        message: "No se proporcionó un token de acceso",
      });
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    console.error("Error al validar el token:", error.message);
    return res
      .status(401)
      .send({
        status: "Error",
        message: "No se proporcionó un token de acceso válido",
      });
  }
}

export const utilsAuthentication = {
  authenticate,
};
