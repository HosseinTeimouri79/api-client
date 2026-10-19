// The real standalone agent from the Linux installer (Node.js built in): set up from the archive, started, paired, and
// sending a request. Needs `npm run build:installers` (skipped otherwise, and on systems other than Linux x64).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { agentHome } from "./fixtures/agent.js";

const DIR = process.env.AGENT_INSTALLERS_DIR || new URL("../build/installers/", import.meta.url).pathname;
const index = (() => { try { return JSON.parse(fs.readFileSync(`${DIR}/index.json`, "utf8")); } catch { return null; } })();
const tgz = index?.files.find((f) => f.platform === "linux" && f.arch === process.arch && f.kind === "tar.gz");
const deb = index?.files.find((f) => f.platform === "linux" && f.kind === "deb");
const skip = (process.platform !== "linux" && "Linux only") || (!tgz && "no Linux installer built (npm run build:installers)");

test("the Linux installer: a standalone program that sets itself up and serves paired sites", { skip, timeout: 60000 }, async () => {
  const home = agentHome(), unpack = agentHome();
  const env = { ...process.env, API_CLIENT_AGENT_HOME: home, PATH: "/usr/bin:/bin" }; // no Node.js needed on PATH
  try {
    execFileSync("tar", ["-xzf", `${DIR}/${tgz.file}`, "-C", unpack]);
    assert.ok(fs.existsSync(`${unpack}/README.txt`));
    const exe = `${unpack}/api-client-agent`;
    assert.equal(execFileSync(exe, ["version"], { env, encoding: "utf8" }).trim(), index.version);
    assert.match(execFileSync(exe, [], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), /Usage: api-client-agent/, "without a terminal it only shows the help");
    const site = "http://127.0.0.1:5998";
    const out = execFileSync(exe, ["setup", "--server", site, "--no-service"], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    assert.match(out, /No background service/);
    const code = out.match(/\b([A-Z2-9]{4}-[A-Z2-9]{4})\b/)[1];
    const installed = `${home}/api-client-agent`;
    assert.ok(fs.statSync(installed).mode & 0o111, "copied into its folder, executable");

    const target = http.createServer((req, res) => res.end(`hello from ${req.url}`)).listen(0, "127.0.0.1");
    await new Promise((r) => target.once("listening", r));
    const proc = spawn(installed, ["run", "--port", "0"], { env, stdio: ["ignore", "pipe", "pipe"] });
    try {
      const port = await new Promise((resolve, reject) => {
        let buf = "";
        proc.stdout.on("data", (d) => { buf += d; const m = buf.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/); if (m) resolve(Number(m[1])); });
        proc.once("exit", (c) => reject(new Error(`exited ${c}: ${buf}`)));
      });
      const ag = (m, p, body, token) => fetch(`http://127.0.0.1:${port}${p}`, { method: m, headers: { origin: site, "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: JSON.stringify(body) }).then((r) => r.json());
      const { token } = await ag("POST", "/v1/pair", { code });
      assert.ok(token);
      const r = await ag("POST", "/v1/execute", { request: { url: `http://127.0.0.1:${target.address().port}/x`, method: "GET", headers: {} } }, token);
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.response.body, "hello from /x");

      // its own page is inside the program: nothing next to it is needed
      const link = execFileSync(installed, ["ui", "--print"], { env, encoding: "utf8" }).match(/http:\/\/\S+/)[0];
      assert.ok(link.startsWith(`http://127.0.0.1:${port}/ui/open?key=`));
      const cookie = (await fetch(link, { redirect: "manual" })).headers.get("set-cookie").split(";")[0];
      const html = await (await fetch(`http://127.0.0.1:${port}/ui/`)).text();
      const script = html.match(/src="(\/ui\/assets\/[^"]+\.js)"/)[1];
      const js = await fetch(`http://127.0.0.1:${port}${script}`);
      assert.equal(js.status, 200);
      assert.match(js.headers.get("content-type"), /javascript/);
      assert.equal((await fetch(`http://127.0.0.1:${port}/ui/vendor/fa/webfonts/fa-solid-900.woff2`)).headers.get("content-type"), "font/woff2");
      const state = await (await fetch(`http://127.0.0.1:${port}/ui/api/state`, { headers: { cookie } })).json();
      assert.equal(state.version, index.version);
      assert.deepEqual(state.config.origins, [site]);
    } finally {
      proc.kill("SIGTERM");
      target.close();
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(unpack, { recursive: true, force: true });
  }
});

test("the Debian package: program in /usr/lib, command in /usr/bin, a systemd user unit, setup instructions", { skip: (!deb && "no .deb built") || (!fs.existsSync("/usr/bin/dpkg-deb") && "no dpkg-deb") }, () => {
  const info = execFileSync("dpkg-deb", ["--info", `${DIR}/${deb.file}`], { encoding: "utf8" });
  assert.match(info, /Package: api-client-agent/);
  assert.match(info, new RegExp(`Version: ${index.version.replaceAll(".", "\\.")}`));
  const files = execFileSync("dpkg-deb", ["--contents", `${DIR}/${deb.file}`], { encoding: "utf8" });
  for (const f of ["./usr/lib/api-client-agent/api-client-agent", "./usr/bin/api-client-agent -> ../lib/api-client-agent/api-client-agent", "./usr/lib/systemd/user/api-client-agent.service", "./usr/share/applications/api-client-agent.desktop", "./usr/share/pixmaps/api-client-agent.png"]) assert.ok(files.includes(f), f);
  assert.match(files, /-rwxr-xr-x root\/root .* \.\/usr\/lib\/api-client-agent\/api-client-agent/);
  const dir = agentHome();
  try {
    execFileSync("dpkg-deb", ["-e", `${DIR}/${deb.file}`, dir]);
    assert.match(fs.readFileSync(`${dir}/postinst`, "utf8"), /api-client-agent setup/);
    execFileSync("dpkg-deb", ["-x", `${DIR}/${deb.file}`, `${dir}/root`]);
    const desktop = fs.readFileSync(`${dir}/root/usr/share/applications/api-client-agent.desktop`, "utf8");
    assert.match(desktop, /^Exec=api-client-agent ui$/m, "the applications menu opens the agent's page");
    assert.match(desktop, /^Icon=api-client-agent$/m);
    assert.match(fs.readFileSync(`${dir}/root/usr/lib/systemd/user/api-client-agent.service`, "utf8"), /^Environment="API_CLIENT_AGENT_SERVICE=1"$/m, "the page can restart it");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the installers' index matches the files (SHA-256 and size)", { skip: !index && "no installers built" }, async () => {
  const { createHash } = await import("node:crypto");
  for (const f of index.files) {
    const buf = fs.readFileSync(`${DIR}/${f.file}`);
    assert.equal(buf.length, f.size, f.file);
    assert.equal(createHash("sha256").update(buf).digest("hex"), f.sha256, f.file);
  }
  const win = index.files.find((f) => f.platform === "win32");
  if (win) assert.equal(fs.readFileSync(`${DIR}/${win.file}`).subarray(0, 2).toString(), "MZ", "a Windows program");
  const mac = index.files.find((f) => f.platform === "darwin");
  if (mac) assert.match(execFileSync("unzip", ["-Z", `${DIR}/${mac.file}`], { encoding: "utf8" }), /-rwx.*api-client-agent/, "the program keeps its executable bit");
});
