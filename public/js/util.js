// DOM helpers. Everything user-controlled goes through textContent -> no XSS sink.
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") el.className = v;
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = !!v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(Infinity))
    if (k != null && k !== false)
      el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}
export const ic = (n, style = "solid") =>
  h("i", { class: `fa-${style} fa-${n}`, "aria-hidden": "true" });
export const lb = (n, text) => [ic(n), h("span", { class: "lbl" }, text)];
export const clear = (el) => {
  el.replaceChildren();
  return el;
};
export const fmtBytes = (n) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1048576).toFixed(2)} MB`;
export const debounce = (fn, ms = 200) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

// JSON syntax highlighting -> DOM nodes (no innerHTML)
export function highlightJson(text, q = "") {
  const frag = document.createDocumentFragment();
  const re =
    /("(?:\\.|[^"\\])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let last = 0,
    m;
  const push = (s, cls) => {
    if (!s) return;
    if (q && s.toLowerCase().includes(q.toLowerCase())) {
      const parts = s.split(
        new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"),
      );
      for (const p of parts)
        frag.append(
          p.toLowerCase() === q.toLowerCase()
            ? h("mark", {}, p)
            : h("span", { class: cls }, p),
        );
    } else frag.append(cls ? h("span", { class: cls }, s) : s);
  };
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index), "");
    const t = m[0];
    push(
      t,
      t.startsWith('"')
        ? m[2]
          ? "j-key"
          : "j-str"
        : /true|false/.test(t)
          ? "j-bool"
          : t === "null"
            ? "j-null"
            : "j-num",
    );
    last = re.lastIndex;
  }
  push(text.slice(last), "");
  return frag;
}
export function jsonTree(v, q = "", key = null, depth = 0) {
  const match = (s) => q && String(s).toLowerCase().includes(q.toLowerCase());
  const label = (s, cls) =>
    match(s)
      ? h("span", { class: cls }, h("mark", {}, s))
      : h("span", { class: cls }, s);
  const k = key == null ? [] : [label(JSON.stringify(key), "j-key"), ": "];
  if (v !== null && typeof v === "object") {
    const arr = Array.isArray(v),
      entries = arr ? v.map((x, i) => [i, x]) : Object.entries(v);
    const d = h(
      "details",
      { open: q ? true : depth < 2 },
      h(
        "summary",
        {},
        k,
        arr ? `[ ${entries.length} ]` : `{ ${entries.length} }`,
      ),
    );
    for (const [kk, vv] of entries)
      d.append(
        h(
          "div",
          { class: "j-child" },
          jsonTree(vv, q, arr ? null : kk, depth + 1),
        ),
      );
    return d;
  }
  const cls =
    typeof v === "string"
      ? "j-str"
      : typeof v === "number"
        ? "j-num"
        : v === null
          ? "j-null"
          : "j-bool";
  return h("div", { class: "j-leaf" }, k, label(JSON.stringify(v), cls));
}

export function modal(title, build) {
  return new Promise((resolve) => {
    const onKey = (e) => {
      if (
        e.key === "Escape" &&
        [...document.querySelectorAll(".overlay")].at(-1) === overlay
      )
        close(undefined);
    };
    const close = (v) => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(v);
    };
    const body = h("div", { class: "modal-body" });
    const overlay = h(
      "div",
      {
        class: "overlay",
        onmousedown: (e) => e.target === overlay && close(undefined),
      },
      h(
        "div",
        { class: "modal", role: "dialog", "aria-label": title },
        h(
          "div",
          { class: "modal-h" },
          h("b", {}, title),
          h(
            "button",
            { class: "ghost", onclick: () => close(undefined) },
            ic("xmark"),
          ),
        ),
        body,
      ),
    );
    document.body.append(overlay);
    build(body, close);
    document.addEventListener("keydown", onKey);
    (body.querySelector("input,select,textarea") ?? body).focus?.();
  });
}
export const ask = (label, def = "") =>
  modal(label, (body, close) => {
    const i = h("input", {
      value: def,
      onkeydown: (e) =>
        e.key === "Enter" && i.value.trim() && close(i.value.trim()),
    });
    body.append(
      i,
      h(
        "div",
        { class: "row end" },
        h("button", { onclick: () => close(undefined) }, "Cancel"),
        h(
          "button",
          {
            class: "primary",
            onclick: () => i.value.trim() && close(i.value.trim()),
          },
          "OK",
        ),
      ),
    );
    setTimeout(() => {
      i.focus();
      i.select();
    });
  });
export const confirmBox = (msg) =>
  modal("Confirm", (body, close) =>
    body.append(
      h("p", {}, msg),
      h(
        "div",
        { class: "row end" },
        h("button", { onclick: () => close(false) }, "Cancel"),
        h("button", { class: "danger", onclick: () => close(true) }, "Delete"),
      ),
    ),
  );
let toastEl;
export function toast(msg, kind = "info") {
  toastEl ??= document.body.appendChild(h("div", { class: "toasts" }));
  const t = h("div", { class: `toast ${kind}` }, msg);
  toastEl.append(t);
  setTimeout(() => t.remove(), 4000);
}
