import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import fs from "node:fs";
import path from "node:path";
import { utilsAuthentication as authWebSocket } from "../../app/controllers/authWebSocket.js";

const privateKeyPath = path.resolve(
  process.cwd(),
  "../carpooling-user/private/clave_privada.pem",
);
const PRIVATE_KEY = fs.existsSync(privateKeyPath)
  ? fs.readFileSync(privateKeyPath, "utf8")
  : null;

test("FRONT-04: Conexión WebSocket rechaza handshake sin token", () => {
  const socketWithoutToken = {
    handshake: {
      auth: {},
      headers: {},
    },
  };

  assert.throws(
    () => {
      authWebSocket.authenticateSocket(socketWithoutToken);
    },
    (err) => {
      return err.message.includes("No se proporcionó un token de acceso");
    },
    "El handshake sin token debe ser rechazado"
  );
});

test("FRONT-04: Conexión WebSocket rechaza intento de bypass con solo auth.id (suplantación)", () => {
  // Vulnerabilidad anterior: socket enviaba auth: { id: "victim-id" } sin token
  const spoofAttemptSocket = {
    handshake: {
      auth: { id: "victim-user-uuid" },
      headers: {},
    },
  };

  assert.throws(
    () => {
      authWebSocket.authenticateSocket(spoofAttemptSocket);
    },
    (err) => {
      return err.message.includes("No se proporcionó un token de acceso");
    },
    "Cualquier intento de bypass con solo auth.id debe ser denegado"
  );
  assert.equal(spoofAttemptSocket.userKey, undefined);
});

test("FRONT-04: Conexión WebSocket rechaza handshake con token alg: none", () => {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ userId: "attacker-uuid", role: "admin" })
  ).toString("base64url");
  const noneToken = `${header}.${payload}.`;

  const socketWithNoneToken = {
    handshake: {
      auth: { token: noneToken },
      headers: {},
    },
  };

  assert.throws(
    () => {
      authWebSocket.authenticateSocket(socketWithNoneToken);
    },
    (err) => {
      return (
        err.name === "JsonWebTokenError" ||
        err.message.includes("algorithm") ||
        err.message.includes("invalid")
      );
    },
    "El handshake con alg: none debe ser rechazado"
  );
});

test("FRONT-04: Conexión WebSocket acepta handshake con token RS256 legítimo y asigna identidad inmutable", () => {
  if (!PRIVATE_KEY) return;
  const legitimateToken = jwt.sign(
    { userId: "legitimate-user-777", role: "driver", name: "Bob" },
    PRIVATE_KEY,
    { algorithm: "RS256" }
  );

  const socketLegit = {
    handshake: {
      auth: { token: legitimateToken },
      headers: {},
    },
  };

  const user = authWebSocket.authenticateSocket(socketLegit);
  assert.ok(user);
  assert.equal(user.id, "legitimate-user-777");
  assert.equal(socketLegit.userKey, "legitimate-user-777");
  assert.equal(socketLegit.userId, "legitimate-user-777");
  assert.equal(socketLegit.handshake.auth.id, "legitimate-user-777");
});
