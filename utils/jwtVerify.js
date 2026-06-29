import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import dotenv from "dotenv";
dotenv.config();

const PUBLIC_KEY = process.env.PUBLIC_KEY
  ? process.env.PUBLIC_KEY.replace(/\\n/g, "\n")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .join("\n")
  : null;

const publicKeyObject = PUBLIC_KEY ? crypto.createPublicKey(PUBLIC_KEY) : null;

export function verifyToken(token) {
  if (!publicKeyObject) {
    throw new Error("No se configuró PUBLIC_KEY en las variables de entorno");
  }
  return jwt.verify(token, publicKeyObject, { algorithms: ["RS256"] });
}
