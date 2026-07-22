import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { pool } from "./client.js";

async function migrate() {
  const schemaPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "schema.sql",
  );
  const sql = await fs.readFile(schemaPath, "utf8");
  await pool.query(sql);
  console.log("Database schema applied.");
  console.log(`Connected to: ${config.databaseUrl.replace(/:[^:@/]+@/, ":***@")}`);
}

migrate()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
