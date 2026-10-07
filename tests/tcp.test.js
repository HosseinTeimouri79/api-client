// TCP: connect, send, receive and close through live sessions, plain and TLS.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import tls from "node:tls";
import { selfSigned } from "./fixtures/tls.js";
import { openDb } from "../src/db/index.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";

let server, base, app, tcp, tlsSrv, tok, ws;
const served = [];
const handler = (label) => (s) => {
  s.setNoDelay(true); // without it Nagle holds a second small write back for ~40 ms
  served.push({ label, remote: s.remoteAddress });
  s.write("hello\r\n");
  s.on("data", (d) => {
    const text = d.toString("latin1");
    served.push({ label, got: d.toString("hex") });
    if (text.startsWith("bin")) s.write(Buffer.from([0, 1, 2, 255, 254]));
    else if (text.startsWith("slow")) { s.write("par"); setImmediate(() => s.write("ts")); } // two chunks, shown as one message
    else if (text.startsWith("quit")) s.end("bye\n");
    else if (text.startsWith("flood")) s.write(Buffer.alloc(5000, 97));
    else s.write("echo:" + d);
  });
  s.on("error", () => {});
};
const cert = selfSigned();

before(async () => {
  config.allowPrivateTargets = true;
  app = createApp(openDb(":memory:"));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  tcp = net.createServer(handler("tcp")).listen(0, "127.0.0.1");
  if (cert) tlsSrv = tls.createServer({ key: cert.key, cert: cert.cert }, handler("tls")).listen(0, "127.0.0.1");
  await new Promise((r) => setTimeout(r, 50));
  tok = (await (await fetch(base + "/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "tcpuser", password: "password123" }) })).json()).token;
  ws = (await call("POST", "/workspaces", { name: "W" })).body.id;
});
after(() => { app.locals.sessions.closeAll(); server.close(); tcp.close(); tlsSrv?.close(); });
const call = async (m, p, b) => {
  const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: b && JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const addr = (s) => `127.0.0.1:${s.address().port}`;
const open = (url, data = {}, more = {}) =>
  call("POST", `/workspaces/${ws}/sessions`, { request: { protocol: "tcp", method: "GET", url, params: [], headers: [], protocol_data: data }, ...more });
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
const got = (text) => (evs) => evs.some((e) => e.type === "message" && e.direction === "in" && e.data?.includes(text));
const inbound = (evs) => evs.filter((e) => e.type === "message" && e.direction === "in").map((e) => e.data);

test("connect, banner, send text with and without line endings, variables", async () => {
  const r = await open(`tcp://${addr(tcp)}`);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.id;
  await act(id, "send", { data: "ping" });
  await act(id, "send", { data: "line", lineEnding: "crlf" });
  await act(id, "send", { data: "lf", lineEnding: "lf" });
  const evs = await events(id, got("echo:lf\n"));
  assert.equal(evs.find((e) => e.type === "open").headers.find((h) => h.key === "Remote address").value, addr(tcp));
  assert.equal(evs.filter((e) => e.type === "message" && e.direction === "out").map((e) => e.data).join("|"), "ping|line\r\n|lf\n");
  assert.ok(inbound(evs).join("").startsWith("hello\r\n"));
  assert.ok(inbound(evs).join("").includes("echo:ping"));
  assert.ok(served.some((s) => s.got === Buffer.from("line\r\n").toString("hex")));
  await call("DELETE", `/workspaces/${ws}/sessions/${id}`);
});

test("variables in the address and in messages; bare host:port defaults to tcp", async () => {
  const r = await call("POST", `/workspaces/${ws}/sessions`, { request: { protocol: "tcp", url: "{{h}}", variables: [{ key: "h", value: addr(tcp) }, { key: "w", value: "world" }], protocol_data: {} } });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  await act(r.body.id, "send", { data: "hi {{w}}" });
  assert.ok(inbound(await events(r.body.id, got("echo:hi world"))).join("").includes("echo:hi world"));
  await call("DELETE", `/workspaces/${ws}/sessions/${r.body.id}`);
});

test("binary data both ways: hex and base64 in, base64 out when it is not text", async () => {
  const id = (await open(`tcp://${addr(tcp)}`)).body.id;
  await events(id, got("hello"));
  await act(id, "send", { data: "62 69 6e 00 ff", format: "hex" }); // "bin\0\xff"
  const evs = await events(id, (e) => e.some((x) => x.type === "message" && x.direction === "in" && x.binary));
  const out = evs.find((e) => e.direction === "out");
  assert.deepEqual([out.binary, out.data], [true, Buffer.from([0x62, 0x69, 0x6e, 0, 255]).toString("base64")]);
  const reply = evs.find((e) => e.direction === "in" && e.binary);
  assert.equal(reply.data, Buffer.from([0, 1, 2, 255, 254]).toString("base64"));
  assert.equal(reply.size, 5);
  assert.ok(served.some((s) => s.got === "62696e00ff"));
  await act(id, "send", { data: "AAEC", format: "base64" }); // 00 01 02: not text, so the echo is binary too
  const echoed = Buffer.concat([Buffer.from("echo:"), Buffer.from([0, 1, 2])]).toString("base64");
  await events(id, (e) => e.some((x) => x.type === "message" && x.direction === "in" && x.data === echoed));
  assert.equal((await act(id, "send", { data: "zz", format: "hex" })).status, 400);
  await call("DELETE", `/workspaces/${ws}/sessions/${id}`);
});

test("chunks that arrive together are one message", async () => {
  const id = (await open(`tcp://${addr(tcp)}`)).body.id;
  await events(id, got("hello"));
  await act(id, "send", { data: "slow" });
  const evs = await events(id, got("parts"));
  assert.deepEqual(inbound(evs).filter((m) => m.includes("par")), ["parts"], JSON.stringify(inbound(evs)));
  await call("DELETE", `/workspaces/${ws}/sessions/${id}`);
});

test("the server closing the connection ends the session; close ends it from our side", async () => {
  const a = (await open(`tcp://${addr(tcp)}`)).body.id;
  await act(a, "send", { data: "quit" });
  const evs = await events(a);
  assert.ok(evs.some((e) => e.type === "end"));
  assert.equal(evs.at(-1).type, "closed");
  assert.match(evs.at(-1).reason, /server closed the connection/);
  assert.ok(inbound(evs).join("").includes("bye\n"));
  const b = (await open(`tcp://${addr(tcp)}`)).body.id;
  await events(b, got("hello"));
  assert.equal((await act(b, "close")).status, 200);
  const evs2 = await events(b);
  assert.ok(evs2.some((e) => e.type === "closing"));
  assert.equal(evs2.at(-1).reason, "closed by you");
  assert.equal((await act(b, "send", { data: "late" })).status, 409);
});

test("the response limit stops a flood", async () => {
  const id = (await open(`tcp://${addr(tcp)}`, {}, { limits: { maxResponseBytes: 1000 } })).body.id;
  await act(id, "send", { data: "flood" });
  const evs = await events(id);
  assert.ok(evs.some((e) => e.type === "error" && /more than the response limit/.test(e.message)));
  assert.equal(evs.at(-1).type, "closed");
});

test("TLS: certificate details, trust check, and the options to skip verification or set the name", { skip: !cert && "openssl not available" }, async () => {
  const url = `tls://${addr(tlsSrv)}`;
  const strict = await open(url);
  assert.equal(strict.body.ok, false);
  assert.match(strict.body.error.message, /self[- ]signed|unable to verify|certificate/i);
  const loose = await open(url, { tlsInsecure: true });
  assert.equal(loose.body.ok, true, JSON.stringify(loose.body));
  await act(loose.body.id, "send", { data: "secure" });
  const evs = await events(loose.body.id, got("echo:secure"));
  const rows = Object.fromEntries(evs.find((e) => e.type === "open").headers.map((h) => [h.key, h.value]));
  assert.match(rows["TLS version"], /TLSv1\.[23]/);
  assert.match(rows["Certificate subject"], /localhost/);
  assert.match(rows["Certificate trusted"], /^no/);
  assert.equal(evs.find((e) => e.type === "open").url, `tls://${addr(tlsSrv)}`);
  await call("DELETE", `/workspaces/${ws}/sessions/${loose.body.id}`);
  // aliases and SNI override
  for (const scheme of ["tcps", "ssl"]) assert.equal((await open(`${scheme}://${addr(tlsSrv)}`, { tlsInsecure: true })).body.ok, true, scheme);
  const named = await open(`tls://${addr(tlsSrv)}`, { servername: "localhost" });
  assert.equal(named.body.ok, false, "a self-signed certificate is still untrusted");
});

test("errors: no port, unreachable, bad scheme, SSRF", async () => {
  assert.match((await open("tcp://localhost")).body.error.message, /needs a port/);
  assert.match((await open("tcp://127.0.0.1:1")).body.error.message, /refused/i);
  assert.match((await open("http://127.0.0.1:80")).body.error.message, /Unsupported scheme/);
  assert.match((await open("")).body.error.message, /Invalid URL|needs a port/);
  config.allowPrivateTargets = false;
  try {
    for (const url of [`tcp://${addr(tcp)}`, `tcp://localhost:${tcp.address().port}`]) {
      const r = await open(url);
      assert.equal(r.body.ok, false, url);
      assert.match(r.body.error.message, /private|internal|SSRF/i);
    }
  } finally { config.allowPrivateTargets = true; }
});

test("saved TCP requests keep their settings", async () => {
  const col = (await call("POST", `/workspaces/${ws}/collections`, { name: "C" })).body.id;
  const made = await call("POST", `/workspaces/${ws}/collections/${col}/requests`, { name: "T", protocol: "tcp", url: `tcp://${addr(tcp)}`, protocol_data: { message: "hi", lineEnding: "lf" } });
  assert.equal(made.status, 201);
  assert.deepEqual(made.body.protocol_data, { message: "hi", lineEnding: "lf" });
});
