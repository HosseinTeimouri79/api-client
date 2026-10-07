import { useMemo, useState } from "react";
import { modals } from "../components/ui/modals.js";
import { Modal } from "../components/ui/Modal.jsx";
import { Button } from "../components/ui/Button.jsx";
import { AutoComplete } from "../components/ui/AutoComplete.jsx";
import { useT } from "../i18n/index.js";

export const collectionPath = (collections, c) => {
  const p = [];
  for (let x = c; x; x = collections.find((y) => y.id === x.parent_id)) p.unshift(x.name);
  return p.join(" / ");
};
export const collectionOptions = (collections) =>
  collections.map((c) => ({ value: c.id, label: c.name, description: collectionPath(collections, c).split(" / ").slice(0, -1).join(" / "), icon: "folder" })).sort((a, b) => (a.description + a.label).localeCompare(b.description + b.label));

function Pick({ close, collections }) {
  const t = useT();
  const [sel, setSel] = useState(null);
  const options = useMemo(() => collectionOptions(collections), [collections]);
  return (
    <Modal title={t("pick.title")} size="sm" onClose={() => close(undefined)}
      footer={<><Button onClick={() => close(undefined)}>{t("common.cancel")}</Button><Button variant="primary" icon="floppy-disk" disabled={!sel} onClick={() => close(sel.value)}>{t("common.save")}</Button></>}>
      <div className="field"><span className="field-l">{t("pick.collection")}</span>
        <AutoComplete autoFocus options={options} value={sel} onChange={setSel} placeholder={t("pick.search")} />
      </div>
    </Modal>
  );
}
export const pickCollection = (collections) => modals.open((close) => <Pick close={close} collections={collections} />);
