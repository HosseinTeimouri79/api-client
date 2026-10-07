// A small Server-Sent Events server for the tests.
import http from "node:http";

export async function startSseServer() {
  const seen = [];
  let reconnects = 0;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    let body = "";
    for await (const c of req) body += c;
    seen.push({ method: req.method, path: url.pathname, accept: req.headers.accept, lastId: req.headers["last-event-id"], auth: req.headers.authorization, ctype: req.headers["content-type"], enc: req.headers["accept-encoding"], body, query: url.search });
    const sse = () => res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    switch (url.pathname) {
      case "/stream":
        sse();
        res.write(": hello comment\n\n");
        res.write("event: tick\nid: 1\ndata: first\n\n");
        res.write("data: line one\ndata: line two\n\n");
        res.write('data: {"json":true,"n":[1,2]}\r\n\r\n');
        res.write("retry: 250\n\nid: 2\ndata: after retry\n\n");
        res.write("data: split");
        setTimeout(() => { res.write(" across chunks\n\n"); res.end(); }, 30);
        return;
      case "/echo":
        sse();
        res.write(`event: echo\ndata: ${JSON.stringify({ method: req.method, body })}\n\n`);
        return setTimeout(() => res.end(), 50);
      case "/forever":
        sse();
        res.write("data: tick\n\n");
        const t = setInterval(() => res.write("data: tick\n\n"), 20);
        return res.on("close", () => clearInterval(t));
      case "/resume":
        sse();
        reconnects++;
        if (reconnects === 1) { res.write("retry: 50\nid: 5\ndata: first connection\n\n"); return setTimeout(() => res.end(), 30); }
        res.write(`data: resumed from ${req.headers["last-event-id"]}\n\n`);
        return setTimeout(() => res.end(), 30);
      case "/plain": res.writeHead(200, { "content-type": "text/plain" }); return res.end("hello");
      case "/denied": res.writeHead(401, { "content-type": "application/json" }); return res.end('{"error":"nope"}');
      case "/redirect": res.writeHead(302, { location: "/stream" }); return res.end();
      case "/huge": sse(); res.write("data: " + "x".repeat(5000) + "\n\n"); return setTimeout(() => res.end(), 50);
      default: res.writeHead(404).end("no");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${server.address().port}`, seen, resetReconnects: () => (reconnects = 0), stop: () => { server.closeAllConnections?.(); server.close(); } };
}
