// An in-process MQTT broker (aedes) reachable over TCP, TLS and WebSocket, with a user name / password check.
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import { Aedes } from "aedes";
import { WebSocketServer, createWebSocketStream } from "ws";
import { selfSigned } from "./tls.js";

export async function startBroker({ user = "user", password = "pw" } = {}) {
  const broker = await Aedes.createBroker();
  const seen = { clients: [], wills: [] };
  broker.authenticate = (client, username, pass, cb) => {
    if (username === undefined || username === user) {
      if (username === undefined || pass?.toString() === password) return cb(null, true);
    }
    const e = new Error("Auth error");
    e.returnCode = 4;
    cb(e, false);
  };
  broker.on("client", (c) => seen.clients.push(c.id));
  const tcp = net.createServer(broker.handle).listen(0, "127.0.0.1");
  const httpSrv = http.createServer().listen(0, "127.0.0.1");
  const wss = new WebSocketServer({ server: httpSrv, handleProtocols: (set) => (set.has("mqtt") ? "mqtt" : false) });
  wss.on("connection", (ws) => broker.handle(createWebSocketStream(ws)));
  const cert = selfSigned();
  const tlsSrv = cert ? tls.createServer({ key: cert.key, cert: cert.cert }, broker.handle).listen(0, "127.0.0.1") : null;
  await new Promise((r) => setTimeout(r, 50));
  return {
    broker, seen,
    tcp: `mqtt://127.0.0.1:${tcp.address().port}`,
    ws: `ws://127.0.0.1:${httpSrv.address().port}`,
    tls: tlsSrv ? `mqtts://127.0.0.1:${tlsSrv.address().port}` : null,
    stop: async () => { for (const c of wss.clients) c.terminate(); wss.close(); httpSrv.close(); tcp.close(); tlsSrv?.close(); await new Promise((r) => broker.close(r)); },
  };
}
