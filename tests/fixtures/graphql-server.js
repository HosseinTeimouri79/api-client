// A small GraphQL server for the tests: queries and mutations over HTTP (POST and GET) and subscriptions over WebSocket
// (graphql-transport-ws and the legacy graphql-ws protocol).
import http from "node:http";
import { buildSchema, graphql, subscribe, parse } from "graphql";
import { WebSocketServer } from "ws";

export const schema = buildSchema(`
  "A greeting service"
  type Query {
    "Says hello"
    hello(name: String = "world"): String!
    me: String
    boom: String
    echo(input: Input!): String
  }
  input Input { a: Int, b: [String!] }
  type Mutation { setCounter(value: Int!): Int! }
  type Subscription { countdown(from: Int = 3): Int! }
`);

export async function startGraphqlServer() {
  let counter = 0;
  const seen = [];
  const rootValue = {
    hello: ({ name }) => `hello ${name}`,
    me: (_a, ctx) => ctx.auth ?? null,
    boom: () => { throw new Error("kaboom"); },
    echo: ({ input }) => JSON.stringify(input),
    setCounter: ({ value }) => (counter = value),
    countdown: async function* ({ from }) { for (let i = from; i > 0; i--) { yield { countdown: i }; await new Promise((r) => setTimeout(r, 10)); } },
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname !== "/graphql") return res.writeHead(404).end("no");
    let body = "";
    for await (const c of req) body += c;
    seen.push({ method: req.method, accept: req.headers.accept, ctype: req.headers["content-type"], auth: req.headers.authorization, query: url.search });
    let p;
    try {
      p = req.method === "GET" ? { query: url.searchParams.get("query"), variables: url.searchParams.get("variables") && JSON.parse(url.searchParams.get("variables")), operationName: url.searchParams.get("operationName") } : JSON.parse(body);
    } catch { return res.writeHead(400).end(JSON.stringify({ errors: [{ message: "bad request" }] })); }
    if (req.method === "GET" && /^\s*mutation/.test(p.query ?? "")) return res.writeHead(405).end(JSON.stringify({ errors: [{ message: "mutations need POST" }] }));
    const out = await graphql({ schema, source: p.query, rootValue, contextValue: { auth: req.headers.authorization }, variableValues: p.variables, operationName: p.operationName });
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
  });
  const wss = new WebSocketServer({ server, path: "/graphql", handleProtocols: (set) => (set.has("graphql-transport-ws") ? "graphql-transport-ws" : set.has("graphql-ws") ? "graphql-ws" : false) });
  wss.on("connection", (ws, req) => {
    const modern = ws.protocol === "graphql-transport-ws";
    const conn = { auth: req.headers.authorization, params: null };
    seen.push({ ws: ws.protocol, auth: req.headers.authorization });
    ws.on("message", async (raw) => {
      const m = JSON.parse(raw);
      if (m.type === "connection_init") {
        conn.params = m.payload ?? null;
        seen.push({ init: conn.params });
        if (conn.params?.reject) return ws.close(4403, "Forbidden");
        return ws.send(JSON.stringify({ type: "connection_ack" }));
      }
      if (m.type === "subscribe" || m.type === "start") {
        const it = await subscribe({ schema, document: parse(m.payload.query), rootValue, variableValues: m.payload.variables, operationName: m.payload.operationName });
        if (Symbol.asyncIterator in it) {
          ws.on("close", () => it.return?.());
          ws.stopSub = () => it.return?.();
          for await (const r of it) ws.send(JSON.stringify({ id: m.id, type: modern ? "next" : "data", payload: r }));
          ws.send(JSON.stringify({ id: m.id, type: "complete" }));
        } else ws.send(JSON.stringify({ id: m.id, type: "error", payload: it.errors }));
      }
      if (m.type === "complete" || m.type === "stop") ws.stopSub?.();
      if (m.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const addr = `127.0.0.1:${server.address().port}`;
  return { http: `http://${addr}/graphql`, ws: `ws://${addr}/graphql`, seen, stop: () => { for (const c of wss.clients) c.terminate(); wss.close(); server.close(); } };
}
