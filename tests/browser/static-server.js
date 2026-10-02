import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";

// A real origin outage also works in WebKit, whose offline-emulation switch
// bypasses Service Workers: https://github.com/microsoft/playwright/issues/42775
export async function staticServer() {
  const root = resolve("dist");
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".webmanifest": "application/manifest+json",
  };
  const server = createServer(async (req, res) => {
    const path = resolve(
      root,
      "." +
        decodeURIComponent(
          new URL(req.url, "http://localhost").pathname,
        ).replace(/\/$/, "/index.html"),
    );
    if (!path.startsWith(root)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const data = await readFile(path);
      res.writeHead(200, {
        "Content-Type": types[extname(path)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  return {
    url,
    stop: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
