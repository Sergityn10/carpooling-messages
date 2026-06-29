import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
dotenv.config();

const prisma = new PrismaClient();

function escapeValue(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  if (v instanceof Date)
    return `'${v.toISOString().slice(0, 19).replace("T", " ")}'`;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v))
    return `'${v.slice(0, 19).replace("T", " ")}'`;
  const s = String(v).replace(/'/g, "''");
  return `'${s}'`;
}

function buildRawSql(sql, args) {
  if (!args || args.length === 0) return sql;
  let i = 0;
  return sql.replace(/\?/g, () => {
    if (i >= args.length) return "?";
    return escapeValue(args[i++]);
  });
}

const db = {
  async execute(input) {
    const sql = typeof input === "string" ? input : input.sql;
    const args = typeof input === "string" ? [] : (input.args ?? []);

    const rawSql = buildRawSql(sql, args);
    const trimmed = rawSql.trim().toUpperCase();

    if (trimmed.startsWith("INSERT")) {
      const result = await prisma.$executeRawUnsafe(rawSql);
      const rows = await prisma.$queryRawUnsafe(
        "SELECT LAST_INSERT_ID() AS id",
      );
      const insertId = rows?.[0]?.id ?? 0;
      return {
        rows: [],
        lastInsertRowid: insertId,
        changes: result,
      };
    }

    if (trimmed.startsWith("UPDATE") || trimmed.startsWith("DELETE")) {
      const result = await prisma.$executeRawUnsafe(rawSql);
      return {
        rows: [],
        lastInsertRowid: 0,
        changes: result,
      };
    }

    const rows = await prisma.$queryRawUnsafe(rawSql);
    return {
      rows: Array.isArray(rows) ? rows : [],
      lastInsertRowid: 0,
      changes: 0,
    };
  },
};

export default db;
