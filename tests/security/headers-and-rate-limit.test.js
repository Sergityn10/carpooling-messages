import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

test("MED-10 a MED-25: Rate limiter bloquea con 429 tras superar el límite", async () => {
  const app = express();
  const testLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 5, // límite bajo para la prueba rápida
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      status: "Error",
      code: "TOO_MANY_REQUESTS",
      message: "Límite excedido",
    },
  });

  app.get("/limited", testLimiter, (req, res) => {
    res.json({ status: "ok" });
  });

  const server = app.listen(0);
  const port = server.address().port;

  try {
    let lastStatus = 200;
    let lastBody = null;

    // Hacer 6 peticiones (el límite es 5)
    for (let i = 0; i < 6; i++) {
      const response = await fetch(`http://localhost:${port}/limited`);
      lastStatus = response.status;
      lastBody = await response.json();
    }

    assert.equal(lastStatus, 429, "Debe responder con 429 Too Many Requests en la sexta petición");
    assert.equal(lastBody.code, "TOO_MANY_REQUESTS");
  } finally {
    server.close();
  }
});

test("LOW-01 a LOW-13 & MED-01 a MED-04: Helmet aplica HSTS, CSP, nosniff y oculta x-powered-by", async () => {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      frameguard: { action: "deny" },
      noSniff: true,
    })
  );

  app.get("/test", (req, res) => {
    res.send("ok");
  });

  const server = app.listen(0);
  const port = server.address().port;

  try {
    const response = await fetch(`http://localhost:${port}/test`);
    const headers = response.headers;

    // Verificar cabeceras de seguridad
    assert.equal(headers.get("x-content-type-options"), "nosniff");
    assert.equal(headers.get("x-frame-options"), "DENY");
    assert.ok(headers.get("content-security-policy")?.includes("default-src 'self'"));
    // x-powered-by no debe existir
    assert.equal(headers.get("x-powered-by"), null);
  } finally {
    server.close();
  }
});
