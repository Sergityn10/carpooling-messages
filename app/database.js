import { createClient } from "@libsql/client";
import dotenv from "dotenv";
dotenv.config();

const db = createClient({
  url: process.env.DB_URL,
  authToken: process.env.DB_TOKEN,
});

export default db;
