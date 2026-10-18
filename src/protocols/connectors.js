import { connectWebSocket } from "./websocket.js";
import { connectGrpc } from "./grpc.js";
import { connectSubscription } from "./graphql.js";
import { connectSse } from "./sse.js";
import { connectTcp } from "./tcp.js";
import { connectUdp } from "./udp.js";
import { connectMqtt } from "./mqtt.js";
import { connectAmqp } from "./amqp.js";

// One connector per live protocol: (context) -> Promise<driver>. Used by the server's live sessions and by the Local Agent.
export const CONNECTORS = { websocket: connectWebSocket, grpc: connectGrpc, graphql: connectSubscription, sse: connectSse, tcp: connectTcp, udp: connectUdp, mqtt: connectMqtt, amqp: connectAmqp };

/** Why opening a connection failed, as the UI shows it (a normal outcome, not a server error). */
export const connectFailure = (e) => ({
  phase: e.phase ?? "network", message: e.message, status: e.status ?? null, body: e.body ?? null,
  headers: Object.entries(e.headers ?? {}).map(([key, value]) => ({ key, value: String(value) })),
});
