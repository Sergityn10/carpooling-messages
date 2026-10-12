import test from "node:test";
import assert from "node:assert/strict";
import { utilsAuthentication as auth } from "../../app/controllers/auth.js";
import { chatsController } from "../../app/controllers/chats.js";

test("HIGH-06 / BOLA: requireOwnership rechaza acceso a recurso de otro usuario (403)", () => {
  const req = {
    user: { id: "user-111", role: "user" },
    params: { userId: "user-222" },
  };

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
  const ownershipMiddleware = auth.requireOwnership((r) => r.params.userId);
  ownershipMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(statusResult, 403);
  assert.equal(jsonResult.status, "Error");
});

test("HIGH-06 / BOLA: requireOwnership permite acceso a recurso propio", () => {
  const req = {
    user: { id: "user-111", role: "user" },
    params: { userId: "user-111" },
  };
  const res = {};

  let nextCalled = false;
  const ownershipMiddleware = auth.requireOwnership((r) => r.params.userId);
  ownershipMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});

test("HIGH-06 / BOLA: requireOwnership permite acceso al administrador", () => {
  const req = {
    user: { id: "admin-999", role: "admin" },
    params: { userId: "user-111" },
  };
  const res = {};

  let nextCalled = false;
  const ownershipMiddleware = auth.requireOwnership((r) => r.params.userId);
  ownershipMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});

test("RBAC: requireAdmin rechaza a usuarios estándar", () => {
  const req = {
    user: { id: "user-111", role: "user" },
  };

  let statusResult = null;
  const res = {
    status(code) {
      statusResult = code;
      return this;
    },
    json() {
      return this;
    },
  };

  let nextCalled = false;
  auth.requireAdmin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(statusResult, 403);
});

test("RBAC: requireAdmin aprueba a usuarios con rol admin", () => {
  const req = {
    user: { id: "admin-999", role: "admin" },
  };
  const res = {};

  let nextCalled = false;
  auth.requireAdmin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});

test("IDOR en chats: listChatsByUser devuelve 403 al consultar chats de otro usuario", async () => {
  const req = {
    user: { id: "user-alice", role: "user" },
    params: { userKey: "user-bob" },
  };

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

  await chatsController.listChatsByUser(req, res);

  assert.equal(statusResult, 403);
  assert.ok(jsonResult.error);
});

test("IDOR en chats: listGroupChatsByUser devuelve 403 al consultar grupos de otro usuario", async () => {
  const req = {
    user: { id: "user-alice", role: "user" },
    params: { userKey: "user-bob" },
  };

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

  await chatsController.listGroupChatsByUser(req, res);

  assert.equal(statusResult, 403);
  assert.ok(jsonResult.error);
});
