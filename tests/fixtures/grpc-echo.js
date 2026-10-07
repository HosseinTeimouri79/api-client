// A small in-process gRPC server for the tests: unary, failing, slow, server streaming, client streaming and bidirectional methods.
import * as grpc from "@grpc/grpc-js";
import { loadProto } from "../../src/protocols/grpc.js";

export const PROTO = `
syntax = "proto3";
package demo;
import "google/protobuf/timestamp.proto";
enum Color { RED = 0; GREEN = 1; }
message Msg { string text = 1; int64 n = 2; bytes data = 3; Color color = 4; google.protobuf.Timestamp at = 5; repeated string tags = 6; }
service Echo {
  rpc Say(Msg) returns (Msg);
  rpc Fail(Msg) returns (Msg);
  rpc Slow(Msg) returns (Msg);
  rpc Count(Msg) returns (stream Msg);
  rpc Collect(stream Msg) returns (Msg);
  rpc Chat(stream Msg) returns (stream Msg);
}`;

export async function startEchoServer() {
  const root = await loadProto(PROTO);
  const Msg = root.lookupType("demo.Msg");
  const def = {};
  for (const m of root.lookupService("demo.Echo").methodsArray)
    def[m.name] = {
      path: `/demo.Echo/${m.name}`, requestStream: !!m.requestStream, responseStream: !!m.responseStream,
      requestSerialize: (o) => Buffer.from(Msg.encode(Msg.fromObject(o)).finish()), requestDeserialize: (b) => Msg.toObject(Msg.decode(b), { longs: String, defaults: true }),
      responseSerialize: (o) => Buffer.from(Msg.encode(Msg.fromObject(o)).finish()), responseDeserialize: (b) => Msg.toObject(Msg.decode(b), { longs: String, defaults: true }),
    };
  const seenMeta = [];
  const server = new grpc.Server();
  server.addService(def, {
    Say(call, cb) {
      seenMeta.push(call.metadata.getMap());
      call.sendMetadata(new grpc.Metadata());
      const t = new grpc.Metadata();
      t.set("x-trailer", "done");
      cb(null, { ...call.request, text: "hi " + call.request.text, n: String(Number(call.request.n) + 1) }, t);
    },
    Fail(_call, cb) { cb({ code: grpc.status.NOT_FOUND, details: "nope" }); },
    Slow(_call, cb) { setTimeout(() => cb(null, {}), 1500); },
    Count(call) { for (let i = 1; i <= Number(call.request.n); i++) call.write({ text: `#${i}`, n: String(i) }); call.end(); },
    Collect(call, cb) { const all = []; call.on("data", (m) => all.push(m.text)); call.on("end", () => cb(null, { text: all.join("+"), n: String(all.length) })); },
    Chat(call) { call.on("data", (m) => call.write({ text: "echo " + m.text })); call.on("end", () => call.end()); },
  });
  const port = await new Promise((ok, no) => server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (e, p) => (e ? no(e) : ok(p))));
  return { addr: `127.0.0.1:${port}`, seenMeta, stop: () => server.forceShutdown() };
}
