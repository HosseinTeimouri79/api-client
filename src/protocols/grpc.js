import * as grpc from "@grpc/grpc-js";
import protobuf from "protobufjs";
import { z } from "zod";
import { resolvePublicAddress } from "../services/ssrf.js";
import { effectiveLimits } from "../services/executor.js";
import { config } from "../config.js";
import { resolve as resolveVars } from "../services/variables.js";
import { prepareTarget } from "./common.js";

export const GrpcData = z.object({
  proto: z.string().max(500_000).default(""), // one .proto file; Google's well-known types (Timestamp, Any, ...) are built in
  service: z.string().max(300).default(""), // fully qualified, e.g. "helloworld.Greeter"
  method: z.string().max(200).default(""),
  message: z.string().max(1_000_000).default("{}"), // JSON for the request message
  tlsInsecure: z.boolean().default(false), // skip certificate verification (self-signed test servers)
  deadlineMs: z.number().int().min(0).max(3_600_000).default(0), // 0 = the request timeout from Settings (unary) or none (streams)
});

const SCHEMES = { grpc: "grpc", grpcs: "grpcs", http: "grpc", https: "grpcs" };
const NAMES = Object.fromEntries(Object.entries(grpc.status).map(([k, v]) => [v, k]));

/** Parses a .proto held in memory (imports of Google's built-in types work; other imports are refused). */
export function loadProto(text) {
  const root = new protobuf.Root();
  root.resolvePath = (_origin, target) => target;
  root.fetch = (path, cb) => setImmediate(() => (path === "main.proto" ? cb(null, text) : cb(new Error(`import "${path}" is not available (only Google's well-known types can be imported)`))));
  return new Promise((ok, no) =>
    root.load("main.proto", { keepCase: true }, (e, r) => {
      if (e) return no(e);
      try { r.resolveAll(); ok(r); } catch (err) { no(err); }
    }),
  );
}

const OPTS = { longs: String, enums: String, bytes: String, defaults: true, oneofs: true };

/** An example JSON value for a message type (fields with their zero values, nested messages up to a few levels). */
export function sampleMessage(type, depth = 0) {
  const out = {};
  for (const f of type.fieldsArray) {
    f.resolve();
    let v;
    if (f.resolvedType instanceof protobuf.Enum) v = Object.keys(f.resolvedType.values)[0];
    else if (f.resolvedType) v = depth >= 3 ? {} : sampleMessage(f.resolvedType, depth + 1);
    else v = f.type === "string" ? "" : f.type === "bool" ? false : f.type === "bytes" ? "" : /64/.test(f.type) ? "0" : 0;
    out[f.name] = f.map ? {} : f.repeated ? [] : v;
  }
  return out;
}

function services(root) {
  const out = [];
  const walk = (ns) => {
    for (const n of ns.nestedArray ?? []) {
      if (n instanceof protobuf.Service) out.push(n);
      else if (n.nestedArray) walk(n);
    }
  };
  walk(root);
  return out;
}

export async function describeProto(text) {
  if (!text.trim()) return { ok: true, services: [] };
  try {
    const root = await loadProto(text);
    return {
      ok: true,
      services: services(root).map((s) => ({
        name: s.fullName.replace(/^\./, ""),
        methods: s.methodsArray.map((m) => {
          m.resolve();
          return { name: m.name, input: m.resolvedRequestType.fullName.slice(1), output: m.resolvedResponseType.fullName.slice(1), clientStreaming: !!m.requestStream, serverStreaming: !!m.responseStream, example: sampleMessage(m.resolvedRequestType) };
        }),
      })),
    };
  } catch (e) {
    return { ok: false, error: String(e.message ?? e).slice(0, 500) };
  }
}

const fail = (message, phase = "validation") => Object.assign(new Error(message), { phase });
const shown = (o) => JSON.stringify(o, null, 2);
const metaText = (md) => Object.entries(md.getMap()).map(([k, v]) => `${k}=${Buffer.isBuffer(v) ? v.toString("base64") : v}`).join("  ");
const metaList = (md) => Object.entries(md.getMap()).map(([key, v]) => ({ key, value: Buffer.isBuffer(v) ? v.toString("base64") : String(v) }));

/** Waits for the channel to become ready; fails fast when the server refuses or cannot be reached. */
function whenReady(client, timeoutMs) {
  const ch = client.getChannel();
  const deadline = Date.now() + timeoutMs;
  return new Promise((ok, no) => {
    const step = (state) => {
      const now = ch.getConnectivityState(true);
      if (now === grpc.connectivityState.READY) return ok();
      if (now === grpc.connectivityState.TRANSIENT_FAILURE || now === grpc.connectivityState.SHUTDOWN) return no(new Error("Connection failed: the server refused the connection or could not be reached"));
      if (Date.now() >= deadline) return no(Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" }));
      ch.watchConnectivityState(state ?? now, Math.min(deadline, Date.now() + 250), () => step(ch.getConnectivityState(false)));
    };
    step();
  });
}

/** Starts a gRPC call (unary, server streaming, client streaming or bidirectional, from the method's definition). */
export async function connectGrpc({ request, inherited, data, limits, ctx, vars }) {
  const cfg = GrpcData.parse(data ?? {});
  if (!cfg.proto.trim()) throw fail("Paste the service's .proto first (Proto tab)");
  const { url, headers } = prepareTarget(request, inherited, { schemes: SCHEMES, defaultScheme: "grpc" });
  let root;
  try { root = await loadProto(cfg.proto); } catch (e) { throw fail(`Invalid .proto: ${e.message}`); }
  const service = services(root).find((s) => s.fullName.replace(/^\./, "") === cfg.service);
  if (!service) throw fail(cfg.service ? `Service "${cfg.service}" is not in the .proto` : "Choose a service and method");
  const method = service.methods[cfg.method];
  if (!method) throw fail(cfg.method ? `Method "${cfg.method}" is not in ${cfg.service}` : "Choose a method");
  method.resolve();
  const In = method.resolvedRequestType, Out = method.resolvedResponseType;
  const clientStream = !!method.requestStream, serverStream = !!method.responseStream;
  const lim = effectiveLimits(limits);
  const tls = url.protocol === "grpcs:";
  const port = url.port || (tls ? "443" : "80");
  const authority = `${url.hostname}:${port}`;

  const toBuffer = (text) => {
    let obj;
    try { obj = JSON.parse(resolveVars(text ?? "", vars ?? {}) || "{}"); } catch (e) { throw fail(`The message is not valid JSON: ${e.message}`); }
    try { return { obj, buf: Buffer.from(In.encode(In.fromObject(obj)).finish()) }; } catch (e) { throw fail(`The message does not fit ${In.name}: ${e.message}`); }
  };
  const first = clientStream ? null : toBuffer(cfg.message); // validated before connecting

  const md = new grpc.Metadata();
  try {
    for (const [k, v] of Object.entries(headers)) {
      const key = k.toLowerCase();
      md.add(key, key.endsWith("-bin") ? Buffer.from(v, "base64") : v);
    }
  } catch (e) { throw fail(`Invalid metadata: ${e.message}`); }

  const addr = await resolvePublicAddress(url.hostname); // the address we connect to is the one we validated
  const target = `${addr.family === 6 ? `[${addr.address}]` : addr.address}:${port}`;
  const creds = tls ? grpc.credentials.createSsl(undefined, undefined, undefined, cfg.tlsInsecure ? { rejectUnauthorized: false, checkServerIdentity: () => undefined } : undefined) : grpc.credentials.createInsecure();
  const maxMsg = Number.isFinite(lim.maxBytes) ? lim.maxBytes : -1;
  const client = new grpc.Client(target, creds, {
    "grpc.default_authority": authority,
    ...(tls && { "grpc.ssl_target_name_override": url.hostname }),
    "grpc.enable_http_proxy": 0,
    "grpc.max_receive_message_length": maxMsg,
    "grpc.max_send_message_length": maxMsg,
  });
  try {
    await whenReady(client, Math.min(config.connectAttemptTimeoutMs * 2, Number.isFinite(lim.timeoutMs) ? lim.timeoutMs : Infinity));
  } catch (e) {
    client.close();
    throw Object.assign(e, { message: `${e.message} (${authority})` });
  }

  const path = `/${cfg.service}/${cfg.method}`;
  const ser = (obj) => Buffer.from(In.encode(In.fromObject(obj)).finish());
  const de = (buf) => Out.toObject(Out.decode(buf), OPTS);
  const deadlineMs = cfg.deadlineMs || (clientStream || serverStream ? 0 : Number.isFinite(lim.timeoutMs) ? lim.timeoutMs : 0);
  const callOpts = deadlineMs ? { deadline: Date.now() + deadlineMs } : {};
  let ended = false;
  const message = (direction, obj) => {
    const text = shown(obj);
    ctx.emit("message", { direction, binary: false, size: Buffer.byteLength(text), data: text });
  };
  const onStatus = (st) => {
    if (ended) return;
    ended = true;
    ctx.emit("trailers", { headers: metaList(st.metadata), text: metaText(st.metadata) });
    client.close();
    ctx.finish({ code: st.code, reason: `${NAMES[st.code] ?? st.code}${st.details ? `: ${st.details}` : ""}`, ok: st.code === 0 });
  };
  const wire = (call) => {
    call.on("metadata", (m) => ctx.emit("headers", { headers: metaList(m), text: metaText(m) }));
    call.on("status", onStatus);
    call.on("error", () => {}); // the status event carries the outcome
    return call;
  };
  let call;
  if (!clientStream && !serverStream) {
    call = wire(client.makeUnaryRequest(path, ser, de, first.obj, md, callOpts, (err, res) => { if (!err) message("in", res); }));
  } else if (!clientStream) {
    call = wire(client.makeServerStreamRequest(path, ser, de, first.obj, md, callOpts));
    call.on("data", (res) => message("in", res));
  } else if (!serverStream) {
    call = wire(client.makeClientStreamRequest(path, ser, de, md, callOpts, (err, res) => { if (!err) message("in", res); }));
  } else {
    call = wire(client.makeBidiStreamRequest(path, ser, de, md, callOpts));
    call.on("data", (res) => message("in", res));
  }
  ctx.emit("open", { url: `${url.protocol}//${authority}${path}`, kind: clientStream ? (serverStream ? "bidi" : "client") : serverStream ? "server" : "unary", headers: metaList(md), status: null });
  if (first) message("out", first.obj);

  return {
    async act(action, p) {
      if (ended) throw new Error("The call has finished");
      if (action === "send") {
        if (!clientStream) throw new Error("This method takes a single request message (sent when invoked)");
        const { obj } = toBuffer(z.object({ data: z.string().max(10_000_000).default("{}") }).parse(p).data);
        await new Promise((ok, no) => call.write(obj, (e) => (e ? no(e) : ok())));
        message("out", obj);
      } else if (action === "end") {
        if (!clientStream) throw new Error("This method has nothing to end: the request was sent when invoked");
        call.end();
        ctx.emit("ended", {});
      } else if (action === "cancel") {
        call.cancel();
      } else throw new Error(`Unknown action "${action}"`);
      return { ok: true };
    },
    close() {
      try { call.cancel(); } catch { /* finished */ }
      client.close();
    },
  };
}
