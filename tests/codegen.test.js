// Code snippet generator: structure of every target, plus real execution of the targets whose tools are installed
// (curl, wget, python, node, gcc+libcurl) against a local echo server, with awkward characters in the request.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawn, spawnSync } from "node:child_process";
import { TARGETS, generate, buildModel, DEFAULT_TARGET } from "../web/src/lib/codegen/index.js";

const NASTY = "it's \"q\" \\ $HOME `x` é€😀";
const NASTY_HEADER = NASTY.replace(/[^\x20-\x7e]/g, "").trim(); // header values are bytes; most HTTP clients reject non-latin1 ones
const kv = (key, value) => ({ key, value, enabled: true });
const REQS = {
  json: { method: "POST", url: "{{base}}/users?x=1", params: [kv("q", "a b&c")], headers: [kv("X-Trace", NASTY_HEADER), kv("X-Off", "no")], body: { mode: "json", content: `{\n  "name": ${JSON.stringify(NASTY)},\n  "n": 1\n}` }, auth: { type: "bearer", token: "tok{{x}}" } },
  get: { method: "GET", url: "{{base}}/health", params: [], headers: [], body: { mode: "none" } },
  form: { method: "PUT", url: "{{base}}/f", params: [], headers: [], body: { mode: "urlencoded", fields: [kv("a", "1 2"), kv("b", NASTY)] } },
  multi: { method: "POST", url: "{{base}}/up", params: [], headers: [kv("X-A", "1")], body: { mode: "multipart", fields: [kv("k", "v"), kv("k2", NASTY)] }, auth: { type: "apikey", key: "X-Key", value: "kk", in: "header" } },
};
REQS.json.headers[1].enabled = false;

let server, base, last;
before(() => new Promise((resolve) => {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { last = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") }; res.end("ok"); });
  }).listen(0, "127.0.0.1", () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
}));
after(() => server.close());

const opts = () => ({ vars: { base: { value: base }, x: { value: "SECRET", secret: true } } });

test("model: resolves variables but never substitutes secrets; mirrors the server's request building", () => {
  const m = buildModel(REQS.json, opts());
  assert.equal(m.url, `${base}/users?x=1&q=a+b%26c`);
  assert.deepEqual(m.headers.map(([k]) => k), ["X-Trace", "Authorization", "Content-Type"]); // disabled row dropped, auth + default type added
  assert.equal(m.headers[1][1], "Bearer tok{{x}}"); // secret stays a placeholder
  assert.equal(buildModel(REQS.get, opts()).body, null);
  assert.equal(buildModel({ ...REQS.json, method: "GET" }, opts()).body, null); // GET never carries a body
  const mp = buildModel(REQS.multi, opts());
  assert.ok(!mp.headers.some(([k]) => k.toLowerCase() === "content-type"), "multipart boundary comes from the tool");
  assert.deepEqual(mp.headers.find(([k]) => k === "X-Key"), ["X-Key", "kk"]);
  // inherited auth applies only when the request says "inherit"
  const inh = buildModel({ ...REQS.get, auth: { type: "inherit" } }, { ...opts(), inheritedAuth: { type: "apikey", key: "k", value: "v", in: "query" } });
  assert.equal(inh.url, `${base}/health?k=v`);
  assert.equal(buildModel({ ...REQS.get, auth: { type: "none" } }, { ...opts(), inheritedAuth: { type: "bearer", token: "t" } }).headers.length, 0);
  // unresolved variables stay readable in the URL
  assert.equal(buildModel({ ...REQS.get, url: "{{nope}}/a", params: [kv("q", "{{v}}")] }).url, "{{nope}}/a?q={{v}}");
  assert.equal(buildModel({ ...REQS.get, auth: { type: "basic", username: "u", password: "p" } }).headers[0][1], "Basic dTpw");
});

test("the picker list is complete, unique and starts from cURL", () => {
  assert.equal(TARGETS.length, 35);
  assert.equal(new Set(TARGETS.map((t) => t.id)).size, TARGETS.length);
  assert.equal(DEFAULT_TARGET, "curl");
  const byGroup = Object.groupBy(TARGETS, (t) => t.group);
  assert.deepEqual(Object.fromEntries(Object.entries(byGroup).map(([g, l]) => [g, l.map((t) => t.name)])), {
    "C#": ["HttpClient", "RestSharp"], cURL: ["cURL"], Dart: ["Dio", "HTTP"], Go: ["http package"], HTTP: ["Raw HTTP request"],
    Java: ["OkHttp", "Unirest"], JavaScript: ["Fetch", "jQuery", "XHR"], Kotlin: ["OkHttp"], C: ["LibCurl"],
    "Node.js": ["Axios", "Native", "Request", "Unirest"], "Objective-C": ["NSURLSession"], OCaml: ["Cohttp"],
    PHP: ["cURL", "Guzzle", "Http_Request2", "pecl_http"], "Postman CLI": ["Postman CLI"], PowerShell: ["RestMethod"],
    Python: ["http.client", "Requests"], R: ["httr", "RCurl"], Ruby: ["Net::HTTP"], Rust: ["reqwest"], Shell: ["HTTPie", "wget"], Swift: ["URLSession"],
  });
});

for (const t of TARGETS)
  test(`generate: ${t.group} / ${t.name}`, () => {
    for (const [name, req] of Object.entries(REQS)) {
      const code = generate(t.id, req, opts());
      assert.ok(code.trim().length > 20, `${name}: empty output`);
      assert.ok(!/undefined|\[object|NaN/.test(code), `${name}: leaked a JS value\n${code}`);
      assert.ok(code.includes("127.0.0.1"), `${name}: missing host\n${code}`);
      if (t.id !== "http-raw" && t.id !== "curl") assert.ok(code.toUpperCase().includes(req.method) || /Method\.|\.get\(|\.post\(|\.put\(/i.test(code), `${name}: missing method\n${code}`);
    }
  });

test("cURL output", () => {
  assert.equal(generate("curl", REQS.get, opts()), `curl --location '${base}/health'\n`);
  assert.equal(generate("curl", { ...REQS.get, method: "HEAD" }, opts()), `curl --location --head '${base}/health'\n`);
  assert.match(generate("curl", { ...REQS.get, url: "{{nope}}/a" }), /--globoff/);
  assert.match(generate("curl", REQS.form, opts()), /--data-urlencode 'a=1 2'/);
  assert.match(generate("curl", REQS.multi, opts()), /--form-string 'k=v'/);
});

test("raw HTTP request has a correct Content-Length", () => {
  const out = generate("http-raw", REQS.json, opts());
  const [head, ...rest] = out.split("\n\n");
  const body = rest.join("\n\n");
  assert.match(head, /^POST \/users\?x=1&q=a\+b%26c HTTP\/1\.1\nHost: 127\.0\.0\.1:\d+\n/);
  assert.equal(Number(/Content-Length: (\d+)/.exec(head)[1]), Buffer.byteLength(body));
});

// ---- syntax of the targets we can parse here (no network needed) ----
test("syntax: JavaScript and Node targets parse", () => {
  for (const id of ["javascript-fetch", "javascript-jquery", "javascript-xhr", "nodejs-axios", "nodejs-native", "nodejs-request", "nodejs-unirest"])
    for (const [name, req] of Object.entries(REQS)) {
      const code = generate(id, req, opts());
      assert.doesNotThrow(() => new vm.Script(code), `${id} / ${name}\n${code}`);
    }
});
test("syntax: Python and shell targets parse", () => {
  for (const id of ["python-httpclient", "python-requests"])
    for (const [name, req] of Object.entries(REQS)) {
      const r = spawnSync("python3", ["-I", "-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: generate(id, req, opts()), encoding: "utf8" });
      assert.equal(r.status, 0, `${id} / ${name}\n${r.stderr}`);
    }
  for (const id of ["curl", "shell-httpie", "shell-wget", "postman-cli"])
    for (const [name, req] of Object.entries(REQS)) {
      const r = spawnSync("sh", ["-n"], { input: generate(id, req, opts()), encoding: "utf8" });
      assert.equal(r.status, 0, `${id} / ${name}\n${r.stderr}`);
    }
});

// ---- real execution ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const has = (cmd, args = ["--version"]) => spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
const pyHas = (mod) => spawnSync("python3", ["-I", "-c", `import ${mod}`], { stdio: "ignore" }).status === 0;
const curlH = fs.existsSync("/usr/include/curl/curl.h") && has("gcc");
// The echo server lives in this process, so children must run asynchronously (spawnSync would block it).
const exec = (cmd, args, cwd) => new Promise((resolve) => {
  const c = spawn(cmd, args, { cwd });
  let out = "", err = "";
  c.stdout.on("data", (d) => (out += d));
  c.stderr.on("data", (d) => (err += d));
  const timer = setTimeout(() => c.kill("SIGKILL"), 20000);
  c.on("close", (status) => { clearTimeout(timer); resolve({ status, stdout: out, stderr: err }); });
  c.on("error", (e) => { clearTimeout(timer); resolve({ status: -1, stdout: out, stderr: String(e) }); });
});
let seq = 0;
const file = (ext, code, cmd, args) => {
  const f = path.join(tmp, `s${++seq}.${ext}`);
  fs.writeFileSync(f, code);
  return exec(cmd, [...args, f], tmp);
};
const RUNNERS = {
  curl: has("curl") && ((code) => exec("sh", ["-c", code])),
  "shell-wget": has("wget") && ((code) => exec("sh", ["-c", code])),
  "python-httpclient": has("python3") && ((code) => file("py", code, "python3", ["-I"])),
  "python-requests": has("python3") && pyHas("requests") && ((code) => file("py", code, "python3", ["-I"])),
  "javascript-fetch": has("node") && ((code) => file("mjs", code, "node", ["--no-warnings"])),
  "nodejs-native": has("node") && ((code) => file("cjs", code, "node", [])),
  "c-libcurl": curlH && (async (code) => {
    const src = path.join(tmp, `c${++seq}.c`), bin = src.slice(0, -2);
    fs.writeFileSync(src, code);
    const cc = await exec("gcc", [src, "-o", bin, "-lcurl"]);
    return cc.status === 0 ? exec(bin, []) : cc;
  }),
};
const form = (s) => Object.fromEntries(new URLSearchParams(s));

function check(name, got) {
  const m = buildModel(REQS[name], opts());
  assert.equal(got.method, m.method);
  assert.equal(got.url, m.url.slice(base.length));
  for (const [k, v] of m.headers) if (k.toLowerCase() !== "content-type") assert.equal(got.headers[k.toLowerCase()], v, `header ${k}`);
  const b = m.body;
  if (!b) assert.equal(got.body, "");
  else if (b.kind === "raw") { assert.equal(got.body, b.text); assert.match(got.headers["content-type"], /^application\/json/); }
  else if (b.kind === "urlencoded") { assert.deepEqual(form(got.body), Object.fromEntries(b.fields)); assert.match(got.headers["content-type"], /^application\/x-www-form-urlencoded/); }
  else {
    assert.match(got.headers["content-type"], /^multipart\/form-data; boundary=/);
    for (const [k, v] of b.fields) assert.ok(got.body.includes(`name="${k}"`) && got.body.includes(v), `multipart field ${k}`);
  }
}

for (const [id, run] of Object.entries(RUNNERS)) {
  const t = TARGETS.find((x) => x.id === id);
  test(`runs for real: ${t.group} / ${t.name}`, { skip: !run && "tool not installed", timeout: 120000 }, async () => {
    for (const name of Object.keys(REQS)) {
      last = null;
      const code = generate(id, REQS[name], opts());
      const r = await run(code);
      assert.ok(last, `${name}: no request reached the server\n${code}\n${r.stdout}\n${r.stderr}`);
      try { check(name, last); } catch (e) { e.message += `\n--- ${id} / ${name} ---\n${code}`; throw e; }
    }
  });
}
