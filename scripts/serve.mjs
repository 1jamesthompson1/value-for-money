#!/usr/bin/env node
/** Tiny zero-dependency static server for local previews. */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const root = path.resolve(process.cwd(), "public");
const port = Number(process.env.PORT) || 4173;

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) throw new Error("outside root");
    const info = await stat(file).catch(() => null);
    if (!info) throw new Error("not found");
    if (info.isDirectory()) file = path.join(file, "index.html");
    res.writeHead(200, {
      "content-type": types[path.extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}).listen(port, () => {
  console.log(`Preview: http://localhost:${port}`);
});
