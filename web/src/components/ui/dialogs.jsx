import { useState } from "react";
import { Modal } from "./Modal.jsx";
import { Button } from "./Button.jsx";
import { modals } from "./modals.js";

function Prompt({ close, title, label, initial, okText }) {
  const [v, setV] = useState(initial);
  const ok = () => v.trim() && close(v.trim());
  return (
    <Modal title={title} size="sm" onClose={() => close(undefined)} footer={<><Button onClick={() => close(undefined)}>Cancel</Button><Button variant="primary" disabled={!v.trim()} onClick={ok}>{okText}</Button></>}>
      <label className="field">
        {label && <span className="field-l">{label}</span>}
        <input data-autofocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ok()} onFocus={(e) => e.target.select()} />
      </label>
    </Modal>
  );
}
function Confirm({ close, title, message, okText, danger }) {
  return (
    <Modal title={title} size="sm" onClose={() => close(false)} footer={<><Button onClick={() => close(false)}>Cancel</Button><Button variant={danger ? "danger" : "primary"} data-autofocus onClick={() => close(true)}>{okText}</Button></>}>
      <p className="dialog-msg">{message}</p>
    </Modal>
  );
}
export const prompt = ({ title, label, initial = "", okText = "OK" }) => modals.open((close) => <Prompt close={close} title={title} label={label} initial={initial} okText={okText} />);
export const confirm = ({ title = "Confirm", message, okText = "Delete", danger = true }) => modals.open((close) => <Confirm close={close} title={title} message={message} okText={okText} danger={danger} />);
