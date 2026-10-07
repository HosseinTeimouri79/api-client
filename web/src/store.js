import { create } from "zustand";
import { api, ApiError, errorText } from "./api.js";
import { blankReq, cleanReq } from "./lib/http.js";
import { clone } from "./lib/utils.js";
import { liveTab, firstTab, protocolOf } from "./lib/protocols.js";
import { followSession } from "./lib/session.js";
import { toast } from "./components/ui/Toasts.jsx";
import { prompt, confirm } from "./components/ui/dialogs.jsx";
import { pickCollection } from "./features/pickers.jsx";
import { DEFAULT_SETTINGS, mergeSettings, applySettingsToPage } from "./lib/settings.js";
import { applyLocale, t, t as tr } from "./i18n/index.js"; // `tr`: same function, usable where a local `t` (tab) shadows it

const LS = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const WRITE = ["owner", "admin", "editor"], ADMIN = ["owner", "admin"];
export const can = (ws) => ({ write: WRITE.includes(ws?.role), admin: ADMIN.includes(ws?.role) });

// App settings live on the account and are cached in the browser so the page looks right before sign-in completes.
// Older versions stored the theme and layout under their own keys; honour them until settings exist.
function loadSettings() {
  let saved = null;
  try { saved = JSON.parse(LS.get("settings", "null")); } catch { /* ignore */ }
  const s = mergeSettings(saved);
  if (!saved) {
    if (["dark", "light"].includes(LS.get("theme", ""))) s.app.theme = LS.get("theme");
    if (LS.get("splitDir", "") === "col") s.ui.layout = "side";
  }
  return s;
}
const layoutDir = (s) => (s.ui.layout === "side" ? "col" : "row"); // "col": editor and response side by side
const autosaveTimers = new Map();
const streams = new Map(); // tab key -> { ctl: AbortController, buf: [], timer }
const MAX_EVENTS = 2000; // shown per live tab
let syncTimer;
let keySeq = 0;
export const useStore = create((set, get) => {
  const initialSettings = loadSettings();
  applySettingsToPage(initialSettings);
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
      if (get().user?.locale) await applyLocale(get().user.locale); // the saved account language wins over the device default
      if (get().user?.settings) actions.adoptSettings(mergeSettings(get().user.settings), true);
      if (get().user) await actions.loadWorkspaces();
      set({ booting: false });
    },
    async authenticate(mode, form) {
      await api("POST", `/auth/${mode}`, form);
      await actions.boot();
    },
    async logout() {
      actions.dropAllSessions();
      await api("POST", "/auth/logout").catch(() => {});
      set({ user: null, view: "app", ws: null, workspaces: [], tabs: [], active: null, logs: [] });
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
      actions.dropAllSessions();
      LS.set("ws", id);
      set({ ws, wsVars: ws.variables, tabs: [], active: null, expanded: {}, logs: [], history: [], colVars: {}, filter: "" });
      const [tree, envs] = await Promise.all([api("GET", W("/tree")), api("GET", W("/environments"))]);
      set({ tree, envs, envId: envs[0]?.id ?? null });
    }),
    async createWorkspace() {
      const name = await prompt({ title: t("ws.newTitle"), label: t("ws.name"), okText: t("common.create") });
      if (!name) return;
      const w = await guard(() => api("POST", "/workspaces", { name }))();
      if (!w) return;
      set({ workspaces: await api("GET", "/workspaces") });
      await actions.openWorkspace(w.id);
    },
    /** Updates the signed-in user from a profile response (name, avatar, language…). */
    setUser(user) { set({ user }); },
    async setLocale(id) {
      await applyLocale(id);
      if (get().user) await guard(async () => set({ user: (await api("PATCH", "/me", { locale: id })).user }))();
    },
    /** Replaces the settings with the account's (at sign-in). `boot` also applies "open console on start". */
    adoptSettings(settings, boot = false) {
      LS.set("settings", JSON.stringify(settings));
      applySettingsToPage(settings);
      set({ settings, theme: settings.app.theme, splitDir: layoutDir(settings), ...(boot ? { consoleOpen: settings.ui.openConsole } : {}) });
    },
    /** Changes some settings, e.g. updateSettings({ editor: { fontSize: 14 } }); applies at once and syncs to the account. */
    updateSettings(patch) {
      const cur = get().settings;
      const next = mergeSettings(Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((k) => [k, { ...cur[k], ...(patch[k] ?? {}) }])));
      actions.adoptSettings(next);
      if (!get().user) return;
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => guard(async () => set({ user: { ...get().user, settings: (await api("PATCH", "/me", { settings: get().settings })).user.settings } }))(), 500);
    },
    setTheme(theme) { actions.updateSettings({ app: { theme } }); },
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
      const name = await prompt({ title: parent ? t("sidebar.newSub") : t("sidebar.newCollection"), label: t("dlg.name"), okText: t("common.create") });
      if (!name) return;
      const c = await guard(() => api("POST", W("/collections"), { name, parent_id: parent }))();
      if (!c) return;
      if (parent) actions.toggle(parent, true);
      actions.toggle(c.id, true);
      await actions.reloadTree();
    },
    async renameCollection(c) {
      const name = await prompt({ title: t("dlg.renameCollection"), label: t("dlg.name"), initial: c.name, okText: t("sidebar.rename") });
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
      if (!(await confirm({ title: t("dlg.deleteCollection"), message: t("dlg.deleteCollectionMsg", { name: c.name }) }))) return;
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
      const t = { key: "t" + ++keySeq, id, collection_id, req, dirty: false, response: null, running: false, sub: firstTab(req), respView: null };
      set((s) => ({ tabs: [...s.tabs, t], active: t.key }));
      actions.loadInherited(t.key);
      return t;
    },
    activate(key) { set({ active: key }); actions.loadInherited(key); },
    async closeTab(key) {
      const t = get().tabs.find((x) => x.key === key);
      if (t?.dirty && !(await confirm({ title: tr("dlg.unsavedTitle"), message: tr("dlg.discardMsg", { name: t.req?.name ?? t.name }), okText: tr("dlg.discard") }))) return;
      actions.dropSession(key);
      set((s) => {
        const i = s.tabs.findIndex((x) => x.key === key);
        const tabs = s.tabs.filter((x) => x.key !== key);
        return { tabs, active: s.active === key ? (tabs[Math.min(i, tabs.length - 1)]?.key ?? null) : s.active };
      });
    },
    setReq(key, patch) { patchTab(key, (t) => ({ req: { ...t.req, ...patch }, dirty: true })); actions.autosave(key); },
    /** Autosave (Settings → Application): saves an edited, already saved request or collection shortly after the last change. */
    autosave(key) {
      const { settings, ws, tabs } = get();
      const t = tabs.find((x) => x.key === key);
      if (!settings.app.autosave || !can(ws).write || !t || (t.kind !== "collection" && !t.id)) return;
      clearTimeout(autosaveTimers.get(key));
      autosaveTimers.set(key, setTimeout(() => { autosaveTimers.delete(key); actions.save(key, { silent: true }); }, 1200));
    },
    setSub(key, sub) { patchTab(key, { sub }); },
    setRespView(key, respView) { patchTab(key, { respView }); },
    // collection settings live in their own full-size tab (one per collection)
    openCollection: guard(async (id, sub) => {
      const ex = get().tabs.find((t) => t.kind === "collection" && t.cid === id);
      if (ex) { if (sub) patchTab(ex.key, { sub }); return actions.activate(ex.key); }
      const c = await api("GET", W(`/collections/${id}`));
      const draft = clone({ description: c.description ?? "", variables: c.variables ?? [], auth: c.auth ?? { type: "none" }, pre_script: c.pre_script ?? "", post_script: c.post_script ?? "" });
      const t = { key: "t" + ++keySeq, kind: "collection", cid: id, name: c.name, draft, dirty: false, running: false, sub: sub ?? "vars" };
      set((s) => ({ tabs: [...s.tabs, t], active: t.key }));
    }),
    setDraft(key, patch) { patchTab(key, (t) => ({ draft: { ...t.draft, ...patch }, dirty: true })); actions.autosave(key); },
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
      const name = await prompt({ title: t("dlg.newRequest"), label: t("dlg.requestName"), initial: "New Request", okText: t("common.create") });
      if (!name) return;
      await guard(async () => {
        const r = await api("POST", W(`/collections/${cid}/requests`), { ...blankReq(), name });
        actions.toggle(cid, true);
        await actions.reloadTree();
        actions.addTab(r, { id: r.id, collection_id: cid });
      })();
    },
    async renameRequest(r) {
      const name = await prompt({ title: t("dlg.renameRequest"), label: t("dlg.name"), initial: r.name, okText: t("sidebar.rename") });
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
      if (!(await confirm({ title: t("dlg.deleteRequest"), message: t("dlg.deleteRequestMsg", { name: r.name }) }))) return;
      await guard(async () => {
        await api("DELETE", W(`/requests/${r.id}`));
        set((s) => {
          const tabs = s.tabs.filter((t) => t.id !== r.id);
          return { tabs, active: tabs.some((t) => t.key === s.active) ? s.active : (tabs.at(-1)?.key ?? null) };
        });
        await actions.reloadTree();
      })();
    },
    async save(key, { silent = false } = {}) {
      const { ws } = get();
      if (typeof key !== "string") key = get().active; // used directly as a click handler, which passes the event
      const t = get().tabs.find((x) => x.key === key);
      if (!t) return;
      if (!can(ws).write) return silent ? undefined : toast(tr("viewer.noSave"), "info");
      // clear the dirty mark only if nothing was typed while the save was in flight
      const clean = (done) => patchTab(t.key, (cur) => ({ ...(cur.kind === "collection" ? cur.draft === t.draft : cur.req === t.req) ? { dirty: false } : {}, ...done }));
      if (t.kind === "collection") {
        const d = t.draft;
        return guard(async () => {
          await api("PATCH", W(`/collections/${t.cid}`), { description: d.description, variables: d.variables.filter((v) => v.key), auth: d.auth, pre_script: d.pre_script, post_script: d.post_script });
          clean();
          if (!silent) toast(tr("col.saved"), "ok");
          await actions.reloadTree();
        })();
      }
      await guard(async () => {
        let cid = t.collection_id;
        if (!t.id) {
          const { collections } = get().tree;
          if (!collections.length) return toast(tr("col.createFirst"), "error");
          cid = await pickCollection(collections);
          if (!cid) return;
          const r = await api("POST", W(`/collections/${cid}/requests`), cleanReq(t.req));
          patchTab(t.key, { id: r.id, collection_id: cid });
          actions.toggle(cid, true);
        } else await api("PUT", W(`/requests/${t.id}`), cleanReq(t.req));
        clean();
        if (!silent) toast(tr("common.saved"), "ok");
        await actions.reloadTree();
      })();
    },
    async send(key = get().active) {
      const t = get().tabs.find((x) => x.key === key);
      if (!t || t.kind === "collection" || t.running) return;
      if (liveTab(t)) return actions.toggleSession(key);
      patchTab(key, { running: true });
      let response;
      try {
        const { timeoutMs, maxResponseMb } = get().settings.request;
        response = await api("POST", W("/run"), { request: cleanReq(t.req), collection_id: t.collection_id, environment_id: get().envId, limits: { timeoutMs, maxResponseBytes: Math.round(maxResponseMb * 1024 * 1024) } });
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

    // ---------- live sessions (WebSocket, ...) ----------
    toggleSession(key) {
      const t = get().tabs.find((x) => x.key === key);
      return ["connecting", "open"].includes(t?.rt?.status) ? actions.disconnect(key) : actions.connect(key);
    },
    async connect(key) {
      const t = get().tabs.find((x) => x.key === key);
      if (!t || ["connecting", "open"].includes(t.rt?.status)) return;
      actions.dropSession(key);
      const log = (level, message) => set((s) => ({ logs: [...s.logs, { ts: new Date().toISOString(), level, message }].slice(-1000) }));
      patchTab(key, { rt: { status: "connecting", events: [], subs: [], id: null, error: null, startedAt: Date.now() } });
      log("INFO", `${t.req.protocol} connecting: ${t.req.url}`);
      try {
        const { timeoutMs, maxResponseMb } = get().settings.request;
        const r = await api("POST", W("/sessions"), { request: cleanReq(t.req), collection_id: t.collection_id, environment_id: get().envId, limits: { timeoutMs, maxResponseBytes: Math.round(maxResponseMb * 1024 * 1024) } });
        if (!r.ok) {
          patchTab(key, (x) => ({ rt: { ...x.rt, status: "failed", error: r.error } }));
          return log("ERROR", `${t.req.protocol} connection failed: ${r.error.message}`);
        }
        patchTab(key, (x) => ({ rt: { ...x.rt, id: r.id } }));
        const ctl = new AbortController();
        const st = { ctl, buf: [], timer: null };
        streams.set(key, st);
        const flush = () => {
          st.timer = null;
          const batch = st.buf.splice(0);
          if (!batch.length) return;
          patchTab(key, (x) => {
            const events = [...(x.rt?.events ?? []), ...batch].slice(-MAX_EVENTS);
            let status = x.rt?.status, subs = x.rt?.subs;
            for (const e of batch) { status = e.type === "open" ? "open" : e.type === "closed" ? "closed" : status; if (e.type === "subscriptions" || e.type === "consumers") subs = e.list; }
            return x.rt?.id === r.id ? { rt: { ...x.rt, events, status, subs } } : {};
          });
        };
        followSession(get().ws.id, r.id, {
          signal: ctl.signal,
          onEvent: (e) => {
            if (e.type === "open") log("INFO", `${t.req.protocol} connected: ${e.url}`);
            if (e.type === "closed") log("INFO", `${t.req.protocol} closed${e.code ? ` (${e.code})` : ""}${e.reason ? `: ${e.reason}` : ""}`);
            if (e.type === "error") log("ERROR", `${t.req.protocol}: ${e.message}`);
            st.buf.push(e);
            st.timer ??= setTimeout(flush, 40); // many events per second are rendered in batches
          },
          onEnd: () => { flush(); patchTab(key, (x) => (x.rt?.id === r.id && x.rt.status !== "closed" ? { rt: { ...x.rt, status: "closed" } } : {})); },
        });
      } catch (e) {
        patchTab(key, (x) => ({ rt: { ...x.rt, status: "failed", error: { message: e.message } } }));
        if (e.status === 401) set({ user: null });
      }
    },
    /** Sends something on an open connection (a message, ping, close ...). */
    rtAct: guard(async (key, action, payload) => {
      const t = get().tabs.find((x) => x.key === key);
      if (t?.rt?.status !== "open") return;
      return api("POST", W(`/sessions/${t.rt.id}/act`), { action, payload });
    }),
    /** gRPC: parses the tab's .proto on the server (services, methods, example messages). */
    async describeProto(key) {
      const t = get().tabs.find((x) => x.key === key);
      if (!t) return;
      const proto = t.req.protocol_data?.proto ?? "";
      let grpc;
      try { grpc = { ...(await api("POST", W("/grpc/describe"), { proto })), forProto: proto }; }
      catch (e) { grpc = { ok: false, error: e.message, services: [], forProto: proto }; }
      patchTab(key, { grpc: { services: grpc.services ?? [], error: grpc.ok ? null : grpc.error, forProto: proto } });
    },
    /** GraphQL: which operations the query holds and which one would run (subscriptions open a connection instead of sending). */
    async analyzeQuery(key) {
      const t = get().tabs.find((x) => x.key === key);
      if (!t) return;
      const { query = "", operationName = "" } = t.req.protocol_data ?? {};
      const forKey = `${query}\u0000${operationName}`;
      let gql;
      try { gql = await api("POST", W("/graphql/analyze"), { query, operationName }); } catch (e) { gql = { ok: false, error: e.message }; }
      patchTab(key, (x) => ((x.req.protocol_data?.query ?? "") === query && (x.req.protocol_data?.operationName ?? "") === operationName ? { gql: { ...gql, forKey } } : {}));
    },
    /** GraphQL: downloads the schema by introspection and keeps its SDL with the tab. */
    async introspect(key) {
      const t = get().tabs.find((x) => x.key === key);
      if (!t) return;
      patchTab(key, { schema: { loading: true } });
      try {
        const { timeoutMs, maxResponseMb } = get().settings.request;
        const r = await api("POST", W("/graphql/introspect"), { request: cleanReq(t.req), collection_id: t.collection_id, environment_id: get().envId, limits: { timeoutMs, maxResponseBytes: Math.round(maxResponseMb * 1024 * 1024) } });
        patchTab(key, { schema: r.ok ? { sdl: r.sdl, roots: r.roots } : { error: r.error } });
      } catch (e) { patchTab(key, { schema: { error: e.message } }); }
    },
    clearEvents(key) { patchTab(key, (x) => (x.rt ? { rt: { ...x.rt, events: [] } } : {})); },
    /** Ends the connection the polite way for its protocol (close frame, DISCONNECT, cancel ...); drops it if that does not work. */
    async disconnect(key) {
      const t = get().tabs.find((x) => x.key === key);
      if (!t?.rt?.id) return;
      const id = t.rt.id, graceful = protocolOf(t.req.protocol).gracefulClose;
      const drop = async () => { try { await api("DELETE", W(`/sessions/${id}`)); } catch { /* already gone */ } };
      if (graceful && t.rt.status === "open") {
        try { await api("POST", W(`/sessions/${id}/act`), { action: graceful }); } catch { return drop(); }
        setTimeout(() => { const cur = get().tabs.find((x) => x.key === key); if (cur?.rt?.id === id && cur.rt.status === "open") drop(); }, 3000);
        return;
      }
      return drop();
    },
    /** Ends the connection and stops following it (tab closed, workspace changed, signed out). */
    dropSession(key) {
      const t = get().tabs.find((x) => x.key === key);
      const st = streams.get(key);
      if (st) { st.ctl.abort(); clearTimeout(st.timer); streams.delete(key); }
      if (t?.rt?.id && ["connecting", "open"].includes(t.rt.status) && get().ws) api("DELETE", W(`/sessions/${t.rt.id}`)).catch(() => {});
    },
    dropAllSessions() { for (const t of get().tabs) actions.dropSession(t.key); },

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
    user: null, view: "app", booting: true, workspaces: [], ws: null, wsVars: [], tree: { collections: [], requests: [] }, expanded: {},
    tabs: [], active: null, envs: [], envId: null, logs: [], history: [], side: "collections", filter: "", colVars: {},
    settings: initialSettings, consoleOpen: initialSettings.ui.openConsole, theme: initialSettings.app.theme, sidebarOpen: false, sidebarW: Number(LS.get("sidebarW", 300)), editorFrac: Number(LS.get("editorFrac", 0.5)), splitDir: layoutDir(initialSettings), consoleH: Number(LS.get("consoleH", 180)),
    ...actions,
    set: (p) => set(p),
    setFilter: (filter) => set({ filter }),
    clone,
  };
});
export const activeTab = (s) => s.tabs.find((t) => t.key === s.active);
