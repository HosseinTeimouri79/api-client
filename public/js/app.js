import { api, ApiError } from "./api.js";
import {
  h,
  clear,
  ask,
  confirmBox,
  modal,
  toast,
  debounce,
  ic,
  lb,
} from "./util.js";
import { openInterop, exportRemote } from "./interop-ui.js";
import { kvEditor, codeEditor, bodyEditor, authEditor } from "./editors.js";
import { renderResponse } from "./response.js";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const S = {
  user: null,
  workspaces: [],
  ws: null,
  tree: { collections: [], requests: [] },
  expanded: new Set(),
  tabs: [],
  active: null,
  envs: [],
  envId: null,
  logs: [],
  history: [],
  side: "collections",
  filter: "",
  consoleOpen: true,
  dragging: null,
};
const root = document.getElementById("root");
const canWrite = () => ["owner", "admin", "editor"].includes(S.ws?.role);
const canAdmin = () => ["owner", "admin"].includes(S.ws?.role);
const guard =
  (fn) =>
  async (...a) => {
    try {
      return await fn(...a);
    } catch (e) {
      toast(
        e instanceof ApiError ? e.message : "Unexpected error: " + e.message,
        "error",
      );
      if (e.status === 401) {
        S.user = null;
        boot();
      }
    }
  };
const W = (p = "") => `/workspaces/${S.ws.id}${p}`;
const blankReq = () => ({
  name: "New Request",
  description: "",
  method: "GET",
  url: "",
  params: [],
  headers: [],
  body: { mode: "none" },
  auth: { type: "inherit" },
  variables: [],
  pre_script: "",
  post_script: "",
});
const clone = (o) => JSON.parse(JSON.stringify(o));
const nonBlank = (l = []) => l.filter((x) => x.key || x.value);
const cleanReq = (r) => ({
  ...r,
  params: nonBlank(r.params),
  headers: nonBlank(r.headers),
  variables: nonBlank(r.variables),
  body: r.body?.fields
    ? { ...r.body, fields: nonBlank(r.body.fields) }
    : r.body,
});

// ---------- boot / auth ----------
async function boot() {
  try {
    S.user = (await api("GET", "/auth/me")).user;
  } catch {
    S.user = null;
  }
  if (!S.user) return renderAuth();
  S.workspaces = await api("GET", "/workspaces");
  const last = localStorage.getItem("ws");
  const w = S.workspaces.find((x) => x.id === last) ?? S.workspaces[0];
  if (w) await openWorkspace(w.id);
  else {
    S.ws = null;
    renderShell();
  }
}
function renderAuth() {
  let mode = "login";
  const err = h("div", { class: "err" });
  const draw = () => {
    clear(root).append(
      h(
        "div",
        { class: "auth" },
        h(
          "form",
          { onsubmit: guardForm },
          h("h2", { style: { margin: 0 } }, ic("bolt"), "API Client"),
          mode === "register"
            ? h("input", { name: "name", placeholder: "Name", required: true })
            : null,
          h("input", {
            name: "email",
            type: "email",
            placeholder: "Email",
            required: true,
            autocomplete: "username",
          }),
          h("input", {
            name: "password",
            type: "password",
            placeholder: "Password (min 8)",
            minlength: 8,
            required: true,
            autocomplete:
              mode === "login" ? "current-password" : "new-password",
          }),
          err,
          h(
            "button",
            { class: "primary" },
            mode === "login" ? "Sign in" : "Create account",
          ),
          h(
            "a",
            {
              href: "#",
              onclick: (e) => {
                e.preventDefault();
                mode = mode === "login" ? "register" : "login";
                err.textContent = "";
                draw();
              },
            },
            mode === "login"
              ? "Need an account? Register"
              : "Have an account? Sign in",
          ),
        ),
      ),
    );
  };
  async function guardForm(e) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      await api("POST", `/auth/${mode}`, f);
      await boot();
    } catch (x) {
      err.textContent = x.details?.[0]
        ? `${x.details[0].path}: ${x.details[0].message}`
        : x.message;
    }
  }
  draw();
}
const openWorkspace = guard(async (id) => {
  S.ws = await api("GET", `/workspaces/${id}`);
  localStorage.setItem("ws", id);
  S.tabs = [];
  S.active = null;
  S.expanded = new Set();
  S.logs = [];
  [S.tree, S.envs] = await Promise.all([
    api("GET", W("/tree")),
    api("GET", W("/environments")),
  ]);
  S.envId = S.envs[0]?.id ?? null;
  S.history = [];
  renderShell();
});
const reloadTree = async () => {
  S.tree = await api("GET", W("/tree"));
  renderTree();
  // A request may have been moved/dragged or a collection script edited: re-sync each tab's parent and re-fetch inherited scripts.
  for (const t of S.tabs) {
    const r = t.id && S.tree.requests.find((x) => x.id === t.id);
    if (r) t.collection_id = r.collection_id;
    t.inh = undefined;
  }
  loadInherited(activeTab());
};
// Scripts a request inherits from its collection chain (root -> nearest). Cached per tab in t.inh; undefined = not loaded.
async function loadInherited(t) {
  if (!t || t.inh !== undefined) return;
  const cid = t.collection_id;
  try {
    t.inh = cid ? await api("GET", W(`/collections/${cid}/scripts`)) : [];
  } catch {
    t.inh = [];
  }
  if (activeTab() === t && t.collection_id === cid) el.sub?.refresh();
}

// ---------- shell ----------
let el = {};
function renderShell() {
  document.documentElement.dataset.theme =
    localStorage.getItem("theme") ?? "dark";
  el = {
    tree: h("div", { class: "tree" }),
    tabs: h("div", { class: "tabs" }),
    editor: h("div", { class: "pane" }),
    resp: h("div", { class: "pane", style: { borderRight: 0 } }),
    log: h("div", { class: "log" }),
    conTitle: h("b"),
  };
  el.tree.addEventListener("click", (e) => {
    const n = e.target.closest(".node");
    if (
      n?.querySelector(".m") &&
      !e.target.closest(".acts") &&
      matchMedia("(max-width:900px)").matches
    )
      document.querySelector(".app")?.classList.remove("side-open");
  });
  const wsSel = h(
    "select",
    {
      onchange: (e) =>
        e.target.value === "+" ? newWorkspace() : openWorkspace(e.target.value),
    },
    S.workspaces.map((w) =>
      h("option", { value: w.id, selected: w.id === S.ws?.id }, w.name),
    ),
    h("option", { value: "+" }, "+ New workspace"),
  );
  const envSel = h(
    "select",
    {
      title: "Environment",
      onchange: (e) => {
        S.envId = e.target.value || null;
      },
    },
    h("option", { value: "" }, "No environment"),
    S.envs.map((x) =>
      h("option", { value: x.id, selected: x.id === S.envId }, x.name),
    ),
  );
  clear(root).append(
    h(
      "div",
      { class: "app" },
      h(
        "div",
        { class: "top" },
        h(
          "button",
          {
            class: "ghost menu-btn",
            title: "Menu",
            onclick: () =>
              document.querySelector(".app").classList.toggle("side-open"),
          },
          ic("bars"),
        ),
        h(
          "div",
          { class: "brand" },
          h("span", { class: "logo" }, ic("bolt")),
          h("span", {}, "API Client"),
        ),
        wsSel,
        S.ws ? h("span", { class: "muted" }, S.ws.role) : null,
        h("span", { class: "sp" }),
        S.ws
          ? [
              envSel,
              h(
                "button",
                {
                  onclick: guard(envModal),
                  title: "Manage environments & variables",
                },
                ...lb("layer-group", "Environments"),
              ),
              h(
                "button",
                { onclick: guard(membersModal) },
                ...lb("users", "Members"),
              ),
              h(
                "button",
                {
                  title: "Import / Export (Postman, Hoppscotch)",
                  onclick: guard(async () => {
                    if (
                      await openInterop({
                        api,
                        W,
                        collections: S.tree.collections,
                        canWrite: canWrite(),
                      })
                    ) {
                      await reloadTree();
                      S.envs = await api("GET", W("/environments"));
                      renderShell();
                    }
                  }),
                },
                ...lb("right-left", "Import / Export"),
              ),
            ]
          : null,
        h(
          "button",
          {
            onclick: () => {
              const t =
                document.documentElement.dataset.theme === "dark"
                  ? "light"
                  : "dark";
              localStorage.setItem("theme", t);
              document.documentElement.dataset.theme = t;
            },
            title: "Toggle theme",
          },
          ic("circle-half-stroke"),
        ),
        h(
          "span",
          { class: "user" },
          ic("circle-user"),
          h("span", { class: "lbl" }, S.user.name),
        ),
        h(
          "button",
          {
            title: "Logout",
            onclick: async () => {
              await api("POST", "/auth/logout");
              S.user = null;
              boot();
            },
          },
          ...lb("right-from-bracket", "Logout"),
        ),
      ),
      h("div", {
        class: "scrim",
        onclick: () =>
          document.querySelector(".app").classList.remove("side-open"),
      }),
      h(
        "div",
        { class: "side" },
        h(
          "div",
          { class: "side-tabs" },
          ["collections", "history"].map((t) =>
            h(
              "button",
              {
                class: S.side === t ? "on" : "",
                onclick: () => {
                  S.side = t;
                  renderShell();
                  if (t === "history") loadHistory();
                },
              },
              t === "collections"
                ? lb("folder-tree", "Collections")
                : lb("clock-rotate-left", "History"),
            ),
          ),
        ),
        S.side === "collections"
          ? h(
              "div",
              { class: "side-tools" },
              h("input", {
                type: "search",
                placeholder: "Search…",
                value: S.filter,
                oninput: debounce((e) => {
                  S.filter = e.target.value;
                  renderTree();
                }, 200),
              }),
              canWrite()
                ? h(
                    "button",
                    {
                      onclick: guard(() => addCollection(null)),
                      title: "New collection",
                    },
                    ic("plus"),
                  )
                : null,
            )
          : h(
              "div",
              { class: "side-tools" },
              h(
                "button",
                {
                  onclick: guard(async () => {
                    await api("DELETE", W("/history"));
                    S.history = [];
                    renderTree();
                  }),
                },
                ...lb("trash-can", "Clear history"),
              ),
            ),
        el.tree,
      ),
      S.ws
        ? h(
            "div",
            { class: "main" },
            el.tabs,
            h("div", { class: "split" }, el.editor, el.resp),
          )
        : h(
            "div",
            { class: "empty" },
            h(
              "div",
              {},
              h("i", { class: "fa-solid fa-briefcase big" }),
              h("p", {}, "Create a workspace to get started"),
              h(
                "button",
                { class: "primary", onclick: newWorkspace },
                ic("plus"),
                "New workspace",
              ),
            ),
          ),
      h(
        "div",
        { class: `console ${S.consoleOpen ? "" : "closed"}` },
        h(
          "div",
          { class: "console-h" },
          h("b", {}, ic("terminal"), "Console"),
          h(
            "button",
            {
              class: "ghost",
              onclick: () => {
                S.logs = [];
                renderConsole();
              },
            },
            ...lb("eraser", "Clear"),
          ),
          h(
            "button",
            {
              class: "ghost",
              onclick: () => {
                S.consoleOpen = !S.consoleOpen;
                renderShell();
              },
            },
            ic(S.consoleOpen ? "chevron-down" : "chevron-up"),
          ),
        ),
        el.log,
      ),
    ),
  );
  renderTree();
  renderTabs();
  renderEditor();
  renderResp();
  renderConsole();
}
const newWorkspace = guard(async () => {
  const name = await ask("Workspace name");
  if (!name) return renderShell();
  const w = await api("POST", "/workspaces", { name });
  S.workspaces = await api("GET", "/workspaces");
  await openWorkspace(w.id);
});

// ---------- tree ----------
const byPos = (a, b) => a.position - b.position || a.name.localeCompare(b.name);
function renderTree() {
  clear(el.tree);
  if (S.side === "history") {
    if (!S.history.length)
      el.tree.append(
        h("div", { class: "muted", style: { padding: 10 } }, "No history yet"),
      );
    for (const x of S.history)
      el.tree.append(
        h(
          "div",
          {
            class: "node",
            title: x.created_at,
            onclick: guard(() => openHistory(x.id)),
          },
          h("span", { class: `m m-${x.method}` }, x.method),
          h("span", { class: "nm" }, x.url || "(empty)"),
          h(
            "span",
            { class: x.status >= 400 || !x.status ? "err" : "ok" },
            x.status ?? "✗",
          ),
        ),
      );
    return;
  }
  const { collections, requests } = S.tree;
  const f = S.filter.toLowerCase();
  const kidsC = new Map(),
    kidsR = new Map();
  for (const c of collections) {
    const k = c.parent_id ?? null;
    (kidsC.get(k) ?? kidsC.set(k, []).get(k)).push(c);
  }
  for (const r of requests)
    (
      kidsR.get(r.collection_id) ??
      kidsR.set(r.collection_id, []).get(r.collection_id)
    ).push(r);
  const matches = (c) =>
    !f ||
    c.name.toLowerCase().includes(f) ||
    (kidsR.get(c.id) ?? []).some((r) =>
      (r.name + r.url).toLowerCase().includes(f),
    ) ||
    (kidsC.get(c.id) ?? []).some(matches);
  const guideEls = (guides, last) =>
    h(
      "span",
      { class: "guides" },
      guides.map((on) => h("span", { class: `g ${on ? "line" : ""}` })),
      h("span", { class: `g ${last ? "elbow" : "tee"}` }),
    );
  const draw = (parent, depth, guides, pc) => {
    const items = [
      ...(kidsC.get(parent) ?? [])
        .sort(byPos)
        .filter(matches)
        .map((c) => ({ c })),
      ...(pc
        ? (kidsR.get(parent) ?? [])
            .sort(byPos)
            .filter(
              (r) =>
                !f ||
                (r.name + r.method).toLowerCase().includes(f) ||
                pc.name.toLowerCase().includes(f),
            )
            .map((r) => ({ r }))
        : []),
    ];
    items.forEach((it, i) => {
      const last = i === items.length - 1,
        g = depth ? guideEls(guides, last) : null;
      if (it.r) {
        el.tree.append(requestRow(it.r, g));
        return;
      }
      const c = it.c;
      const open = S.expanded.has(c.id) || !!f;
      const row = h(
        "div",
        {
          class: "node",
          draggable: canWrite(),
          onclick: () => {
            open ? S.expanded.delete(c.id) : S.expanded.add(c.id);
            renderTree();
          },
          ondragstart: () => (S.dragging = { type: "collection", id: c.id }),
          ondragover: (e) => {
            if (S.dragging) {
              e.preventDefault();
              row.classList.add("over");
            }
          },
          ondragleave: () => row.classList.remove("over"),
          ondrop: guard((e) => {
            e.preventDefault();
            row.classList.remove("over");
            return dropOn({ type: "collection", id: c.id });
          }),
        },
        g,
        ic(open ? "chevron-down" : "chevron-right"),
        ic(open ? "folder-open" : "folder"),
        h("span", { class: "nm" }, c.name),
        c.has_pre || c.has_post
          ? h(
              "span",
              {
                class: "sc",
                title: `Collection script: ${[c.has_pre && "pre-request", c.has_post && "post-request"].filter(Boolean).join(" + ")} (inherited by every request inside)`,
              },
              ic("code"),
            )
          : null,
        canWrite()
          ? h(
              "span",
              { class: "acts" },
              h(
                "button",
                {
                  class: "ghost",
                  title: "New request",
                  onclick: guard(async (e) => {
                    e.stopPropagation();
                    await newRequestIn(c.id);
                  }),
                },
                ic("file-circle-plus"),
              ),
              h(
                "button",
                {
                  class: "ghost",
                  title: "New sub-collection",
                  onclick: guard(async (e) => {
                    e.stopPropagation();
                    await addCollection(c.id);
                  }),
                },
                ic("folder-plus"),
              ),
              h(
                "button",
                {
                  class: "ghost",
                  title: "Actions",
                  onclick: (e) => {
                    e.stopPropagation();
                    collectionMenu(c, e.currentTarget);
                  },
                },
                ic("ellipsis"),
              ),
            )
          : null,
      );
      el.tree.append(row);
      if (open) draw(c.id, depth + 1, depth ? [...guides, !last] : [], c);
    });
  };
  draw(null, 0, [], null);
  if (!collections.length)
    el.tree.append(
      h(
        "div",
        { class: "muted", style: { padding: 10 } },
        canWrite()
          ? "No collections yet. Click + to create one."
          : "No collections yet.",
      ),
    );
}
function requestRow(r, g) {
  const row = h(
    "div",
    {
      class: `node ${S.active === r.id ? "sel" : ""}`,
      draggable: canWrite(),
      onclick: guard(() => openRequest(r.id)),
      ondragstart: () => (S.dragging = { type: "request", id: r.id }),
      ondragover: (e) => {
        if (S.dragging?.type === "request") {
          e.preventDefault();
          row.classList.add("over");
        }
      },
      ondragleave: () => row.classList.remove("over"),
      ondrop: guard((e) => {
        e.preventDefault();
        row.classList.remove("over");
        return dropOn({
          type: "before",
          id: r.id,
          collection_id: r.collection_id,
        });
      }),
    },
    g,
    h("span", { class: `m m-${r.method}` }, r.method),
    h("span", { class: "nm" }, r.name),
    h(
      "span",
      { class: "acts" },
      h(
        "button",
        {
          class: "ghost",
          title: "Run",
          onclick: guard(async (e) => {
            e.stopPropagation();
            await openRequest(r.id);
            send();
          }),
        },
        ic("play"),
      ),
      canWrite()
        ? h(
            "button",
            {
              class: "ghost",
              title: "Actions",
              onclick: (e) => {
                e.stopPropagation();
                requestMenu(r, e.currentTarget);
              },
            },
            ic("ellipsis"),
          )
        : null,
    ),
  );
  return row;
}
function menu(anchor, items) {
  document.querySelector(".ctx")?.remove();
  const r = anchor.getBoundingClientRect();
  const m = h(
    "div",
    {
      class: "ctx",
      style: {
        position: "fixed",
        left: Math.min(r.left, innerWidth - 190) + "px",
        top: r.bottom + "px",
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: "8px",
        zIndex: 15,
        minWidth: "170px",
        padding: "4px",
      },
    },
    items.map(([label, fn, danger]) =>
      h(
        "div",
        {
          class: "node",
          style: danger ? { color: "var(--err)" } : {},
          onclick: () => {
            m.remove();
            guard(fn)();
          },
        },
        label,
      ),
    ),
  );
  document.body.append(m);
  setTimeout(() =>
    document.addEventListener("click", () => m.remove(), { once: true }),
  );
}
const collectionMenu = (c, a) =>
  menu(a, [
    ["Settings (vars/auth/scripts)", () => collectionSettings(c.id)],
    [
      "Rename",
      async () => {
        const n = await ask("Rename collection", c.name);
        if (n) {
          await api("PATCH", W(`/collections/${c.id}`), { name: n });
          reloadTree();
        }
      },
    ],
    [
      "Duplicate",
      async () => {
        await api("POST", W(`/collections/${c.id}/duplicate`));
        reloadTree();
      },
    ],
    [
      "Move to root",
      async () => {
        await api("PATCH", W(`/collections/${c.id}`), { parent_id: null });
        reloadTree();
      },
    ],
    ["Sort A–Z", () => sortChildren(c.id)],
    [
      "Export as Postman",
      guard(() =>
        exportRemote(api, W, { format: "postman", collection: c.id }),
      ),
    ],
    [
      "Export as Hoppscotch",
      guard(() =>
        exportRemote(api, W, { format: "hoppscotch", collection: c.id }),
      ),
    ],
    [
      "Delete",
      async () => {
        if (await confirmBox(`Delete "${c.name}" and everything inside it?`)) {
          await api("DELETE", W(`/collections/${c.id}`));
          S.tabs = S.tabs.filter(
            (t) =>
              !t.id ||
              S.tree.requests.find((r) => r.id === t.id)?.collection_id !==
                c.id,
          );
          await reloadTree();
          const gone = new Set(S.tree.requests.map((r) => r.id));
          S.tabs = S.tabs.filter((t) => !t.id || gone.has(t.id));
          renderTabs();
          renderEditor();
        }
      },
      true,
    ],
  ]);
const requestMenu = (r, a) =>
  menu(a, [
    [
      "Rename",
      async () => {
        const n = await ask("Rename request", r.name);
        if (n) {
          const full = await api("GET", W(`/requests/${r.id}`));
          await api("PUT", W(`/requests/${r.id}`), { ...full, name: n });
          const t = S.tabs.find((t) => t.id === r.id);
          if (t) t.req.name = n;
          await reloadTree();
          renderTabs();
        }
      },
    ],
    [
      "Duplicate",
      async () => {
        await api("POST", W(`/requests/${r.id}/duplicate`));
        reloadTree();
      },
    ],
    [
      "Delete",
      async () => {
        if (await confirmBox(`Delete request "${r.name}"?`)) {
          await api("DELETE", W(`/requests/${r.id}`));
          S.tabs = S.tabs.filter((t) => t.id !== r.id);
          await reloadTree();
          activate(S.tabs.at(-1)?.key ?? null);
        }
      },
      true,
    ],
  ]);
async function addCollection(parent) {
  const name = await ask(parent ? "Sub-collection name" : "Collection name");
  if (!name) return;
  const c = await api("POST", W("/collections"), { name, parent_id: parent });
  if (parent) S.expanded.add(parent);
  S.expanded.add(c.id);
  await reloadTree();
}
async function sortChildren(id) {
  const items = [
    ...S.tree.collections
      .filter((c) => c.parent_id === id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c, i) => ({ type: "collection", id: c.id, position: i })),
    ...S.tree.requests
      .filter((r) => r.collection_id === id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r, i) => ({ type: "request", id: r.id, position: i })),
  ];
  await api("POST", W("/reorder"), items);
  reloadTree();
}
async function dropOn(target) {
  const d = S.dragging;
  S.dragging = null;
  if (!d || d.id === target.id) return;
  if (target.type === "collection") {
    if (d.type === "request")
      await api("PATCH", W(`/requests/${d.id}/move`), {
        collection_id: target.id,
      });
    else
      await api("PATCH", W(`/collections/${d.id}`), { parent_id: target.id });
    S.expanded.add(target.id);
  } else if (d.type === "request") {
    // place before target request
    await api("PATCH", W(`/requests/${d.id}/move`), {
      collection_id: target.collection_id,
    });
    const order = S.tree.requests
      .filter((r) => r.collection_id === target.collection_id && r.id !== d.id)
      .sort(byPos);
    const i = order.findIndex((r) => r.id === target.id);
    order.splice(i, 0, { id: d.id });
    await api(
      "POST",
      W("/reorder"),
      order.map((r, p) => ({ type: "request", id: r.id, position: p })),
    );
  }
  await reloadTree();
}

// ---------- tabs ----------
let keySeq = 0;
function addTab(req, { id = null, collection_id = null } = {}) {
  const t = {
    key: "t" + ++keySeq,
    id,
    collection_id,
    req,
    dirty: false,
    response: null,
    sub: "params",
  };
  S.tabs.push(t);
  activate(t.key);
  return t;
}
const activeTab = () => S.tabs.find((t) => t.key === S.active);
function activate(key) {
  S.active = key;
  renderTabs();
  renderEditor();
  renderResp();
  renderTree();
}
const openRequest = async (id) => {
  const ex = S.tabs.find((t) => t.id === id);
  if (ex) return activate(ex.key);
  const r = await api("GET", W(`/requests/${id}`));
  addTab(r, { id, collection_id: r.collection_id });
};
const newRequestIn = async (cid) => {
  const name = await ask("Request name", "New Request");
  if (!name) return;
  const r = await api("POST", W(`/collections/${cid}/requests`), {
    ...blankReq(),
    name,
  });
  S.expanded.add(cid);
  await reloadTree();
  addTab(r, { id: r.id, collection_id: cid });
};
function renderTabs() {
  clear(el.tabs).append(
    ...S.tabs.map((t) =>
      h(
        "div",
        {
          class: `tab ${t.key === S.active ? "on" : ""}`,
          onclick: () => activate(t.key),
        },
        h("span", { class: `m m-${t.req.method}` }, t.req.method),
        h("span", {}, t.req.name),
        t.dirty ? h("span", { class: "dirty", title: "Unsaved" }, "●") : null,
        h(
          "button",
          {
            class: "ghost",
            onclick: async (e) => {
              e.stopPropagation();
              if (t.dirty && !confirm("Discard unsaved changes?")) return;
              S.tabs = S.tabs.filter((x) => x !== t);
              if (S.active === t.key) S.active = S.tabs.at(-1)?.key ?? null;
              renderTabs();
              renderEditor();
              renderResp();
              renderTree();
            },
          },
          ic("xmark"),
        ),
      ),
    ),
    h(
      "button",
      {
        class: "ghost",
        title: "New request tab",
        onclick: () => addTab(blankReq()),
      },
      "+",
    ),
  );
}

// ---------- editor ----------
function renderEditor() {
  clear(el.editor);
  const t = activeTab();
  if (!t)
    return el.editor.append(
      h(
        "div",
        { class: "empty" },
        h(
          "div",
          {},
          h("p", {}, "Open a request from the tree, or"),
          h("button", { onclick: () => addTab(blankReq()) }, "New request"),
        ),
      ),
    );
  const r = t.req,
    ro = !canWrite() && t.id;
  const touch = () => {
    if (!t.dirty) {
      t.dirty = true;
      renderTabs();
    }
  };
  const url = h("input", {
    value: r.url,
    placeholder: "https://api.example.com/users  or  {{baseUrl}}/users",
    spellcheck: "false",
    oninput: (e) => {
      r.url = e.target.value;
      touch();
    },
    onchange: () => {
      const i = r.url.indexOf("?");
      if (i > -1 && !r.url.includes("{{", i)) {
        r.params = nonBlank(r.params);
        for (const [k, v] of new URLSearchParams(r.url.slice(i + 1)))
          r.params.push({ key: k, value: v, enabled: true });
        r.url = r.url.slice(0, i);
        url.value = r.url;
        if (t.sub === "params") renderSub();
      }
    },
  });
  const method = h(
    "select",
    {
      onchange: (e) => {
        r.method = e.target.value;
        touch();
        renderTabs();
      },
    },
    METHODS.map((m) => h("option", { selected: m === r.method }, m)),
  );
  const body = h("div", { class: "scroll" });
  const subBtns = h("div", { class: "subtabs" });
  const sections = {
    params: "Params",
    headers: "Headers",
    body: "Body",
    auth: "Auth",
    pre: "Pre-request",
    post: "Post-request",
    docs: "Description",
  };
  const inhCount = (k) =>
    (t.inh ?? []).filter((x) =>
      x[k === "pre" ? "pre_script" : "post_script"]?.trim(),
    ).length;
  function renderBtns() {
    clear(subBtns).append(
      ...Object.entries(sections).map(([k, l]) =>
        h(
          "button",
          {
            class: t.sub === k ? "on" : "",
            onclick: () => {
              t.sub = k;
              renderSub();
            },
          },
          l,
          k === "params" && r.params.filter((p) => p.key).length
            ? ` (${r.params.filter((p) => p.key).length})`
            : "",
          (k === "pre" || k === "post") && inhCount(k)
            ? h(
                "span",
                {
                  class: "badge",
                  title: `${inhCount(k)} inherited collection script(s) run before this request's own script`,
                },
                ic("folder-tree"),
                inhCount(k),
              )
            : null,
        ),
      ),
    );
  }
  el.sub = {
    refresh: () =>
      t.sub === "pre" || t.sub === "post" ? renderSub() : renderBtns(),
  };
  function renderSub() {
    renderBtns();
    clear(body);
    const ch = () => touch();
    if (t.sub === "params")
      body.append(kvEditor(r.params, { readOnly: ro, onChange: ch }));
    if (t.sub === "headers")
      body.append(kvEditor(r.headers, { readOnly: ro, onChange: ch }));
    if (t.sub === "body") {
      r.body ??= { mode: "none" };
      body.append(bodyEditor(r.body, { readOnly: ro, onChange: ch }));
    }
    if (t.sub === "auth") {
      r.auth ??= { type: "inherit" };
      body.append(authEditor(r.auth, { readOnly: ro, onChange: ch }));
    }
    if (t.sub === "pre")
      body.append(
        inheritedPanel(t, "pre"),
        h(
          "div",
          { class: "muted" },
          "Runs before the request (collection scripts run first). e.g. ",
          h("code", {}, 'pm.variables.set("timestamp", Date.now())'),
        ),
        h(
          "div",
          { style: { height: "320px" } },
          codeEditor(r.pre_script, {
            lang: "js",
            readOnly: ro,
            onChange: (v) => {
              r.pre_script = v;
              ch();
            },
          }),
        ),
      );
    if (t.sub === "post")
      body.append(
        inheritedPanel(t, "post"),
        h(
          "div",
          { class: "muted" },
          "Runs after the response. APIs: ",
          h(
            "code",
            {},
            "pm.environment.set/get, response.json(), response.status, test(name, fn), expect(x).toBe(y)",
          ),
        ),
        h(
          "div",
          { style: { height: "320px" } },
          codeEditor(r.post_script, {
            lang: "js",
            readOnly: ro,
            onChange: (v) => {
              r.post_script = v;
              ch();
            },
          }),
        ),
      );
    if (t.sub === "docs")
      body.append(
        h("textarea", {
          rows: 8,
          disabled: ro,
          placeholder: "Description…",
          value: r.description,
          style: { fontFamily: "inherit" },
          oninput: (e) => {
            r.description = e.target.value;
            ch();
          },
        }),
      );
  }
  const name = h("input", {
    value: r.name,
    style: { fontWeight: 600, border: 0, background: "none", flex: 1 },
    disabled: ro,
    "aria-label": "Request name",
    oninput: (e) => {
      r.name = e.target.value;
      touch();
    },
    onchange: renderTabs,
  });
  el.editor.append(
    h(
      "div",
      { class: "urlbar", style: { paddingBottom: 0, borderBottom: 0 } },
      name,
      h(
        "button",
        { onclick: guard(save), disabled: ro, title: "Ctrl+S" },
        ic("floppy-disk"),
        "Save",
      ),
    ),
    h(
      "div",
      { class: "urlbar" },
      method,
      url,
      h(
        "button",
        { class: "primary", id: "sendBtn", onclick: send, title: "Ctrl+Enter" },
        ic("paper-plane"),
        "Send",
      ),
    ),
    subBtns,
    body,
  );
  renderSub();
  loadInherited(t);
}

// Reference to the collection-level pre/post scripts that also run for this request (read-only, expandable, jump to edit).
function inheritedPanel(t, kind) {
  const f = kind === "pre" ? "pre_script" : "post_script",
    list = (t.inh ?? []).filter((x) => x[f]?.trim());
  if (!list.length) return document.createDocumentFragment();
  return h(
    "div",
    { class: "inh" },
    h(
      "div",
      { class: "inh-h" },
      ic("folder-tree"),
      h(
        "b",
        {},
        `Inherited ${kind === "pre" ? "pre-request" : "post-request"} script${list.length > 1 ? "s" : ""} from ${list.length} collection${list.length > 1 ? "s" : ""}`,
      ),
      h(
        "span",
        { class: "muted" },
        "These run first (outermost \u2192 nearest collection), then this request\u2019s own script.",
      ),
    ),
    list.map((x, i) =>
      h(
        "details",
        { class: "inh-item" },
        h(
          "summary",
          {},
          h("span", { class: "inh-n" }, i + 1),
          ic("folder"),
          h("span", { class: "nm", title: x.path }, x.path),
          canWrite()
            ? h(
                "button",
                {
                  class: "ghost",
                  title: "Edit in collection settings",
                  onclick: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    guard(() => collectionSettings(x.id, kind))();
                  },
                },
                ic("pen"),
              )
            : null,
        ),
        h(
          "div",
          { class: "inh-code" },
          codeEditor(x[f], { lang: "js", readOnly: true }),
        ),
      ),
    ),
  );
}
async function save() {
  const t = activeTab();
  if (!t || !canWrite()) return;
  if (!t.id) {
    // draft -> choose collection
    if (!S.tree.collections.length)
      return toast("Create a collection first", "error");
    const path = (c) => {
      const p = [];
      let x = c;
      while (x) {
        p.unshift(x.name);
        x = S.tree.collections.find((y) => y.id === x.parent_id);
      }
      return p.join(" / ");
    };
    const cid = await modal("Save request to…", (b, close) => {
      const sel = h(
        "select",
        {},
        S.tree.collections.map((c) => h("option", { value: c.id }, path(c))),
      );
      b.append(
        sel,
        h(
          "div",
          { class: "row end" },
          h(
            "button",
            { class: "primary", onclick: () => close(sel.value) },
            ic("floppy-disk"),
            "Save",
          ),
        ),
      );
    });
    if (!cid) return;
    const r = await api(
      "POST",
      W(`/collections/${cid}/requests`),
      cleanReq(t.req),
    );
    t.id = r.id;
    t.collection_id = cid;
    S.expanded.add(cid);
  } else await api("PUT", W(`/requests/${t.id}`), cleanReq(t.req));
  t.dirty = false;
  toast("Saved", "ok");
  await reloadTree();
  renderTabs();
}

// ---------- send / response / console ----------
async function send() {
  const t = activeTab();
  if (!t || t.running) return;
  t.running = true;
  renderResp();
  try {
    t.response = await api("POST", W("/run"), {
      request: cleanReq(t.req),
      collection_id: t.collection_id,
      environment_id: S.envId,
    });
    S.logs.push(...t.response.logs);
  } catch (e) {
    t.response = {
      error: { phase: "internal", message: e.message },
      tests: [],
      logs: [],
    };
    S.logs.push({
      ts: new Date().toISOString(),
      level: "ERROR",
      message: e.message,
    });
  }
  t.running = false;
  if (S.active === t.key) renderResp();
  renderConsole();
  if (S.envId && canWrite())
    api("GET", W("/environments"))
      .then((e) => {
        S.envs = e;
      })
      .catch(() => {});
  if (S.side === "history") loadHistory();
}
function renderResp() {
  const t = activeTab();
  if (!t)
    return clear(el.resp).append(h("div", { class: "empty" }, "Response"));
  renderResponse(el.resp, t);
}
function renderConsole() {
  clear(el.log).append(
    ...S.logs
      .slice(-500)
      .map((l) =>
        h(
          "div",
          { class: `L-${l.level}` },
          `${l.ts?.slice(11, 23) ?? ""} [${l.level}] ${l.message}`,
          l.context
            ? h("span", { class: "muted" }, " " + JSON.stringify(l.context))
            : null,
        ),
      ),
  );
  el.log.scrollTop = el.log.scrollHeight;
}
const loadHistory = guard(async () => {
  S.history = await api("GET", W("/history"));
  renderTree();
});
const openHistory = async (id) => {
  const x = await api("GET", W(`/history/${id}`));
  addTab(
    {
      ...blankReq(),
      ...x.snapshot.request,
      name: `${x.method} ${x.url}`.slice(0, 40),
    },
    { collection_id: x.snapshot.collection_id },
  );
};

// ---------- modals ----------
async function collectionSettings(id, startTab = "vars") {
  const c = await api("GET", W(`/collections/${id}`));
  const d = clone(c);
  await modal(`Collection: ${c.name}`, (b, close) => {
    const tabs = h("div", { class: "subtabs" }),
      pane = h("div", { style: { minHeight: "280px" } });
    let cur = startTab;
    const draw = () => {
      clear(tabs).append(
        ...[
          ["vars", "Variables"],
          ["auth", "Authorization"],
          ["pre", "Pre-request"],
          ["post", "Post-request"],
        ].map(([k, l]) =>
          h(
            "button",
            {
              class: cur === k ? "on" : "",
              onclick: () => {
                cur = k;
                draw();
              },
            },
            l,
          ),
        ),
      );
      clear(pane).append(
        cur === "vars"
          ? kvEditor(d.variables)
          : cur === "auth"
            ? authEditor((d.auth ??= { type: "none" }), {
                onChange() {},
                allowInherit: false,
              })
            : h(
                "div",
                { style: { height: "280px" } },
                codeEditor(d[cur === "pre" ? "pre_script" : "post_script"], {
                  lang: "js",
                  onChange: (v) => {
                    d[cur === "pre" ? "pre_script" : "post_script"] = v;
                  },
                }),
              ),
      );
    };
    draw();
    b.append(
      tabs,
      pane,
      h(
        "div",
        { class: "muted" },
        "Variables, auth and scripts here apply to every request in this collection and its sub-collections.",
      ),
      h(
        "div",
        { class: "row end" },
        h("button", { onclick: () => close() }, ic("xmark"), "Cancel"),
        h(
          "button",
          {
            class: "primary",
            onclick: guard(async () => {
              await api("PATCH", W(`/collections/${id}`), {
                variables: d.variables.filter((v) => v.key),
                auth: d.auth,
                pre_script: d.pre_script,
                post_script: d.post_script,
              });
              toast("Collection saved", "ok");
              close();
              await reloadTree();
            }),
          },
          ic("floppy-disk"),
          "Save",
        ),
      ),
    );
  });
}
async function envModal() {
  const wsFull = await api("GET", W());
  const items = [
    {
      id: "__ws",
      name: "Workspace (global) variables",
      variables: wsFull.variables,
    },
    ...clone(S.envs),
  ];
  let sel = items.find((i) => i.id === S.envId) ?? items[1] ?? items[0];
  await modal("Environments & variables", (b, close) => {
    let fmt = "postman";
    const saveSel = async () => {
      const vars = sel.variables.filter((v) => v.key);
      if (sel.id === "__ws") await api("PATCH", W(), { variables: vars });
      else
        await api("PUT", W(`/environments/${sel.id}`), {
          name: sel.name,
          variables: vars,
        });
      sel.dirty = false;
    };
    const importFiles = guard(async (input) => {
      let added = 0,
        notes = 0;
      const files = [...input.files];
      input.value = "";
      for (const f of files) {
        try {
          const r = await api("POST", W("/import"), {
            data: JSON.parse(await f.text()),
            only: "environment",
          });
          added += r.environments;
          notes += r.warnings?.length ?? 0;
        } catch (e) {
          toast(
            `${f.name}: ${e instanceof SyntaxError ? "not valid JSON" : e.message}`,
            "error",
          );
        }
      }
      if (!added) return;
      const fresh = await api("GET", W("/environments")),
        news = fresh.filter((e) => !items.some((i) => i.id === e.id));
      items.push(...news);
      sel = news[0] ?? sel;
      toast(
        `Imported ${added} environment${added > 1 ? "s" : ""}${notes ? ` (${notes} notes)` : ""}`,
        "ok",
      );
      draw();
    });
    const pane = h("div");
    const draw = () => {
      clear(b);
      const ro = !canWrite() || (sel.id === "__ws" && !canAdmin());
      const list = h(
        "select",
        {
          onchange: (e) => {
            sel = items.find((i) => i.id === e.target.value);
            draw();
          },
        },
        items.map((i) =>
          h("option", { value: i.id, selected: i === sel }, i.name),
        ),
      );
      sel.variables = sel.variables.filter((v) => v.key);
      const isEnv = sel.id !== "__ws";
      b.append(
        h(
          "div",
          { class: "row" },
          list,
          canWrite()
            ? h(
                "button",
                {
                  onclick: guard(async () => {
                    const n = await ask("Environment name");
                    if (!n) return;
                    const e = await api("POST", W("/environments"), {
                      name: n,
                      variables: [],
                    });
                    items.push(e);
                    sel = e;
                    draw();
                  }),
                },
                "+ New",
              )
            : null,
        ),
        h(
          "div",
          { class: "row env-io" },
          canWrite()
            ? h(
                "label",
                {
                  class: "btn",
                  title:
                    "Import Postman or Hoppscotch environment .json file(s)",
                },
                ic("file-import"),
                h("span", {}, "Import"),
                h("input", {
                  type: "file",
                  accept: ".json,application/json",
                  multiple: true,
                  style: { display: "none" },
                  onchange: (e) => importFiles(e.target),
                }),
              )
            : null,
          h(
            "select",
            {
              title: "Export format",
              "aria-label": "Export format",
              onchange: (e) => {
                fmt = e.target.value;
              },
            },
            [
              ["postman", "Postman (v2.1)"],
              ["hoppscotch", "Hoppscotch"],
              ["hoppscotch:all", "Hoppscotch — all environments"],
            ].map(([v, l]) =>
              h("option", { value: v, selected: v === fmt }, l),
            ),
          ),
          h(
            "button",
            {
              title:
                isEnv || fmt === "hoppscotch:all"
                  ? "Download as JSON"
                  : "Workspace (global) variables are not an environment; pick an environment to export",
              disabled: !isEnv && fmt !== "hoppscotch:all",
              onclick: guard(async () => {
                if (sel.dirty && !ro && isEnv) {
                  await saveSel();
                  toast("Saved", "ok");
                }
                const all = fmt === "hoppscotch:all";
                await exportRemote(api, W, {
                  format: all ? "hoppscotch" : fmt,
                  environment: all ? "all" : sel.id,
                });
              }),
            },
            ic("file-export"),
            "Export",
          ),
        ),
        isEnv
          ? h("input", {
              value: sel.name,
              disabled: ro,
              oninput: (e) => {
                sel.name = e.target.value;
                sel.dirty = true;
              },
            })
          : null,
        kvEditor(sel.variables, {
          readOnly: ro,
          onChange: () => {
            sel.dirty = true;
          },
        }),
        h(
          "div",
          { class: "muted" },
          "Use as {{name}}. Precedence: runtime > request > collection > environment > workspace.",
        ),
        h(
          "div",
          { class: "row end" },
          sel.id !== "__ws" && canWrite()
            ? h(
                "button",
                {
                  class: "danger",
                  onclick: guard(async () => {
                    if (await confirmBox(`Delete environment "${sel.name}"?`)) {
                      await api("DELETE", W(`/environments/${sel.id}`));
                      items.splice(items.indexOf(sel), 1);
                      sel = items[0];
                      draw();
                    }
                  }),
                },
                "Delete",
              )
            : null,
          h("button", { onclick: () => close(true) }, "Close"),
          !ro
            ? h(
                "button",
                {
                  class: "primary",
                  onclick: guard(async () => {
                    await saveSel();
                    toast("Saved", "ok");
                  }),
                },
                ic("floppy-disk"),
                "Save",
              )
            : null,
        ),
      );
    };
    draw();
  });
  S.envs = await api("GET", W("/environments"));
  if (!S.envs.find((e) => e.id === S.envId)) S.envId = S.envs[0]?.id ?? null;
  renderShell();
}
async function membersModal() {
  await modal("Workspace members", async (b, close) => {
    const draw = guard(async () => {
      const members = await api("GET", W("/members"));
      clear(b);
      const roles = ["admin", "editor", "viewer"];
      b.append(
        ...members.map((m) =>
          h(
            "div",
            { class: "row" },
            h(
              "div",
              { style: { flex: 1 } },
              h("b", {}, m.name),
              h("div", { class: "muted" }, m.email),
            ),
            m.role === "owner" || !canAdmin() || m.id === S.user.id
              ? h("span", { class: "muted" }, m.role)
              : h(
                  "select",
                  {
                    onchange: guard(async (e) => {
                      try {
                        await api("PATCH", W(`/members/${m.id}`), {
                          role: e.target.value,
                        });
                        toast("Role updated", "ok");
                      } catch (x) {
                        toast(x.message, "error");
                        draw();
                      }
                    }),
                  },
                  roles.map((r) => h("option", { selected: r === m.role }, r)),
                ),
            m.role !== "owner" && (canAdmin() || m.id === S.user.id)
              ? h(
                  "button",
                  {
                    class: "ghost",
                    title: m.id === S.user.id ? "Leave" : "Remove",
                    onclick: guard(async () => {
                      if (
                        await confirmBox(
                          m.id === S.user.id
                            ? "Leave this workspace?"
                            : `Remove ${m.name}?`,
                        )
                      ) {
                        await api("DELETE", W(`/members/${m.id}`));
                        if (m.id === S.user.id) {
                          close();
                          S.workspaces = await api("GET", "/workspaces");
                          return S.workspaces[0]
                            ? openWorkspace(S.workspaces[0].id)
                            : ((S.ws = null), renderShell());
                        }
                        draw();
                      }
                    }),
                  },
                  ic("xmark"),
                )
              : null,
          ),
        ),
      );
      if (canAdmin()) {
        const em = h("input", {
          type: "email",
          placeholder: "Invite by email (user must have an account)",
          style: { flex: 1 },
        });
        const role = h(
          "select",
          {},
          roles
            .filter((r) => r !== "admin" || S.ws.role === "owner")
            .map((r) => h("option", { selected: r === "viewer" }, r)),
        );
        b.append(
          h("hr", { style: { width: "100%", borderColor: "var(--border)" } }),
          h(
            "div",
            { class: "row" },
            em,
            role,
            h(
              "button",
              {
                class: "primary",
                onclick: guard(async () => {
                  await api("POST", W("/members"), {
                    email: em.value,
                    role: role.value,
                  });
                  toast("Member added", "ok");
                  draw();
                }),
              },
              "Invite",
            ),
          ),
        );
        const log = await api("GET", W("/audit"));
        b.append(
          h(
            "details",
            {},
            h("summary", {}, "Audit log"),
            h(
              "div",
              {
                class: "muted",
                style: {
                  maxHeight: "160px",
                  overflow: "auto",
                  font: "12px var(--mono)",
                },
              },
              log.map((a) =>
                h(
                  "div",
                  {},
                  `${a.created_at} ${a.user ?? "?"} ${a.action} ${a.target ?? ""}`,
                ),
              ),
            ),
          ),
        );
      }
    });
    draw();
  });
}

// ---------- shortcuts ----------
addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (!S.ws || document.querySelector(".overlay")) return;
  if (mod && e.key === "Enter") {
    e.preventDefault();
    send();
  } else if (mod && e.key.toLowerCase() === "s") {
    e.preventDefault();
    guard(save)();
  } else if (mod && e.key === "`") {
    e.preventDefault();
    S.consoleOpen = !S.consoleOpen;
    renderShell();
  } else if (mod && e.key.toLowerCase() === "t") {
    e.preventDefault();
    addTab(blankReq());
  }
});
addEventListener("unhandledrejection", (e) => {
  toast(e.reason?.message ?? "Unexpected error", "error");
});
boot();
