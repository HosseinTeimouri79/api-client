import { Tabs } from "../ui/Tabs.jsx";
import { CodeEditor } from "./CodeEditor.jsx";
import { KeyValueEditor } from "./KeyValueEditor.jsx";

const MODES = [["none", "None"], ["json", "JSON"], ["text", "Text"], ["urlencoded", "Form URL-encoded"], ["multipart", "Multipart"], ["raw", "Raw"]].map(([id, label]) => ({ id, label }));
export function BodyEditor({ body = { mode: "none" }, onChange, readOnly }) {
  const set = (patch) => onChange({ ...body, ...patch });
  return (
    <div className="stack fill">
      <Tabs variant="pill" items={MODES} value={body.mode} onChange={(mode) => !readOnly && set({ mode, content: body.content ?? "", fields: body.fields ?? [] })} />
      {body.mode === "none" && <div className="muted pad">This request has no body.</div>}
      {["json", "text", "raw"].includes(body.mode) && (
        <div className="grow">
          <CodeEditor value={body.content ?? ""} lang={body.mode === "json" ? "json" : "text"} readOnly={readOnly} onChange={(content) => set({ content })} placeholder={body.mode === "json" ? '{ "key": "value" }' : ""} aria-label="Request body" />
        </div>
      )}
      {["urlencoded", "multipart"].includes(body.mode) && (
        <>
          <KeyValueEditor rows={body.fields ?? []} readOnly={readOnly} onChange={(fields) => set({ fields })} />
          {body.mode === "multipart" && <div className="muted">Text fields only in this version (file upload is on the roadmap).</div>}
        </>
      )}
    </div>
  );
}
