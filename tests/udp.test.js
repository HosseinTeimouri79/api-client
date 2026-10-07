// UDP: send datagrams and read answers, or listen on an allowed local port, through live sessions.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import dgram from "node:dgram";
import { openDb } from "../src/db/index.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";

let server, app, base, echo, other, tok, ws;
const served = [];
const bind = (type = "udp4") => new Promise((ok) => { const s = dgram.createSocket(type); s.bind(0, "127.0.0.1", () => ok(s)); });
const freePort = async () => { const s = await bind(); const p = s.address().port; await new Promise((r) => s.close(r)); return p; };

before(async () => {
  config.allowPrivateTargets = true;
  app = createApp(openDb(":memory:"));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  echo = await bind();
  other = await bind(); // answers from a different port than the one we sent to
  echo.on("message", (m, r) => {
    served.push(m.toString("hex"));
    const text = m.toString();
    if (text === "stranger") other.send("from a stranger", r.port, r.address);
    else echo.send(Buffer.concat([Buffer.from("echo:"), m]), r.port, r.address);
  });
  tok = (await (await fetch(base + "/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "udpuser", password: "password123" }) })).json()).token;
  ws = (await call("POST", "/workspaces", { name: "W" })).body.id;
});
after(() => { config.udpListenPorts = []; app.locals.sessions.closeAll(); server.close(); echo.close(); other.close(); });
const call = async (m, p, b) => {
  const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: b && JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const open = (url, data = {}, more = {}) =>
  call("POST", `/workspaces/${ws}/sessions`, { request: { protocol: "udp", method: "GET", url, params: [], headers: [], protocol_data: data }, ...more });
const act = (id, action, payload) => call("POST", `/workspaces/${ws}/sessions/${id}/act`, { action, payload });
async function events(id, until = (e) => e.some((x) => x.type === "closed")) {
  const ctl = new AbortController();
  const res = await fetch(`${base}/workspaces/${ws}/sessions/${id}/events`, { headers: { authorization: `Bearer ${tok}` }, signal: ctl.signal });
  const out = [];
  let buf = "";
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    for await (const chunk of res.body) {
      buf += Buffer.from(chunk).toString();
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const d = buf.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
        buf = buf.slice(i + 2);
        if (d && d.length > 8) out.push(JSON.parse(d.slice(6)));
      }
      if (until(out)) break;
    }
  } catch (e) { if (e.name !== "AbortError") throw e; } finally { clearTimeout(timer); ctl.abort(); }
  return out;
}
const got = (text) => (evs) => evs.some((e) => e.type === "message" && e.direction === "in" && e.data === text);
const target = () => `udp://127.0.0.1:${echo.address().port}`;

test("send a datagram and read the answer, with the peer addresses", async () => {
  const r = await open(target());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await act(r.body.id, "send", { data: "hello" })).status, 200);
  assert.equal((await act(r.body.id, "send", { data: "line", lineEnding: "crlf" })).status, 200);
  const evs = await events(r.body.id, got("echo:line\r\n"));
  const msgs = evs.filter((e) => e.type === "message").map((e) => [e.direction, e.data, e.peer]);
  const me = `127.0.0.1:${echo.address().port}`;
  assert.deepEqual(msgs.slice(0, 2), [["out", "hello", me], ["in", "echo:hello", me]]);
  const rows = Object.fromEntries(evs.find((e) => e.type === "open").headers.map((h) => [h.key, h.value]));
  assert.match(rows["Local address"], /^0\.0\.0\.0:\d+$/);
  assert.equal(rows.Target, me);
  assert.equal(rows.Mode, "client");
  await call("DELETE", `/workspaces/${ws}/sessions/${r.body.id}`);
});

test("binary datagrams (hex, base64), variables, a bare host:port, size limit", async () => {
  const r = await call("POST", `/workspaces/${ws}/sessions`, { request: { protocol: "udp", url: "{{t}}", variables: [{ key: "t", value: `127.0.0.1:${echo.address().port}` }, { key: "w", value: "x" }], protocol_data: {} } });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  const id = r.body.id;
  await act(id, "send", { data: "de ad be ef", format: "hex" });
  await act(id, "send", { data: "AAEC", format: "base64" });
  await act(id, "send", { data: "v={{w}}" });
  const evs = await events(id, got("echo:v=x"));
  assert.ok(served.includes("deadbeef") && served.includes("000102"));
  const bin = evs.filter((e) => e.type === "message" && e.direction === "in" && e.binary);
  assert.equal(bin[0].data, Buffer.concat([Buffer.from("echo:"), Buffer.from("deadbeef", "hex")]).toString("base64"));
  assert.equal((await act(id, "send", { data: "x".repeat(65508) })).status, 400);
  assert.equal((await act(id, "send", { data: "zz", format: "hex" })).status, 400);
  await call("DELETE", `/workspaces/${ws}/sessions/${id}`);
});

test("datagrams from other sources are ignored unless that is switched off", async () => {
  const a = (await open(target())).body.id;
  await act(a, "send", { data: "stranger" });
  const evsA = await events(a, (e) => e.some((x) => x.type === "ignored"));
  assert.match(evsA.find((e) => e.type === "ignored").text, /not the target/);
  assert.ok(!evsA.some((e) => e.type === "message" && e.direction === "in"));
  const b = (await open(target(), { onlyFromTarget: false })).body.id;
  await act(b, "send", { data: "stranger" });
  const evsB = await events(b, got("from a stranger"));
  assert.equal(evsB.find((e) => e.direction === "in").peer, `127.0.0.1:${other.address().port}`);
  for (const id of [a, b]) await call("DELETE", `/workspaces/${ws}/sessions/${id}`);
});

test("close ends the session and frees the socket", async () => {
  const id = (await open(target())).body.id;
  assert.equal((await act(id, "close")).status, 200);
  const evs = await events(id);
  assert.equal(evs.at(-1).reason, "closed by you");
  assert.equal((await act(id, "send", { data: "late" })).status, 409);
});

test("listening: off by default, only on allowed ports, receives datagrams and can answer a target", async () => {
  const off = await open("", { mode: "listen", bindPort: 40001 });
  assert.match(off.body.error.message, /turned off.*UDP_LISTEN_PORTS/);
  const port = await freePort();
  config.udpListenPorts = [[port, port]];
  assert.match((await open("", { mode: "listen", bindPort: 0 })).body.error.message, /not allowed for listening/);
  assert.match((await open("", { mode: "listen", bindPort: port + 1 })).body.error.message, new RegExp(`allowed: ${port}$`));
  const r = await open("", { mode: "listen", bindPort: port });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match((await open("", { mode: "listen", bindPort: port })).body.error.message, /already in use/);
  const sender = await bind();
  sender.send("ping from outside", port, "127.0.0.1");
  const evs = await events(r.body.id, got("ping from outside"));
  const msg = evs.find((e) => e.direction === "in");
  assert.equal(msg.peer, `127.0.0.1:${sender.address().port}`);
  assert.equal(Object.fromEntries(evs.find((e) => e.type === "open").headers.map((h) => [h.key, h.value])).Mode, "listen");
  assert.equal((await act(r.body.id, "send", { data: "x" })).status, 400, "no target to send to");
  sender.close();
  await call("DELETE", `/workspaces/${ws}/sessions/${r.body.id}`);
  // with a target the listener can also send
  const l2 = await open(target(), { mode: "listen", bindPort: port });
  assert.equal(l2.body.ok, true, JSON.stringify(l2.body));
  await act(l2.body.id, "send", { data: "from listener" });
  assert.ok((await events(l2.body.id, got("echo:from listener"))).length > 0);
  await call("DELETE", `/workspaces/${ws}/sessions/${l2.body.id}`);
  config.udpListenPorts = [];
});

test("errors: no port, bad scheme, unresolvable host, SSRF", async () => {
  assert.match((await open("udp://localhost")).body.error.message, /needs a port/);
  assert.match((await open("tcp://127.0.0.1:5")).body.error.message, /Unsupported scheme/);
  assert.match((await open("udp://no-such-host.invalid:5")).body.error.message, /ENOTFOUND|getaddrinfo|not found/i);
  config.allowPrivateTargets = false;
  try {
    for (const url of [target(), `udp://localhost:${echo.address().port}`]) {
      const r = await open(url);
      assert.equal(r.body.ok, false, url);
      assert.match(r.body.error.message, /private|internal|SSRF/i);
    }
  } finally { config.allowPrivateTargets = true; }
});

test("saved UDP requests keep their settings", async () => {
  const col = (await call("POST", `/workspaces/${ws}/collections`, { name: "C" })).body.id;
  const made = await call("POST", `/workspaces/${ws}/collections/${col}/requests`, { name: "U", protocol: "udp", url: target(), protocol_data: { mode: "listen", bindPort: 40010 } });
  assert.equal(made.status, 201);
  assert.deepEqual(made.body.protocol_data, { mode: "listen", bindPort: 40010 });
});
