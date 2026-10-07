import { useMemo, useState } from "react";
import { api } from "../api.js";
import { useStore, can } from "../store.js";
import { clone, downloadJson } from "../lib/utils.js";
import { Modal } from "../components/ui/Modal.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Select } from "../components/ui/Select.jsx";
import { Field } from "../components/ui/Switch.jsx";
import { Icon } from "../components/ui/Icon.jsx";
import { toast } from "../components/ui/Toasts.jsx";
import { prompt, confirm } from "../components/ui/dialogs.jsx";
import { KeyValueEditor } from "../components/editor/KeyValueEditor.jsx";
import { exportRemote } from "./InteropModal.jsx";
import { t as tr, useT } from "../i18n/index.js";

const WS = "__ws";
export function EnvModal({ close }) {
  const t = useT();
  const { ws, envs, envId, wsVars } = useStore();
  const { W, guard, refreshEnvs } = useStore.getState();
  const c = can(ws);
  const [items, setItems] = useState(() => [{ id: WS, name: tr("env.globals"), variables: clone(wsVars) }, ...clone(envs)]);
  const [selId, setSelId] = useState(() => (items.find((i) => i.id === envId) ?? items[1] ?? items[0]).id);
  const [fmt, setFmt] = useState("postman");
  const [dirty, setDirty] = useState(false);
  const sel = items.find((i) => i.id === selId) ?? items[0];
  const isEnv = sel.id !== WS;
  const ro = !c.write || (!isEnv && !c.admin);
  const update = (patch) => { setItems((l) => l.map((i) => (i.id === sel.id ? { ...i, ...patch } : i))); setDirty(true); };
  const options = useMemo(() => items.map((i) => ({ value: i.id, label: i.name, icon: i.id === WS ? "globe" : "layer-group" })), [items]);

  const saveSel = async () => {
    const variables = sel.variables.filter((v) => v.key);
    if (!isEnv) await api("PATCH", W(), { variables });
    else await api("PUT", W(`/environments/${sel.id}`), { name: sel.name, variables });
    setDirty(false);
  };
  const done = async () => { if (dirty && !ro && !(await confirm({ title: t("dlg.unsavedTitle"), message: t("env.closeUnsaved"), okText: t("dlg.discard") }))) return; await refreshEnvs(); close(); };
  const create = guard(async () => {
    const name = await prompt({ title: t("env.newTitle"), label: t("env.nameLabel"), okText: t("common.create") });
    if (!name) return;
    const e = await api("POST", W("/environments"), { name, variables: [] });
    setItems((l) => [...l, e]); setSelId(e.id);
  });
  const del = guard(async () => {
    if (!(await confirm({ title: t("env.deleteTitle"), message: t("env.deleteMsg", { name: sel.name }) }))) return;
    await api("DELETE", W(`/environments/${sel.id}`));
    setItems((l) => l.filter((i) => i.id !== sel.id)); setSelId(items[0].id); setDirty(false);
  });
  const importFiles = guard(async (e) => {
    const files = [...e.target.files]; e.target.value = "";
    let added = 0;
    for (const f of files) {
      try { added += (await api("POST", W("/import"), { data: JSON.parse(await f.text()), only: "environment" })).environments; }
      catch (x) { toast(`${f.name}: ${x instanceof SyntaxError ? t("interop.notJson") : x.message}`, "error"); }
    }
    if (!added) return;
    const fresh = await api("GET", W("/environments")), news = fresh.filter((e2) => !items.some((i) => i.id === e2.id));
    setItems((l) => [...l, ...news]); if (news[0]) setSelId(news[0].id);
    toast(t("env.imported", { n: added }), "ok");
  });
  const exp = guard(async () => {
    if (dirty && !ro && isEnv) { await saveSel(); toast(t("common.saved"), "ok"); }
    await exportRemote({ format: fmt, environment: sel.id });
  });

  return (
    <Modal title={t("env.title")} size="lg" onClose={done}
      footer={<>
        {isEnv && c.write && <Button variant="danger" icon="trash-can" className="mr-auto" onClick={del}>{t("common.delete")}</Button>}
        <Button onClick={done}>{t("common.close")}</Button>
        {!ro && <Button variant="primary" icon="floppy-disk" onClick={guard(async () => { await saveSel(); toast(t("common.saved"), "ok"); })}>{t("common.save")}</Button>}
      </>}>
      <div className="row wrap">
        <div className="grow"><Select value={selId} onChange={(v) => setSelId(v)} options={options} aria-label={t("top.environment")} /></div>
        {c.write && <Button icon="plus" onClick={create}>{t("common.new")}</Button>}
        {c.write && <label className="btn btn-default btn-md" title={t("env.importTitle")}><Icon name="file-import" /><span className="btn-label">{t("common.import")}</span><input type="file" accept=".json,application/json" multiple hidden onChange={importFiles} /></label>}
        <Select value={fmt} onChange={setFmt} aria-label={t("interop.format")} options={[{ value: "postman", label: "Postman (v2.1)" }, { value: "hoppscotch", label: "Hoppscotch" }]} />
        <Button icon="file-export" disabled={!isEnv} title={!isEnv ? t("env.pickToExport") : t("env.downloadJson")} onClick={exp}>{t("common.export")}</Button>
      </div>
      {isEnv && <Field label={t("env.name")}><input value={sel.name} disabled={ro} onChange={(e) => update({ name: e.target.value })} /></Field>}
      <KeyValueEditor rows={sel.variables} readOnly={ro} onChange={(variables) => update({ variables })} keyPlaceholder={t("col.variable")} />
      <div className="muted">{t("env.help", { example: "{{name}}" })}</div>
    </Modal>
  );
}
