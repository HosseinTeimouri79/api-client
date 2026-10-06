import { h, highlightJson, ic } from "./util.js";

// Key/value table; mutates `list` in place and keeps a trailing empty row.
export function kvEditor(list, { readOnly = false, onChange = () => {} } = {}) {
  const tbody = h("tbody");
  const table = h("table", { class: "kv" }, tbody);
  const render = () => {
    tbody.replaceChildren();
    if (
      !readOnly &&
      (list.length === 0 || list.at(-1).key || list.at(-1).value)
    )
      list.push({ key: "", value: "", enabled: true });
    list.forEach((row, i) => {
      const last = i === list.length - 1 && !readOnly;
      tbody.append(
        h(
          "tr",
          {},
          h(
            "td",
            {},
            last
              ? ""
              : h("input", {
                  type: "checkbox",
                  checked: row.enabled !== false,
                  disabled: readOnly,
                  onchange: (e) => {
                    row.enabled = e.target.checked;
                    onChange();
                  },
                }),
          ),
          h(
            "td",
            {},
            h("input", {
              type: "text",
              placeholder: "Key",
              value: row.key,
              disabled: readOnly,
              oninput: (e) => {
                row.key = e.target.value;
                onChange();
                if (last && e.target.value) {
                  render();
                  tbody.rows[i].cells[1].firstChild.focus();
                }
              },
            }),
          ),
          h(
            "td",
            {},
            h("input", {
              type: "text",
              placeholder: "Value",
              value: row.value,
              disabled: readOnly,
              oninput: (e) => {
                row.value = e.target.value;
                onChange();
                if (last && e.target.value) {
                  render();
                  tbody.rows[i].cells[2].firstChild.focus();
                }
              },
            }),
          ),
          h(
            "td",
            {},
            last || readOnly
              ? ""
              : h(
                  "button",
                  {
                    class: "ghost",
                    title: "Remove",
                    onclick: () => {
                      list.splice(i, 1);
                      render();
                      onChange();
                    },
                  },
                  ic("xmark"),
                ),
          ),
        ),
      );
    });
  };
  render();
  return table;
}

// Textarea over a highlighted <pre>. lang: 'json' | 'js' | 'text'. Shows live JSON validation.
export function codeEditor(
  value,
  {
    lang = "text",
    readOnly = false,
    onChange = () => {},
    placeholder = "",
  } = {},
) {
  const pre = h("pre", { "aria-hidden": "true" });
  const status = h("div", { class: "muted" });
  const ta = h("textarea", {
    spellcheck: "false",
    readonly: readOnly,
    placeholder,
    value,
  });
  const paint = () => {
    const v = ta.value;
    pre.replaceChildren();
    if (lang === "json") {
      pre.append(highlightJson(v));
      try {
        if (v.trim()) {
          JSON.parse(v);
          status.className = "ok";
          status.textContent = "Valid JSON";
        } else status.textContent = "";
      } catch (e) {
        status.className = "err";
        status.textContent = e.message;
      }
    } else pre.append(v);
    pre.append("\n");
  };
  ta.addEventListener("input", () => {
    paint();
    onChange(ta.value);
  });
  ta.addEventListener("scroll", () => {
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  });
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const s = ta.selectionStart;
      ta.setRangeText("  ", s, ta.selectionEnd, "end");
      ta.dispatchEvent(new Event("input"));
    }
  });
  paint();
  const tools =
    lang === "json"
      ? h(
          "div",
          { class: "row" },
          h(
            "button",
            {
              onclick: () => {
                try {
                  ta.value = JSON.stringify(JSON.parse(ta.value), null, 2);
                  ta.dispatchEvent(new Event("input"));
                } catch {
                  /* status shows the error */
                }
              },
            },
            "Format",
          ),
          status,
        )
      : null;
  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", height: "100%" } },
    tools,
    h("div", { class: "code", style: { flex: 1 } }, pre, ta),
  );
}

export function bodyEditor(body, { readOnly, onChange }) {
  const wrap = h("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%",
      gap: "6px",
    },
  });
  const render = () => {
    wrap.replaceChildren();
    const sel = h(
      "select",
      {
        disabled: readOnly,
        onchange: (e) => {
          body.mode = e.target.value;
          body.content ??= "";
          body.fields ??= [];
          onChange();
          render();
        },
      },
      ["none", "json", "text", "urlencoded", "multipart", "raw"].map((m) =>
        h(
          "option",
          { value: m, selected: m === body.mode },
          {
            none: "None",
            json: "JSON",
            text: "Text",
            urlencoded: "Form URL Encoded",
            multipart: "Multipart / Form Data",
            raw: "Raw",
          }[m],
        ),
      ),
    );
    wrap.append(h("div", { class: "row" }, sel));
    if (body.mode === "none")
      wrap.append(h("div", { class: "muted" }, "This request has no body."));
    else if (["json", "text", "raw"].includes(body.mode))
      wrap.append(
        h(
          "div",
          { style: { flex: 1, minHeight: "200px" } },
          codeEditor(body.content ?? "", {
            lang: body.mode === "json" ? "json" : "text",
            readOnly,
            onChange: (v) => {
              body.content = v;
              onChange();
            },
          }),
        ),
      );
    else {
      body.fields ??= [];
      wrap.append(
        kvEditor(body.fields, { readOnly, onChange }),
        body.mode === "multipart"
          ? h(
              "div",
              { class: "muted" },
              "Text fields only in this version (file upload is on the roadmap).",
            )
          : null,
      );
    }
  };
  render();
  return wrap;
}

export function authEditor(auth, { readOnly, onChange, allowInherit = true }) {
  const wrap = h("div", {
    style: { display: "flex", flexDirection: "column", gap: "8px" },
  });
  const f = (label, key, type = "text") =>
    h(
      "label",
      {},
      h("div", { class: "muted" }, label),
      h("input", {
        type,
        value: auth[key] ?? "",
        disabled: readOnly,
        oninput: (e) => {
          auth[key] = e.target.value;
          onChange();
        },
      }),
    );
  const render = () => {
    wrap.replaceChildren(
      h(
        "select",
        {
          disabled: readOnly,
          onchange: (e) => {
            auth.type = e.target.value;
            onChange();
            render();
          },
        },
        ["inherit", "none", "bearer", "basic", "apikey"]
          .filter((t) => allowInherit || t !== "inherit")
          .map((t) =>
            h(
              "option",
              {
                value: t,
                selected:
                  (auth.type ?? (allowInherit ? "inherit" : "none")) === t,
              },
              {
                inherit: "Inherit from collection",
                none: "No auth",
                bearer: "Bearer token",
                basic: "Basic auth",
                apikey: "API key",
              }[t],
            ),
          ),
      ),
    );
    if (auth.type === "bearer") wrap.append(f("Token", "token"));
    if (auth.type === "basic")
      wrap.append(
        f("Username", "username"),
        f("Password", "password", "password"),
      );
    if (auth.type === "apikey")
      wrap.append(
        f("Key name", "key"),
        f("Value", "value"),
        h(
          "select",
          {
            disabled: readOnly,
            onchange: (e) => {
              auth.in = e.target.value;
              onChange();
            },
          },
          ["header", "query"].map((t) =>
            h(
              "option",
              { value: t, selected: (auth.in ?? "header") === t },
              `Add to ${t}`,
            ),
          ),
        ),
      );
    wrap.append(
      h("div", { class: "muted" }, "Tip: use variables such as {{token}}."),
    );
  };
  render();
  return wrap;
}
