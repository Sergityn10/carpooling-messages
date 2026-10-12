import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config();

let cachedPublicKey = null;

export function getPublicKey() {
  if (cachedPublicKey) {
    return cachedPublicKey;
  }

  // 1. Intentar desde variable de entorno
  if (process.env.PUBLIC_KEY) {
    try {
      const formatted = process.env.PUBLIC_KEY.replace(/\\n/g, "\n")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .join("\n");
      cachedPublicKey = crypto.createPublicKey(formatted);
      return cachedPublicKey;
    } catch (error) {
      console.error("[Auth] Error al procesar PUBLIC_KEY desde entorno:", error.message);
    }
  }

  // 2. Intentar desde archivo fallback
  try {
    const fallbackPath = path.resolve(process.cwd(), "../carpooling-user/private/clave_publica.pem");
    if (fs.existsSync(fallbackPath)) {
      const fileContent = fs.readFileSync(fallbackPath, "utf8");
      cachedPublicKey = crypto.createPublicKey(fileContent);
      return cachedPublicKey;
    }
  } catch (error) {
    console.error("[Auth] Error al leer clave pública desde archivo:", error.message);
  }

  return null;
}

export function extractToken(req) {
  if (!req) return null;
  const authHeader = req.headers?.authorization || req.headers?.authentication;
  const bearerToken =
    typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : null;

  const cookieToken = req.cookies?.access_token;
  return bearerToken || cookieToken || null;
}

export function normalizeUserContext(decoded) {
  if (!decoded || typeof decoded !== "object") return null;
  const rawId = decoded.userId ?? decoded.id ?? decoded.sub ?? decoded.user_id;
  if (rawId === undefined || rawId === null || rawId === "") return null;

  const userId = String(rawId);
  return {
    ...decoded,
    id: userId,
    userId: userId,
    role: decoded.role || "user",
    email: decoded.email || null,
  };
}

export function verifyToken(token) {
  if (!token || typeof token !== "string") {
    throw new Error("Token no proporcionado o inválido");
  }

  const keyObject = getPublicKey();
  if (!keyObject) {
    throw new Error("No se configuró PUBLIC_KEY válida en el servidor");
  }

  // Whitelist estricta: solo RS256. Rechaza alg: 'none', HS256, etc. (CRIT-01)
  return jwt.verify(token, keyObject, { algorithms: ["RS256"] });
}

export default {
  getPublicKey,
  extractToken,
  normalizeUserContext,
  verifyToken,
};
