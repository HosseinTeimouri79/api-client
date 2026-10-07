import { useState } from "react";
import { Modal } from "./Modal.jsx";
import { Button } from "./Button.jsx";
import { modals } from "./modals.js";
import { t, useT } from "../../i18n/index.js";

function Prompt({ close, title, label, initial, okText }) {
  const t = useT();
  const [v, setV] = useState(initial);
  const ok = () => v.trim() && close(v.trim());
  return (
    <Modal title={title} size="sm" onClose={() => close(undefined)} footer={<><Button onClick={() => close(undefined)}>{t("common.cancel")}</Button><Button variant="primary" disabled={!v.trim()} onClick={ok}>{okText}</Button></>}>
      <label className="field">
        {label && <span className="field-l">{label}</span>}
        <input data-autofocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ok()} onFocus={(e) => e.target.select()} />
      </label>
    </Modal>
  );
}
function Confirm({ close, title, message, okText, danger }) {
  const t = useT();
  return (
    <Modal title={title} size="sm" onClose={() => close(false)} footer={<><Button onClick={() => close(false)}>{t("common.cancel")}</Button><Button variant={danger ? "danger" : "primary"} data-autofocus onClick={() => close(true)}>{okText}</Button></>}>
      <p className="dialog-msg">{message}</p>
    </Modal>
  );
}
export const prompt = ({ title, label, initial = "", okText }) => modals.open((close) => <Prompt close={close} title={title} label={label} initial={initial} okText={okText ?? t("common.ok")} />);
export const confirm = ({ title, message, okText, danger = true }) => modals.open((close) => <Confirm close={close} title={title ?? t("common.confirm")} message={message} okText={okText ?? t("common.delete")} danger={danger} />);
