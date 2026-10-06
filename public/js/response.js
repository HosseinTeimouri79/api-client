import {
  h,
  clear,
  fmtBytes,
  highlightJson,
  jsonTree,
  debounce,
  ic,
} from "./util.js";

const statusColor = (s) =>
  s >= 500
    ? "var(--err)"
    : s >= 400
      ? "var(--warn)"
      : s >= 300
        ? "var(--accent)"
        : "var(--ok)";
const prettyType = (r) =>
  /json/i.test(r.contentType)
    ? "json"
    : /html/i.test(r.contentType)
      ? "html"
      : /xml/i.test(r.contentType)
        ? "xml"
        : r.binary
          ? "binary"
          : "text";

export function renderResponse(host, tab) {
  clear(host);
  const r = tab.response;
  if (tab.running)
    return host.append(
      h(
        "div",
        { class: "empty" },
        h("div", {}, h("span", { class: "spin" }), " Sending request…"),
      ),
    );
  if (!r)
    return host.append(
      h(
        "div",
        { class: "empty" },
        "Send a request (Ctrl+Enter) to see the response",
      ),
    );
  if (r.error && !r.response)
    return host.append(
      h(
        "div",
        { class: "scroll", style: { padding: "12px" } },
        h(
          "div",
          { class: "errbox" },
          h(
            "b",
            { class: "err" },
            r.error.phase === "script"
              ? "Script Error"
              : r.error.phase === "validation"
                ? "Validation Error"
                : "Request Failed",
          ),
          "\n\n",
          r.error.message,
        ),
        testsView(r.tests),
      ),
    );
  const res = r.response,
    kind = prettyType(res);
  let view = tab.respView ?? (kind === "html" ? "preview" : "pretty"),
    q = "";
  const body = h("div", { class: "scroll" });
  const draw = () => {
    clear(body);
    if (view === "headers") {
      const t = h("table", { class: "kv" });
      for (const x of res.headers.filter(
        (x) => !q || (x.key + x.value).toLowerCase().includes(q.toLowerCase()),
      ))
        t.append(
          h(
            "tr",
            {},
            h(
              "td",
              {
                style: {
                  width: "35%",
                  fontWeight: 600,
                  wordBreak: "break-all",
                },
              },
              x.key,
            ),
            h("td", { style: { wordBreak: "break-all" } }, x.value),
          ),
        );
      return body.append(t);
    }
    if (view === "tests") return body.append(testsView(r.tests));
    if (kind === "binary") {
      const blob = new Blob(
        [Uint8Array.from(atob(res.body), (c) => c.charCodeAt(0))],
        { type: res.contentType || "application/octet-stream" },
      );
      return body.append(
        h(
          "div",
          {},
          `Binary response (${fmtBytes(res.size)}, ${res.contentType || "unknown type"}). `,
          h(
            "a",
            { href: URL.createObjectURL(blob), download: "response.bin" },
            "Download",
          ),
        ),
      );
    }
    if (view === "preview")
      return body.append(
        h("iframe", {
          class: "preview",
          sandbox: "",
          referrerpolicy: "no-referrer",
          srcdoc: res.body,
          title: "Rendered HTML (sandboxed, scripts disabled)",
        }),
      ); // sandbox="" => no scripts, no same-origin
    let parsed;
    if (kind === "json") {
      try {
        parsed = JSON.parse(res.body);
      } catch {
        /* fall back to raw */
      }
    }
    if (view === "pretty" && parsed !== undefined)
      return body.append(h("div", { class: "jt" }, jsonTree(parsed, q)));
    const text =
      view === "pretty" && parsed !== undefined
        ? JSON.stringify(parsed, null, 2)
        : res.body;
    body.append(
      h(
        "div",
        { class: "raw" },
        kind === "json" && parsed !== undefined
          ? highlightJson(text, q)
          : highlight(text, q),
      ),
    );
  };
  const tabBtn = (id, label) =>
    h(
      "button",
      {
        class: view === id ? "on" : "",
        onclick: () => {
          view = tab.respView = id;
          renderResponse(host, tab);
        },
      },
      label,
    );
  const search = h("input", {
    type: "search",
    placeholder: "Search…",
    style: { marginLeft: "auto", width: "140px" },
    oninput: debounce((e) => {
      q = e.target.value;
      draw();
    }, 200),
  });
  const copy = h(
    "button",
    {
      onclick: () =>
        navigator.clipboard?.writeText(
          view === "headers"
            ? res.headers.map((x) => `${x.key}: ${x.value}`).join("\n")
            : res.body,
        ),
    },
    "Copy",
  );
  const fmtBtn =
    kind === "json"
      ? h(
          "button",
          {
            title: "Show formatted raw JSON",
            onclick: () => {
              view = tab.respView = "raw";
              try {
                res.body = JSON.stringify(JSON.parse(res.body), null, 2);
              } catch {
                /* keep */
              }
              renderResponse(host, tab);
            },
          },
          "Format",
        )
      : null;
  const passed = r.tests.filter((t) => t.passed).length;
  host.append(
    h(
      "div",
      { class: "resp-meta" },
      h(
        "span",
        { class: "pill", style: { background: statusColor(res.status) } },
        `${res.status} ${res.statusText}`,
      ),
      h("span", {}, `${res.durationMs} ms`),
      h("span", {}, fmtBytes(res.size)),
      res.redirects.length
        ? h("span", { class: "muted" }, `${res.redirects.length} redirect(s)`)
        : null,
    ),
    h(
      "div",
      { class: "subtabs" },
      tabBtn("pretty", kind === "json" ? "Pretty / Tree" : "Body"),
      tabBtn("raw", "Raw"),
      kind === "html" ? tabBtn("preview", "Preview") : null,
      tabBtn("headers", `Headers (${res.headers.length})`),
      r.tests.length
        ? tabBtn("tests", `Tests ${passed}/${r.tests.length}`)
        : null,
      search,
      fmtBtn,
      copy,
    ),
    body,
  );
  draw();
}
const highlight = (text, q) => {
  if (!q) return text;
  const frag = document.createDocumentFragment();
  for (const p of text.split(
    new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"),
  ))
    frag.append(p.toLowerCase() === q.toLowerCase() ? h("mark", {}, p) : p);
  return frag;
};
const testsView = (tests) =>
  h(
    "div",
    {},
    tests.length
      ? tests.map((t) =>
          h(
            "div",
            {},
            h(
              "b",
              { class: t.passed ? "ok" : "err" },
              t.passed
                ? [ic("circle-check"), " PASS "]
                : [ic("circle-xmark"), " FAIL "],
            ),
            t.name,
            t.error ? h("div", { class: "muted" }, t.error) : null,
          ),
        )
      : h("div", { class: "muted" }, "No tests were run."),
  );
