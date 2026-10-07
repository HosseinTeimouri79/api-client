import { create } from "zustand";
import { api, ApiError, errorText } from "./api.js";
import { blankReq, cleanReq } from "./lib/http.js";
import { clone } from "./lib/utils.js";
import { toast } from "./components/ui/Toasts.jsx";
import { prompt, confirm } from "./components/ui/dialogs.jsx";
import { pickCollection } from "./features/pickers.jsx";

const LS = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const WRITE = ["owner", "admin", "editor"], ADMIN = ["owner", "admin"];
export const can = (ws) => ({ write: WRITE.includes(ws?.role), admin: ADMIN.includes(ws?.role) });

let keySeq = 0;
export const useStore = create((set, get) => {
  const W = (p = "") => `/workspaces/${get().ws.id}${p}`;
  const patchTab = (key, fn) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.key === key ? { ...t, ...(typeof fn === "function" ? fn(t) : fn) } : t)) }));
  /** Runs an async action; shows errors as toasts and bounces to the login screen on 401. */
  const guard = (fn) => async (...a) => {
    try { return await fn(...a); }
    catch (e) {
      toast(errorText(e), "error");
      if (e instanceof ApiError && e.status === 401) set({ user: null });
    }
  };

  const actions = {
    guard, W,
    // ---------- session ----------
    async boot() {
      try { set({ user: (await api("GET", "/auth/me")).user }); } catch { set({ user: null }); }
      if (get().user) await actions.loadWorkspaces();
      set({ booting: false });
    },
    async authenticate(mode, form) {
      await api("POST", `/auth/${mode}`, form);
      await actions.boot();
    },
    async logout() {
      await api("POST", "/auth/logout").catch(() => {});
      set({ user: null, ws: null, workspaces: [], tabs: [], active: null, logs: [] });
    },
    async loadWorkspaces() {
      const workspaces = await api("GET", "/workspaces");
      set({ workspaces });
      const w = workspaces.find((x) => x.id === LS.get("ws")) ?? workspaces[0];
      if (w) await actions.openWorkspace(w.id);
      else set({ ws: null });
    },
    openWorkspace: guard(async (id) => {
      const ws = await api("GET", `/workspaces/${id}`);
      LS.set("ws", id);
      set({ ws, wsVars: ws.variables, tabs: [], active: null, expanded: {}, logs: [], history: [], colVars: {}, filter: "" });
      const [tree, envs] = await Promise.all([api("GET", W("/tree")), api("GET", W("/environments"))]);
      set({ tree, envs, envId: envs[0]?.id ?? null });
    }),
    async createWorkspace() {
      const name = await prompt({ title: "New workspace", label: "Workspace name", okText: "Create" });
      if (!name) return;
      const w = await guard(() => api("POST", "/workspaces", { name }))();
      if (!w) return;
      set({ workspaces: await api("GET", "/workspaces") });
      await actions.openWorkspace(w.id);
    },
    setTheme(theme) { LS.set("theme", theme); document.documentElement.dataset.theme = theme; set({ theme }); },
    refreshEnvs: guard(async () => {
      const [envs, ws] = await Promise.all([api("GET", W("/environments")), api("GET", W())]);
      set((s) => ({ envs, wsVars: ws.variables, envId: envs.some((e) => e.id === s.envId) ? s.envId : (envs[0]?.id ?? null) }));
    }),

    // ---------- tree ----------
    async reloadTree() {
      const tree = await api("GET", W("/tree"));
      set((s) => ({
        tree,
        colVars: {},
        tabs: s.tabs.map((t) => {
          if (t.kind === "collection") return { ...t, name: tree.collections.find((c) => c.id === t.cid)?.name ?? t.name };
          const r = t.id && tree.requests.find((x) => x.id === t.id);
          return { ...t, collection_id: r ? r.collection_id : t.collection_id, inh: undefined };
        }),
      }));
      actions.loadInherited(get().active);
    },
    toggle(id, force) {
      set((s) => {
        const open = force ?? !s.expanded[id];
        const e = { ...s.expanded };
        open ? (e[id] = true) : delete e[id];
        return { expanded: e };
      });
    },
    async addCollection(parent) {
      const name = await prompt({ title: parent ? "New sub-collection" : "New collection", label: "Name", okText: "Create" });
      if (!name) return;
      const c = await guard(() => api("POST", W("/collections"), { name, parent_id: parent }))();
      if (!c) return;
      if (parent) actions.toggle(parent, true);
      actions.toggle(c.id, true);
      await actions.reloadTree();
    },
    async renameCollection(c) {
      const name = await prompt({ title: "Rename collection", label: "Name", initial: c.name, okText: "Rename" });
      if (name) await guard(async () => { await api("PATCH", W(`/collections/${c.id}`), { name }); await actions.reloadTree(); })();
    },
    duplicateCollection: guard(async (c) => { await api("POST", W(`/collections/${c.id}/duplicate`)); await get().reloadTree(); }),
    moveCollectionToRoot: guard(async (c) => { await api("PATCH", W(`/collections/${c.id}`), { parent_id: null }); await get().reloadTree(); }),
    sortChildren: guard(async (id) => {
      const { collections, requests } = get().tree;
      const by = (a, b) => a.name.localeCompare(b.name);
      await api("POST", W("/reorder"), [
        ...collections.filter((c) => c.parent_id === id).sort(by).map((c, i) => ({ type: "collection", id: c.id, position: i })),
        ...requests.filter((r) => r.collection_id === id).sort(by).map((r, i) => ({ type: "request", id: r.id, position: i })),
      ]);
      await get().reloadTree();
    }),
    async deleteCollection(c) {
      if (!(await confirm({ title: "Delete collection", message: `Delete “${c.name}” and everything inside it?` }))) return;
      await guard(async () => {
        await api("DELETE", W(`/collections/${c.id}`));
        await actions.reloadTree();
        const gone = new Set(get().tree.requests.map((r) => r.id));
        set((s) => {
          const cols = new Set(get().tree.collections.map((c) => c.id));
          const tabs = s.tabs.filter((t) => (t.kind === "collection" ? cols.has(t.cid) : !t.id || gone.has(t.id)));
          return { tabs, active: tabs.some((t) => t.key === s.active) ? s.active : (tabs.at(-1)?.key ?? null) };
        });
      })();
    },
    async dropOn(drag, target) {
      if (!drag || drag.id === target.id) return;
      await guard(async () => {
        if (target.type === "collection") {
          if (drag.type === "request") await api("PATCH", W(`/requests/${drag.id}/move`), { collection_id: target.id });
          else await api("PATCH", W(`/collections/${drag.id}`), { parent_id: target.id });
          actions.toggle(target.id, true);
        } else if (drag.type === "request") {
          await api("PATCH", W(`/requests/${drag.id}/move`), { collection_id: target.collection_id });
          const order = get().tree.requests
            .filter((r) => r.collection_id === target.collection_id && r.id !== drag.id)
            .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
          order.splice(order.findIndex((r) => r.id === target.id), 0, { id: drag.id });
          await api("POST", W("/reorder"), order.map((r, p) => ({ type: "request", id: r.id, position: p })));
        }
        await actions.reloadTree();
      })();
    },

    // ---------- tabs ----------
    addTab(req, { id = null, collection_id = null } = {}) {
      const t = { key: "t" + ++keySeq, id, collection_id, req, dirty: false, response: null, running: false, sub: "params", respView: null };
      set((s) => ({ tabs: [...s.tabs, t], active: t.key }));
      actions.loadInherited(t.key);
      return t;
    },
    activate(key) { set({ active: key }); actions.loadInherited(key); },
    async closeTab(key) {
      const t = get().tabs.find((x) => x.key === key);
      if (t?.dirty && !(await confirm({ title: "Unsaved changes", message: `Discard changes to “${t.req?.name ?? t.name}”?`, okText: "Discard" }))) return;
      set((s) => {
        const i = s.tabs.findIndex((x) => x.key === key);
        const tabs = s.tabs.filter((x) => x.key !== key);
        return { tabs, active: s.active === key ? (tabs[Math.min(i, tabs.length - 1)]?.key ?? null) : s.active };
      });
    },
    setReq(key, patch) { patchTab(key, (t) => ({ req: { ...t.req, ...patch }, dirty: true })); },
    setSub(key, sub) { patchTab(key, { sub }); },
    setRespView(key, respView) { patchTab(key, { respView }); },
    // collection settings live in their own full-size tab (one per collection)
    openCollection: guard(async (id, sub) => {
      const ex = get().tabs.find((t) => t.kind === "collection" && t.cid === id);
      if (ex) { if (sub) patchTab(ex.key, { sub }); return actions.activate(ex.key); }
      const c = await api("GET", W(`/collections/${id}`));
      const draft = clone({ variables: c.variables ?? [], auth: c.auth ?? { type: "none" }, pre_script: c.pre_script ?? "", post_script: c.post_script ?? "" });
      const t = { key: "t" + ++keySeq, kind: "collection", cid: id, name: c.name, draft, dirty: false, running: false, sub: sub ?? "vars" };
      set((s) => ({ tabs: [...s.tabs, t], active: t.key }));
    }),
    setDraft(key, patch) { patchTab(key, (t) => ({ draft: { ...t.draft, ...patch }, dirty: true })); },
    openRequest: guard(async (id) => {
      const ex = get().tabs.find((t) => t.id === id);
      if (ex) return actions.activate(ex.key);
      const r = await api("GET", W(`/requests/${id}`));
      actions.addTab(r, { id, collection_id: r.collection_id });
    }),
    // inherited collection scripts + variables for the tab's collection chain (cached per tab / per collection)
    async loadInherited(key) {
      const t = get().tabs.find((x) => x.key === key);
      if (!t || t.kind === "collection" || t.inh !== undefined || !get().ws) return;
      const cid = t.collection_id;
      let inh = [];
      try { inh = cid ? await api("GET", W(`/collections/${cid}/scripts`)) : []; } catch { /* keep empty */ }
      patchTab(key, (x) => (x.collection_id === cid ? { inh } : {}));
      // variable names for autocomplete / highlighting
      const { tree, colVars } = get();
      const chain = [];
      for (let c = tree.collections.find((x) => x.id === cid); c; c = tree.collections.find((x) => x.id === c.parent_id)) chain.push(c.id);
      const missing = chain.filter((id) => !(id in colVars));
      if (missing.length) {
        const got = await Promise.all(missing.map((id) => api("GET", W(`/collections/${id}`)).then((c) => [id, c.variables ?? []]).catch(() => [id, []])));
        set((s) => ({ colVars: { ...s.colVars, ...Object.fromEntries(got) } }));
      }
    },
    async newRequestIn(cid) {
      const name = await prompt({ title: "New request", label: "Request name", initial: "New Request", okText: "Create" });
      if (!name) return;
      await guard(async () => {
        const r = await api("POST", W(`/collections/${cid}/requests`), { ...blankReq(), name });
        actions.toggle(cid, true);
        await actions.reloadTree();
        actions.addTab(r, { id: r.id, collection_id: cid });
      })();
    },
    async renameRequest(r) {
      const name = await prompt({ title: "Rename request", label: "Name", initial: r.name, okText: "Rename" });
      if (!name) return;
      await guard(async () => {
        const full = await api("GET", W(`/requests/${r.id}`));
        await api("PUT", W(`/requests/${r.id}`), { ...full, name });
        patchTab(get().tabs.find((t) => t.id === r.id)?.key, (t) => ({ req: { ...t.req, name } }));
        await actions.reloadTree();
      })();
    },
    duplicateRequest: guard(async (r) => { await api("POST", W(`/requests/${r.id}/duplicate`)); await get().reloadTree(); }),
    async deleteRequest(r) {
      if (!(await confirm({ title: "Delete request", message: `Delete “${r.name}”?` }))) return;
      await guard(async () => {
        await api("DELETE", W(`/requests/${r.id}`));
        set((s) => {
          const tabs = s.tabs.filter((t) => t.id !== r.id);
          return { tabs, active: tabs.some((t) => t.key === s.active) ? s.active : (tabs.at(-1)?.key ?? null) };
        });
        await actions.reloadTree();
      })();
    },
    async save() {
      const { ws } = get();
      const t = get().tabs.find((x) => x.key === get().active);
      if (!t || !can(ws).write) return;
      if (t.kind === "collection") {
        const d = t.draft;
        return guard(async () => {
          await api("PATCH", W(`/collections/${t.cid}`), { variables: d.variables.filter((v) => v.key), auth: d.auth, pre_script: d.pre_script, post_script: d.post_script });
          patchTab(t.key, { dirty: false });
          toast("Collection saved", "ok");
          await actions.reloadTree();
        })();
      }
      await guard(async () => {
        let cid = t.collection_id;
        if (!t.id) {
          const { collections } = get().tree;
          if (!collections.length) return toast("Create a collection first", "error");
          cid = await pickCollection(collections);
          if (!cid) return;
          const r = await api("POST", W(`/collections/${cid}/requests`), cleanReq(t.req));
          patchTab(t.key, { id: r.id, collection_id: cid });
          actions.toggle(cid, true);
        } else await api("PUT", W(`/requests/${t.id}`), cleanReq(t.req));
        patchTab(t.key, { dirty: false });
        toast("Saved", "ok");
        await actions.reloadTree();
      })();
    },
    async send(key = get().active) {
      const t = get().tabs.find((x) => x.key === key);
      if (!t || t.kind === "collection" || t.running) return;
      patchTab(key, { running: true });
      let response;
      try {
        response = await api("POST", W("/run"), { request: cleanReq(t.req), collection_id: t.collection_id, environment_id: get().envId });
        set((s) => ({ logs: [...s.logs, ...response.logs].slice(-1000) }));
      } catch (e) {
        response = { error: { phase: "internal", message: e.message }, tests: [], logs: [] };
        set((s) => ({ logs: [...s.logs, { ts: new Date().toISOString(), level: "ERROR", message: e.message }] }));
        if (e.status === 401) set({ user: null });
      }
      patchTab(key, { running: false, response });
      if (can(get().ws).write) actions.refreshEnvs(); // scripts may have set environment / global variables
      if (get().side === "history") actions.loadHistory();
    },
    clearLogs() { set({ logs: [] }); },

    // ---------- history ----------
    loadHistory: guard(async () => set({ history: await api("GET", W("/history")) })),
    clearHistory: guard(async () => { await api("DELETE", W("/history")); set({ history: [] }); }),
    openHistory: guard(async (id) => {
      const x = await api("GET", W(`/history/${id}`));
      actions.addTab({ ...blankReq(), ...x.snapshot.request, name: `${x.method} ${x.url}`.slice(0, 40) }, { collection_id: x.snapshot.collection_id });
    }),
    setSide(side) { set({ side }); if (side === "history") actions.loadHistory(); },
  };
  return {
    user: null, booting: true, workspaces: [], ws: null, wsVars: [], tree: { collections: [], requests: [] }, expanded: {},
    tabs: [], active: null, envs: [], envId: null, logs: [], history: [], side: "collections", filter: "", colVars: {},
    consoleOpen: true, theme: LS.get("theme", "dark"), sidebarOpen: false, sidebarW: Number(LS.get("sidebarW", 300)), editorFrac: Number(LS.get("editorFrac", 0.5)), splitDir: LS.get("splitDir", "col"), consoleH: Number(LS.get("consoleH", 180)),
    ...actions,
    set: (p) => set(p),
    setFilter: (filter) => set({ filter }),
    clone,
  };
});
export const activeTab = (s) => s.tabs.find((t) => t.key === s.active);
