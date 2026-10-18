import os from "node:os";
import path from "node:path";

export const APP_ID = "api-client-agent";

/**
 * Where the agent keeps its files on each system (one code path, per-OS conventions):
 * `config` holds config.json, tokens.json and pairing.json (private to the user); `install` holds agent.mjs; `logs` the log.
 * API_CLIENT_AGENT_HOME puts everything in one folder (portable installs, tests).
 */
export function agentPaths({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const p = platform === "win32" ? path.win32 : path.posix;
  if (env.API_CLIENT_AGENT_HOME) {
    const root = env.API_CLIENT_AGENT_HOME;
    return { config: root, install: root, logs: p.join(root, "logs") };
  }
  if (platform === "win32") {
    const roaming = env.APPDATA || p.join(home, "AppData", "Roaming");
    const local = env.LOCALAPPDATA || p.join(home, "AppData", "Local");
    return { config: p.join(roaming, APP_ID), install: p.join(local, APP_ID), logs: p.join(local, APP_ID, "logs") };
  }
  if (platform === "darwin") {
    const support = p.join(home, "Library", "Application Support", APP_ID);
    return { config: support, install: support, logs: p.join(home, "Library", "Logs", APP_ID) };
  }
  const config = p.join(env.XDG_CONFIG_HOME || p.join(home, ".config"), APP_ID);
  const data = p.join(env.XDG_DATA_HOME || p.join(home, ".local", "share"), APP_ID);
  return { config, install: data, logs: p.join(env.XDG_STATE_HOME || p.join(home, ".local", "state"), APP_ID) };
}
