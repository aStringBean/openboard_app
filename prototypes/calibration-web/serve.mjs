/**
 * Static server rooted at openboard_app, so the prototype can import the real
 * codec from packages/aurora-protocol/dist. Web Bluetooth needs a secure
 * context, and localhost counts as one.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const ENTRY = "/prototypes/calibration-web/index.html";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname === "/" ? ENTRY : url.pathname;
  /* Keep the served tree inside ROOT. */
  const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ""));

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end(`not found: ${path}`);
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`calibration prototype: http://localhost:${PORT}${ENTRY}`);
  console.log(`serving from ${ROOT}`);
});
