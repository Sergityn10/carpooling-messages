import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  verifyToken,
  extractToken,
  normalizeUserContext,
  getPublicKey,
} from "../../utils/jwtVerify.js";
import { utilsAuthentication as auth } from "../../app/controllers/auth.js";

// Generar par de claves RSA para pruebas o usar la existente
const privateKeyPath = path.resolve(
  process.cwd(),
  "../carpooling-user/private/clave_privada.pem",
);
const PRIVATE_KEY = fs.existsSync(privateKeyPath)
  ? fs.readFileSync(privateKeyPath, "utf8")
  : null;

test("CRIT-01: jwt.verify debe rechazar algoritmo none", () => {
  // Construir token malicioso con alg: none
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ userId: "attacker-uuid", role: "admin" })
  ).toString("base64url");
  const noneToken = `${header}.${payload}.`;

  assert.throws(
    () => {
      verifyToken(noneToken);
    },
    (err) => {
      return (
        err.name === "JsonWebTokenError" ||
        err.message.includes("algorithm") ||
        err.message.includes("invalid")
      );
    },
    "El token con alg: none debe ser rechazado inmediatamente"
  );
});

test("CRIT-01: jwt.verify debe rechazar tokens firmados con clave simétrica (HS256)", () => {
  const symmetricToken = jwt.sign(
    { userId: "attacker-uuid", role: "admin" },
    "clave-secreta-simetrica",
    { algorithm: "HS256" }
  );

  assert.throws(
    () => {
      verifyToken(symmetricToken);
    },
    (err) => {
      return (
        err.name === "JsonWebTokenError" ||
        err.message.includes("algorithm") ||
        err.message.includes("invalid")
      );
    },
    "El token firmado con HS256 debe ser rechazado por la whitelist RS256"
  );
});

test("CRIT-01: jwt.verify debe rechazar token con firma alterada o corrupta", () => {
  if (!PRIVATE_KEY) return;
  const validToken = jwt.sign(
    { userId: "valid-user-123", role: "user" },
    PRIVATE_KEY,
    { algorithm: "RS256" }
  );

  const parts = validToken.split(".");
  const tamperedToken = `${parts[0]}.${parts[1]}.badSignature12345`;

  assert.throws(
    () => {
      verifyToken(tamperedToken);
    },
    (err) => {
      return err.name === "JsonWebTokenError";
    },
    "Token con firma manipulada debe ser rechazado"
  );
});

test("CRIT-02: Normalización de contexto de usuario", () => {
  const decodedWithUserId = { userId: "user-uuid-1", role: "driver", name: "Alice" };
  const normalized1 = normalizeUserContext(decodedWithUserId);
  assert.equal(normalized1.id, "user-uuid-1");
  assert.equal(normalized1.userId, "user-uuid-1");
  assert.equal(normalized1.role, "driver");

  const decodedWithId = { id: "user-uuid-2", email: "bob@test.com" };
  const normalized2 = normalizeUserContext(decodedWithId);
  assert.equal(normalized2.id, "user-uuid-2");
  assert.equal(normalized2.userId, "user-uuid-2");
  assert.equal(normalized2.role, "user"); // rol por defecto

  // Token sin identificador de usuario válido debe retornar null
  const invalidPayload = { foo: "bar" };
  assert.equal(normalizeUserContext(invalidPayload), null);
});

test("Extracción de token desde diferentes fuentes", () => {
  // Authorization Bearer
  const req1 = { headers: { authorization: "Bearer my-secret-token" } };
  assert.equal(extractToken(req1), "my-secret-token");

  // Authentication Bearer
  const req2 = { headers: { authentication: "Bearer another-token" } };
  assert.equal(extractToken(req2), "another-token");

  // Cookie
  const req3 = { headers: {}, cookies: { access_token: "cookie-token" } };
  assert.equal(extractToken(req3), "cookie-token");

  // Ninguno
  const req4 = { headers: {} };
  assert.equal(extractToken(req4), null);
});

test("CRIT-01 & CRIT-02: Middleware de autenticación HTTP rechaza peticiones sin token", async () => {
  const req = { headers: {}, cookies: {} };
  let statusResult = null;
  let jsonResult = null;
  const res = {
    status(code) {
      statusResult = code;
      return this;
    },
    json(data) {
      jsonResult = data;
      return this;
    },
  };

  let nextCalled = false;
  await auth.authenticate(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(statusResult, 401);
  assert.equal(jsonResult.status, "Error");
});

test("CRIT-01 & CRIT-02: Middleware de autenticación acepta token RS256 legítimo y asigna req.user", async () => {
  if (!PRIVATE_KEY) return;
  const validToken = jwt.sign(
    { userId: "valid-user-999", role: "user", email: "user@youconnext.es" },
    PRIVATE_KEY,
    { algorithm: "RS256" }
  );

  const req = { headers: { authorization: `Bearer ${validToken}` }, cookies: {} };
  const res = {
    status() { return this; },
    json() { return this; },
  };

  let nextCalled = false;
  await auth.authenticate(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.ok(req.user);
  assert.equal(req.user.id, "valid-user-999");
  assert.equal(req.user.userId, "valid-user-999");
  assert.equal(req.user.role, "user");
});
