import { useMemo, useState } from "react";
import { modals } from "../components/ui/modals.js";
import { Modal } from "../components/ui/Modal.jsx";
import { Button } from "../components/ui/Button.jsx";
import { AutoComplete } from "../components/ui/AutoComplete.jsx";

export const collectionPath = (collections, c) => {
  const p = [];
  for (let x = c; x; x = collections.find((y) => y.id === x.parent_id)) p.unshift(x.name);
  return p.join(" / ");
};
export const collectionOptions = (collections) =>
  collections.map((c) => ({ value: c.id, label: c.name, description: collectionPath(collections, c).split(" / ").slice(0, -1).join(" / "), icon: "folder" })).sort((a, b) => (a.description + a.label).localeCompare(b.description + b.label));

function Pick({ close, collections }) {
  const [sel, setSel] = useState(null);
  const options = useMemo(() => collectionOptions(collections), [collections]);
  return (
    <Modal title="Save request to…" size="sm" onClose={() => close(undefined)}
      footer={<><Button onClick={() => close(undefined)}>Cancel</Button><Button variant="primary" icon="floppy-disk" disabled={!sel} onClick={() => close(sel.value)}>Save</Button></>}>
      <div className="field"><span className="field-l">Collection</span>
        <AutoComplete autoFocus options={options} value={sel} onChange={setSel} placeholder="Search collections…" />
      </div>
    </Modal>
  );
}
export const pickCollection = (collections) => modals.open((close) => <Pick close={close} collections={collections} />);
