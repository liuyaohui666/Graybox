import { config } from "dotenv";
import { Pool } from "pg";
import { readFile, writeFile } from "node:fs/promises";
config({ quiet: true });
// Pin to the configured database, never trust an arbitrary listener's identity.
if (process.env.GRAYBOX_MODE !== "local")
  throw new Error("Only local development is supported");
const pool = new Pool({
  connectionString: process.env.GRAYBOX_DATABASE_URL,
  connectionTimeoutMillis: 3000,
});
try {
  const environment_id = (
    await pool.query(
      "SELECT value FROM graybox.metadata WHERE key='environment_id'",
    )
  ).rows[0]?.value;
  if (typeof environment_id !== "string")
    throw new Error("Missing environment identity");
  const path = new URL("../.local/runtime.json", import.meta.url);
  let old: { environment_id: string } | undefined;
  try {
    old = JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  if (old && old.environment_id !== environment_id)
    throw new Error(
      "Environment identity changed; review configuration before proceeding",
    );
  await writeFile(
    path,
    JSON.stringify({ mode: "local", environment_id }, null, 2) + "\n",
  );
  console.log("Local runtime identity verified.");
} finally {
  await pool.end();
}
