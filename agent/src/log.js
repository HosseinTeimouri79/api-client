import fs from "node:fs";
import path from "node:path";

/**
 * A small log for the background agent: one line per event to stdout and to `<dir>/agent.log`, which is rotated at
 * 1 MB (one old file kept). It never records header values or bodies, only what happened and where.
 */
export function createLogger(dir, { quiet = false } = {}) {
  const file = dir && path.join(dir, "agent.log");
  if (dir) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const write = (level, message, extra) => {
    const line = `${new Date().toISOString()} ${level} ${message}${extra ? " " + JSON.stringify(extra) : ""}`;
    if (!quiet) (level === "ERROR" ? console.error : console.log)(line);
    if (!file) return;
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, file + ".1");
      fs.appendFileSync(file, line + "\n", { mode: 0o600 });
    } catch { /* logging never stops the agent */ }
  };
  return { info: (m, x) => write("INFO", m, x), warn: (m, x) => write("WARN", m, x), error: (m, x) => write("ERROR", m, x), file };
}
