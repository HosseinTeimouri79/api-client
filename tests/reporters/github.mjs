// A node:test reporter for GitHub Actions: each failing test becomes an error annotation (title = test, message = the
// error), visible on the run's page and through the public API. Used next to the normal `spec` reporter in CI.
import path from "node:path";

const esc = (s, prop) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A").replace(prop ? /[:,]/g : /$^/, (c) => (c === ":" ? "%3A" : "%2C"));
export default async function* github(source) {
  for await (const { type, data } of source) {
    if (type !== "test:fail" || data.details?.type === "suite") continue;
    const err = data.details?.error?.cause ?? data.details?.error ?? {};
    const where = String(err.stack ?? "").split("\n").find((l) => l.includes("/tests/")) ?? "";
    const message = `${err.message ?? err.code ?? "failed"}${where ? `\n${where.trim()}` : ""}`.slice(0, 2000);
    const file = data.file ? path.relative(process.cwd(), data.file.replace(/^file:\/\//, "")) : "tests";
    yield `::error file=${esc(file, true)},title=${esc(data.name, true)}::${esc(message)}\n`;
  }
}
