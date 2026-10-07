// Protocols a request can use. `live` ones keep a connection open (sessions) instead of one request/response.
// Keep `implemented` in line with src/protocols/index.js (tests/protocols.test.js checks it).
export const PROTOCOLS = [
  { id: "http", label: "HTTP", tag: "HTTP", icon: "globe", live: false, implemented: true },
  { id: "websocket", label: "WebSocket", tag: "WS", icon: "plug", live: true, implemented: true, urlKey: "ws.urlPlaceholder", firstTab: "message", actionKeys: ["rt.connect", "rt.disconnect"], detailsKey: "rt.handshake", gracefulClose: "close" },
  { id: "grpc", label: "gRPC", tag: "gRPC", icon: "diagram-project", live: true, implemented: true, urlKey: "grpc.urlPlaceholder", firstTab: "message", actionKeys: ["grpc.invoke", "grpc.cancel"], detailsKey: "rt.metadata", gracefulClose: "cancel" },
  { id: "graphql", label: "GraphQL", tag: "GQL", icon: "circle-nodes", live: false, implemented: true, noMethod: true, urlKey: "gql.urlPlaceholder", firstTab: "query", actionKeys: ["gql.subscribe", "gql.unsubscribe"], detailsKey: "rt.handshake", gracefulClose: "stop" },
  { id: "sse", label: "SSE", tag: "SSE", icon: "tower-broadcast", live: true, implemented: true, methods: ["GET", "POST"], urlKey: "sse.urlPlaceholder", firstTab: "params", actionKeys: ["sse.start", "sse.stop"], detailsKey: "rt.response", gracefulClose: "close" },
  { id: "tcp", label: "TCP", tag: "TCP", icon: "network-wired", live: true, implemented: true, urlKey: "tcp.urlPlaceholder", firstTab: "message", actionKeys: ["rt.connect", "rt.disconnect"], detailsKey: "rt.connection", gracefulClose: "close" },
  { id: "udp", label: "UDP", tag: "UDP", icon: "satellite-dish", live: true, implemented: true, urlKey: "udp.urlPlaceholder", firstTab: "message", actionKeys: ["udp.open", "udp.close"], detailsKey: "rt.connection", gracefulClose: "close" },
  { id: "mqtt", label: "MQTT", tag: "MQTT", icon: "rss", live: true, implemented: true, urlKey: "mqtt.urlPlaceholder", firstTab: "publish", actionKeys: ["rt.connect", "rt.disconnect"], detailsKey: "rt.connection", gracefulClose: "disconnect" },
  { id: "amqp", label: "AMQP", tag: "AMQP", icon: "envelope", live: true, implemented: false },
];
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
  mqtt: { clientId: "", username: "", password: "", protocolVersion: 4, keepalive: 60, clean: true, tlsInsecure: false, willTopic: "", willPayload: "", willQos: 0, willRetain: false, topic: "", payload: "", payloadFormat: "text", qos: 0, retain: false, subTopic: "", subQos: 0 },
  udp: { message: "", messageFormat: "text", lineEnding: "none", mode: "client", bindPort: 0, onlyFromTarget: true },
  tcp: { message: "", messageFormat: "text", lineEnding: "none", tlsInsecure: false, servername: "" },
  sse: { reconnect: false, maxReconnects: 10 },
  grpc: { proto: "", service: "", method: "", message: "{}", tlsInsecure: false, deadlineMs: 0 },
};
