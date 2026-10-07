import { createContext, useContext, useMemo } from "react";
import { useStore } from "../store.js";

// name -> { value, scope, secret }. Later scopes override earlier ones (same precedence as the server).
export const VarsContext = createContext({});
export const useVars = () => useContext(VarsContext);

export function useKnownVars(tab) {
  const wsVars = useStore((s) => s.wsVars);
  const envs = useStore((s) => s.envs);
  const envId = useStore((s) => s.envId);
  const tree = useStore((s) => s.tree);
  const colVars = useStore((s) => s.colVars);
  return useMemo(() => {
    const out = {};
    const add = (list, scope) => (list ?? []).forEach((v) => v.key && v.enabled !== false && (out[v.key] = { value: v.value, scope, secret: !!v.secret }));
    add(wsVars, "workspace");
    add(envs.find((e) => e.id === envId)?.variables, "environment");
    const chain = [];
    for (let c = tree.collections.find((x) => x.id === tab?.collection_id); c; c = tree.collections.find((x) => x.id === c.parent_id)) chain.unshift(c.id);
    chain.forEach((id) => add(colVars[id], "collection"));
    add(tab?.req?.variables, "request");
    return out;
  }, [wsVars, envs, envId, tree, colVars, tab?.collection_id, tab?.req?.variables]);
}
export const varOptions = (vars) =>
  Object.entries(vars).map(([k, v]) => ({ value: k, label: k, group: undefined, description: `${v.scope} · ${v.secret ? "••••••" : String(v.value).slice(0, 40)}`, icon: "brackets-curly" }));
