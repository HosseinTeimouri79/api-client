import { useState } from "react";
import { useStore, can } from "../store.js";
import { clone } from "../lib/utils.js";
import { Modal } from "../components/ui/Modal.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Field } from "../components/ui/Switch.jsx";
import { toast } from "../components/ui/Toasts.jsx";
import { KeyValueEditor } from "../components/editor/KeyValueEditor.jsx";
import { useT } from "../i18n/index.js";

/** One environment: its name and variables. `env` is null for a new one ("New environment…" in the selector). */
export function EnvFormModal({ close, env = null }) {
  const t = useT();
  const [name, setName] = useState(env?.name ?? "");
  const [variables, setVariables] = useState(() => clone(env?.variables ?? []));
  const [busy, setBusy] = useState(false);
  const ok = name.trim() && !busy;
  const submit = async () => {
    if (!ok) return;
    setBusy(true);
    const { createEnvironment, updateEnvironment } = useStore.getState();
    if (await (env ? updateEnvironment({ id: env.id, name: name.trim(), variables }) : createEnvironment({ name: name.trim(), variables }))) close();
    else setBusy(false);
  };
  return (
    <Modal title={env ? t("env.editTitle") : t("env.newTitle")} size="lg" onClose={() => close()}
      footer={<><Button onClick={() => close()}>{t("common.cancel")}</Button><Button variant="primary" icon={env ? "floppy-disk" : "plus"} disabled={!ok} onClick={submit}>{env ? t("common.save") : t("common.create")}</Button></>}>
      <Field label={t("env.nameLabel")}>
        <input value={name} data-autofocus maxLength={200} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </Field>
      <KeyValueEditor rows={variables} onChange={setVariables} keyPlaceholder={t("col.variable")} />
      <div className="muted">{t("env.help", { example: "{{name}}" })}</div>
    </Modal>
  );
}

/** The workspace's global variables (the lowest scope). Only owners and admins can change them. */
export function GlobalsModal({ close }) {
  const t = useT();
  const { ws, wsVars } = useStore();
  const [rows, setRows] = useState(() => clone(wsVars));
  const [busy, setBusy] = useState(false);
  const ro = !can(ws).admin;
  const save = async () => {
    setBusy(true);
    if (await useStore.getState().saveGlobals(rows)) { toast(t("common.saved"), "ok"); close(); } else setBusy(false);
  };
  return (
    <Modal title={t("env.globals")} size="lg" onClose={() => close()}
      footer={<><Button onClick={() => close()}>{t("common.close")}</Button>{!ro && <Button variant="primary" icon="floppy-disk" loading={busy} onClick={save}>{t("common.save")}</Button>}</>}>
      <KeyValueEditor rows={rows} readOnly={ro} onChange={setRows} keyPlaceholder={t("col.variable")} />
      <div className="muted">{t("env.help", { example: "{{name}}" })}</div>
    </Modal>
  );
}
