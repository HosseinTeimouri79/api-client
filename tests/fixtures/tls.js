// A throwaway self-signed certificate for TLS tests (needs the openssl command; null when it is not installed).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let cached;
export function selfSigned() {
  if (cached !== undefined) return cached;
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apiclient-tls-"));
    const key = path.join(dir, "key.pem"), cert = path.join(dir, "cert.pem");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
    cached = { key: fs.readFileSync(key, "utf8"), cert: fs.readFileSync(cert, "utf8") };
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    cached = null;
  }
  return cached;
}
