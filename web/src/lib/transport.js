// Where requests are sent from, behind one interface, so the rest of the app never cares:
//  - "server": the API Client server sends them (POST /run, /sessions ...);
//  - "local":  the Local Agent on this computer sends them. The server still runs everything around the network call
//              (scripts, variables, auth, tests, history: /run/prepare + /run/:id/complete), so a request behaves the
//              same in both modes; only where its bytes come from changes.
// Every method takes what the server mode takes and answers what it answers.
import { api } from "../api.js";
import { followSession } from "./session.js";
import { agent, AgentError } from "./agent.js";

export const MODES = ["server", "local"];

/** What the agent said, in the form the server's `complete` takes. Never throws. */
async function sendWithAgent(prep) {
  try {
    const r = await agent.execute(prep.request, prep.limits);
    return r.ok ? { response: r.response } : { error: r.error };
  } catch (e) {
    if (!(e instanceof AgentError)) throw e;
    return { error: { code: e.kind === "unreachable" ? "AGENT_UNREACHABLE" : "AGENT_ERROR", message: `Local Agent: ${e.message}` } };
  }
}

/** `wid()` is read at call time (the workspace may change while a request runs). */
export function transportFor(mode, wid) {
  const W = (p) => `/workspaces/${wid()}${p}`;
  if (mode === "local") {
    // phase one on the server, the network call on this computer, phase two on the server
    const twoPhase = async (path, body) => {
      const prep = await api("POST", W(`${path}/prepare`), body);
      if (prep.done) return prep.result;
      return api("POST", W(`${path}/${prep.runId}/complete`), await sendWithAgent(prep));
    };
    return {
      mode,
      run: (body) => twoPhase("/run", body),
      introspect: (body) => twoPhase("/graphql/introspect", body),
      async open(body) {
        const prep = await api("POST", W("/sessions/prepare"), body);
        try {
          return await agent.openSession(prep);
        } catch (e) {
          if (!(e instanceof AgentError)) throw e;
          return { ok: false, error: { phase: "agent", message: `Local Agent: ${e.message}` } };
        }
      },
      follow: (id, handlers) => agent.follow(id, handlers),
      act: (id, action, payload) => agent.act(id, action, payload),
      close: (id) => agent.close(id),
    };
  }
  return {
    mode: "server",
    run: (body) => api("POST", W("/run"), body),
    introspect: (body) => api("POST", W("/graphql/introspect"), body),
    open: (body) => api("POST", W("/sessions"), body),
    follow: (id, handlers) => followSession(wid(), id, handlers),
    act: (id, action, payload) => api("POST", W(`/sessions/${id}/act`), { action, payload }),
    close: (id) => api("DELETE", W(`/sessions/${id}`)),
  };
}
