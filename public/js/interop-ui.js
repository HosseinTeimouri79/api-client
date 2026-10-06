// Import / Export dialog (Postman + Hoppscotch). All conversion happens on the server (src/services/interop.js).
import { h, clear, modal, toast, ic } from "./util.js";

const LABELS = {
  "postman-collection": "Postman collection",
  "postman-environment": "Postman environment",
  "hoppscotch-collection": "Hoppscotch collection",
  "hoppscotch-environment": "Hoppscotch environment",
};

export function downloadJson(name, data) {
  const a = h("a", {
    href: URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    ),
    download: name,
  });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export async function exportRemote(api, W, query) {
  const r = await api("GET", W("/export?" + new URLSearchParams(query)));
  downloadJson(r.filename, r.data);
  toast(
    r.warnings?.length
      ? `Exported ${r.filename} (${r.warnings.length} notes)`
      : `Exported ${r.filename}`,
    r.warnings?.length ? "info" : "ok",
  );
  return r;
}
const flatten = (cols, parent = null, depth = 0) =>
  cols
    .filter((c) => (c.parent_id ?? null) === parent)
    .flatMap((c) => [{ ...c, depth }, ...flatten(cols, c.id, depth + 1)]);
const indent = (c) =>
  "\u00a0\u00a0".repeat(c.depth) + (c.depth ? "↳ " : "") + c.name;

/** @returns {Promise<boolean>} true when something was imported (caller should refresh the tree/environments) */
export async function openInterop({ api, W, collections, canWrite }) {
  const envs = await api("GET", W("/environments")).catch(() => []),
    cols = flatten(collections);
  let imported = false;
  await modal("Import / Export", (body) => {
    let tab = canWrite ? "import" : "export";
    const view = h("div", { class: "interop" });
    const seg = () =>
      h(
        "div",
        { class: "side-tabs seg" },
        [
          ["import", "file-import", "Import"],
          ["export", "file-export", "Export"],
        ]
          .filter(([k]) => canWrite || k === "export")
          .map(([k, i, t]) =>
            h(
              "button",
              {
                class: tab === k ? "on" : "",
                onclick: () => {
                  tab = k;
                  draw();
                },
              },
              ic(i),
              t,
            ),
          ),
      );

    const importView = () => {
      const results = h("div", { class: "interop-results" }),
        input = h("input", {
          type: "file",
          accept: ".json,application/json",
          multiple: true,
          onchange: () => {
            go.disabled = !input.files.length;
            zoneText.textContent = input.files.length
              ? [...input.files].map((f) => f.name).join(", ")
              : "Click to choose Postman or Hoppscotch .json files";
          },
        });
      const zoneText = h(
        "span",
        {},
        "Click to choose Postman or Hoppscotch .json files",
      );
      const dest = h(
        "select",
        {},
        h("option", { value: "" }, "Workspace root"),
        cols.map((c) => h("option", { value: c.id }, indent(c))),
      );
      const go = h(
        "button",
        {
          class: "primary",
          disabled: true,
          onclick: async () => {
            go.disabled = true;
            clear(results);
            for (const f of input.files) {
              const line = h(
                "div",
                { class: "interop-result" },
                h("span", { class: "spin" }),
                h("span", {}, f.name),
              );
              results.append(line);
              try {
                const r = await api("POST", W("/import"), {
                  data: JSON.parse(await f.text()),
                  parent_id: dest.value || null,
                });
                imported = true;
                const what = r.environments
                  ? `${r.environments} environment(s)`
                  : `${r.collections} collection(s), ${r.requests} request(s)`;
                line.replaceChildren(
                  ic("circle-check"),
                  h(
                    "span",
                    {},
                    `${f.name} — ${LABELS[r.format] ?? r.format}: ${what}`,
                  ),
                );
                line.className = "interop-result ok";
                if (r.warnings?.length)
                  results.append(
                    h(
                      "ul",
                      { class: "interop-warn muted" },
                      r.warnings.map((w) => h("li", {}, w)),
                    ),
                  );
              } catch (e) {
                line.replaceChildren(
                  ic("circle-xmark"),
                  h(
                    "span",
                    {},
                    `${f.name} — ${e instanceof SyntaxError ? "not valid JSON" : e.message}`,
                  ),
                );
                line.className = "interop-result err";
              }
            }
            go.disabled = false;
          },
        },
        ic("file-import"),
        "Import",
      );
      return [
        h(
          "label",
          { class: "dropzone" },
          ic("cloud-arrow-up"),
          zoneText,
          input,
        ),
        h(
          "label",
          { class: "field" },
          h("span", { class: "muted" }, "Destination (collections only)"),
          dest,
        ),
        h("div", { class: "row end" }, go),
        results,
        h(
          "p",
          { class: "muted hint" },
          "Format is detected automatically. Variables, auth, headers, bodies and scripts are converted; unsupported parts are reported as notes.",
        ),
      ];
    };

    const exportView = () => {
      const fmt = h(
        "select",
        { onchange: fill },
        h("option", { value: "postman" }, "Postman (v2.1)"),
        h("option", { value: "hoppscotch" }, "Hoppscotch"),
      );
      const what = h("select", {});
      const go = h(
        "button",
        {
          class: "primary",
          onclick: async () => {
            go.disabled = true;
            try {
              const [kind, id] = what.value.split(":");
              await exportRemote(api, W, {
                format: fmt.value,
                ...(kind === "c" ? { collection: id } : { environment: id }),
              });
            } catch (e) {
              toast(e.message, "error");
            }
            go.disabled = false;
          },
        },
        ic("file-export"),
        "Download",
      );
      function fill() {
        const ph = fmt.value === "hoppscotch";
        clear(what);
        if (cols.length)
          what.append(
            h(
              "optgroup",
              { label: "Collections" },
              ph
                ? h("option", { value: "c:" }, "All top-level collections")
                : null,
              cols.map((c) => h("option", { value: `c:${c.id}` }, indent(c))),
            ),
          );
        if (envs.length)
          what.append(
            h(
              "optgroup",
              { label: "Environments" },
              ph && envs.length > 1
                ? h("option", { value: "e:all" }, "All environments")
                : null,
              envs.map((e) => h("option", { value: `e:${e.id}` }, e.name)),
            ),
          );
        go.disabled = !what.options.length;
      }
      fill();
      return [
        h(
          "label",
          { class: "field" },
          h("span", { class: "muted" }, "Format"),
          fmt,
        ),
        h(
          "label",
          { class: "field" },
          h("span", { class: "muted" }, "What to export"),
          what,
        ),
        h("div", { class: "row end" }, go),
        h(
          "p",
          { class: "muted hint" },
          "Environment secrets are exported with their values. Hoppscotch has no collection-level variables/scripts; inherited auth is copied into each request.",
        ),
      ];
    };
    const draw = () => {
      clear(view).append(...(tab === "import" ? importView() : exportView()));
      clear(body).append(seg(), view);
    };
    draw();
  });
  return imported;
}
