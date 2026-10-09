import { defineConfig, type Plugin } from "vite";
import { allowedLocalRequest } from "./src/request-path.ts";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

function localBridge(): Plugin {
  return {
    name: "graybox-local-development-bridge",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__graybox", async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        try {
          if (
            req.headers.host !== "127.0.0.1:4317" &&
            req.headers.host !== "localhost:4317"
          )
            throw new Error("Origin rejected");
          if (
            req.headers.origin &&
            !["http://127.0.0.1:4317", "http://localhost:4317"].includes(
              req.headers.origin,
            )
          )
            throw new Error("Origin rejected");
          const file = JSON.parse(
            await readFile(
              new URL("../../.local/credentials.json", import.meta.url),
              "utf8",
            ),
          );
          if (file.mode !== "local-demonstration-only")
            throw new Error("Local mode required");
          if (req.url === "/profiles" && req.method === "GET") {
            res.end(
              JSON.stringify(
                file.humans.map(({ id, name, role }: any) => ({
                  id,
                  name,
                  role,
                })),
              ),
            );
            return;
          }
          if (
            req.url !== "/request" ||
            req.method !== "POST" ||
            !req.headers["content-type"]?.startsWith("application/json")
          )
            throw new Error("Request rejected");
          let raw = "";
          for await (const chunk of req) {
            raw += chunk;
            if (Buffer.byteLength(raw,"utf8") > 256*1024) throw new Error("Request too large");
          }
          const input = JSON.parse(raw);
          const profile = file.humans.find(
            (p: any) => p.id === input.profileId,
          );
          if (
            !profile ||
            !["GET", "POST"].includes(input.method) ||
            !allowedLocalRequest(input.path, input.method)
          )
            throw new Error("Request rejected");
          const response = await fetch("http://127.0.0.1:4318" + input.path, {
            method: input.method,
            redirect: "error",
            headers: {
              Authorization: `Bearer ${profile.token}`,
              "Content-Type": "application/json",
            },
            body:
              input.method === "POST"
                ? JSON.stringify(input.body ?? {})
                : undefined,
            signal: AbortSignal.timeout(15_000),
          });
          res.statusCode = response.status;
          res.end(await response.text());
        } catch {
          res.statusCode = 503;
          res.end(
            JSON.stringify({
              error: {
                code: "LOCAL_CONNECTION_ERROR",
                message: "本地 API 或凭据文件不可用。",
              },
            }),
          );
        }
      });
    },
  };
}
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), ...((process.env.VITE_GRAYBOX_MODE ?? process.env.GRAYBOX_WEB_MODE) === "cloud" ? [] : [localBridge()])],
  define: { "import.meta.env.VITE_GRAYBOX_MODE": JSON.stringify((process.env.VITE_GRAYBOX_MODE ?? process.env.GRAYBOX_WEB_MODE) === "local" || (!(process.env.VITE_GRAYBOX_MODE ?? process.env.GRAYBOX_WEB_MODE) && process.argv.includes("build") === false) ? "local" : "cloud") },
  server: {
    host: "127.0.0.1",
    port: 4317,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: { outDir: "dist", emptyOutDir: true },
});


