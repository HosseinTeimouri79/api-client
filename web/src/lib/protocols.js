import { blankReq } from "./http.js";
import { PROTOCOLS as IDS, IMPLEMENTED } from "../../../core/shared/protocols.js";
// Protocols a request can use, as the UI shows them. Which protocols exist and which are implemented comes from
// core/shared/protocols.js; this list adds what only the UI needs. `live` ones keep a connection open (sessions).
const UI = [
  { id: "http", label: "HTTP", tag: "HTTP", icon: "globe", live: false },
  { id: "websocket", label: "WebSocket", tag: "WS", icon: "plug", live: true, urlKey: "ws.urlPlaceholder", firstTab: "message", actionKeys: ["rt.connect", "rt.disconnect"], detailsKey: "rt.handshake", gracefulClose: "close" },
  { id: "grpc", label: "gRPC", tag: "gRPC", icon: "diagram-project", live: true, urlKey: "grpc.urlPlaceholder", firstTab: "message", actionKeys: ["grpc.invoke", "grpc.cancel"], detailsKey: "rt.metadata", gracefulClose: "cancel" },
  { id: "graphql", label: "GraphQL", tag: "GQL", icon: "circle-nodes", live: false, noMethod: true, urlKey: "gql.urlPlaceholder", firstTab: "query", actionKeys: ["gql.subscribe", "gql.unsubscribe"], detailsKey: "rt.handshake", gracefulClose: "stop" },
  { id: "sse", label: "SSE", tag: "SSE", icon: "tower-broadcast", live: true, methods: ["GET", "POST"], urlKey: "sse.urlPlaceholder", firstTab: "params", actionKeys: ["sse.start", "sse.stop"], detailsKey: "rt.response", gracefulClose: "close" },
  { id: "tcp", label: "TCP", tag: "TCP", icon: "network-wired", live: true, urlKey: "tcp.urlPlaceholder", firstTab: "message", actionKeys: ["rt.connect", "rt.disconnect"], detailsKey: "rt.connection", gracefulClose: "close" },
  { id: "udp", label: "UDP", tag: "UDP", icon: "satellite-dish", live: true, urlKey: "udp.urlPlaceholder", firstTab: "message", actionKeys: ["udp.open", "udp.close"], detailsKey: "rt.connection", gracefulClose: "close" },
  { id: "mqtt", label: "MQTT", tag: "MQTT", icon: "rss", live: true, urlKey: "mqtt.urlPlaceholder", firstTab: "publish", actionKeys: ["rt.connect", "rt.disconnect"], detailsKey: "rt.connection", gracefulClose: "disconnect" },
  { id: "amqp", label: "AMQP", tag: "AMQP", icon: "envelope", live: true, urlKey: "amqp.urlPlaceholder", firstTab: "publish", actionKeys: ["rt.connect", "rt.disconnect"], detailsKey: "rt.connection", gracefulClose: "disconnect" },
];
export const PROTOCOLS = IDS.map((id) => {
  const p = UI.find((x) => x.id === id);
  if (!p) throw new Error(`No UI for protocol ${id}`);
  return { ...p, implemented: IMPLEMENTED.includes(id) };
});
export const protocolOf = (id) => PROTOCOLS.find((p) => p.id === id) ?? PROTOCOLS[0];
export const firstTab = (req) => protocolOf(req?.protocol).firstTab ?? "params";
export const isLive = (req) => !!protocolOf(req?.protocol).live;
/** A tab that holds a connection: live protocols, and GraphQL while the selected operation is a subscription. */
export const liveTab = (tab) => isLive(tab?.req) || (tab?.req?.protocol === "graphql" && tab.gql?.current?.type === "subscription");
/** What a request looks like after switching to another protocol (the URL and common parts stay). */
export const PROTOCOL_DEFAULTS = {
  http: {},
  websocket: { subprotocols: "", message: "", messageFormat: "text" },
  graphql: { query: "", variables: "", operationName: "", httpMethod: "POST", transport: "graphql-transport-ws", wsUrl: "", connectionParams: "" },
  amqp: { username: "", password: "", heartbeat: 30, tlsInsecure: false, exchange: "", routingKey: "", payload: "", payloadFormat: "text", contentType: "", deliveryMode: 1, correlationId: "", replyTo: "", messageId: "", expiration: "", type: "", headers: "", mandatory: false, queue: "", declareQueue: true, durable: false, exclusive: false, autoDelete: false, bindExchange: "", bindKey: "", exchangeType: "", prefetch: 10, noAck: false },
  mqtt: { clientId: "", username: "", password: "", protocolVersion: 4, keepalive: 60, clean: true, tlsInsecure: false, willTopic: "", willPayload: "", willQos: 0, willRetain: false, topic: "", payload: "", payloadFormat: "text", qos: 0, retain: false, subTopic: "", subQos: 0 },
  udp: { message: "", messageFormat: "text", lineEnding: "none", mode: "client", bindPort: 0, onlyFromTarget: true },
  tcp: { message: "", messageFormat: "text", lineEnding: "none", tlsInsecure: false, servername: "" },
  sse: { reconnect: false, maxReconnects: 10 },
  grpc: { proto: "", service: "", method: "", message: "{}", tlsInsecure: false, deadlineMs: 0 },
};

/** A fresh, unsaved request of the given protocol with that protocol's default settings. */
export const blankReqFor = (protocol = "http") => ({
  ...blankReq(),
  protocol,
  protocol_data: { ...PROTOCOL_DEFAULTS[protocol] },
  method: protocol === "graphql" ? "POST" : "GET",
});
