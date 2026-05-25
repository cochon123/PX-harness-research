import { createServer } from "node:http";
import { renderPage } from "../apps/web-zoo/render.mjs";

const routes = {
  "/dashboard": "dashboard",
  "/docs": "docs-home",
  "/youtube": "youtube-feed"
};

export function startWebZooServer({ port = 0 } = {}) {
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const pageId = routes[url.pathname];

    if (url.pathname === "/" || url.pathname === "/health") {
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("px web zoo ok");
      return;
    }

    const html = pageId ? renderPage(pageId) : null;
    if (!html) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(html);
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        origin: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((closeResolve, closeReject) => {
          server.close((error) => error ? closeReject(error) : closeResolve());
        })
      });
    });
  });
}

