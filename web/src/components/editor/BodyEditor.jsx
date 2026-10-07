import { Tabs } from "../ui/Tabs.jsx";
import { CodeEditor } from "./CodeEditor.jsx";
import { KeyValueEditor } from "./KeyValueEditor.jsx";
import { useT } from "../../i18n/index.js";

export function BodyEditor({ body = { mode: "none" }, onChange, readOnly }) {
  const t = useT();
  // "JSON" and "Multipart"-style names are format names, not prose
  const MODES = [["none", t("body.none")], ["json", "JSON"], ["text", t("body.text")], ["urlencoded", t("body.urlencoded")], ["multipart", t("body.multipart")], ["raw", t("body.raw")]].map(([id, label]) => ({ id, label }));
  const set = (patch) => onChange({ ...body, ...patch });
  return (
    <div className="stack fill">
      <Tabs variant="pill" items={MODES} value={body.mode} onChange={(mode) => !readOnly && set({ mode, content: body.content ?? "", fields: body.fields ?? [] })} />
      {body.mode === "none" && <div className="muted pad">{t("body.noBody")}</div>}
      {["json", "text", "raw"].includes(body.mode) && (
        <div className="grow">
          <CodeEditor value={body.content ?? ""} lang={body.mode === "json" ? "json" : "text"} readOnly={readOnly} onChange={(content) => set({ content })} placeholder={body.mode === "json" ? '{ "key": "value" }' : ""} aria-label={t("body.label")} />
        </div>
      )}
      {["urlencoded", "multipart"].includes(body.mode) && (
        <>
          <KeyValueEditor rows={body.fields ?? []} readOnly={readOnly} onChange={(fields) => set({ fields })} />
          {body.mode === "multipart" && <div className="muted">{t("body.textOnly")}</div>}
        </>
      )}
    </div>
  );
}
