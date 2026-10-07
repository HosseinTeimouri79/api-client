import { useRef, useState } from "react";
import { api, errorText } from "../api.js";
import { useStore } from "../store.js";
import { squareAvatar } from "../lib/image.js";
import { Button } from "../components/ui/Button.jsx";
import { Field } from "../components/ui/Switch.jsx";
import { Tabs } from "../components/ui/Tabs.jsx";
import { Avatar } from "../components/ui/Avatar.jsx";
import { toast } from "../components/ui/Toasts.jsx";

function Profile() {
  const user = useStore((s) => s.user);
  const [f, setF] = useState({ name: user.name, username: user.username });
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [err, setErr] = useState("");
  const file = useRef(null);
  const dirty = f.name.trim() !== user.name || f.username.trim().toLowerCase() !== user.username;

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const { user: u } = await api("PATCH", "/me", { name: f.name, username: f.username });
      useStore.getState().setUser(u);
      setF({ name: u.name, username: u.username });
      toast("Profile saved", "ok");
    } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  };
  const pick = async (e) => {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    setPhotoBusy(true);
    try {
      let blob;
      try { blob = await squareAvatar(picked); } catch { toast("That file isn't an image we can read. Use PNG, JPEG or WebP.", "error"); return; }
      useStore.getState().setUser((await api("PUT", "/me/avatar", blob)).user);
      toast("Photo updated", "ok");
    } catch (x) { toast(errorText(x), "error"); } finally { setPhotoBusy(false); }
  };
  const removePhoto = async () => {
    setPhotoBusy(true);
    try { useStore.getState().setUser((await api("DELETE", "/me/avatar")).user); toast("Photo removed", "ok"); }
    catch (x) { toast(errorText(x), "error"); } finally { setPhotoBusy(false); }
  };
  return (
    <>
      <section className="settings-sec">
        <h3>Profile photo</h3>
        <div className="row photo-row">
          <Avatar name={user.name} src={user.avatar} size={88} />
          <div className="stack">
            <div className="row wrap">
              <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={pick} />
              <Button icon="camera" loading={photoBusy} onClick={() => file.current.click()}>{user.avatar ? "Change photo" : "Upload photo"}</Button>
              {user.avatar && <Button icon="trash" disabled={photoBusy} onClick={removePhoto}>Remove photo</Button>}
            </div>
            <span className="muted">PNG, JPEG or WebP. It's cropped to a square.</span>
          </div>
        </div>
      </section>
      <form className="settings-sec stack" onSubmit={save}>
        <h3>Profile details</h3>
        <Field label="Display name"><input required maxLength={100} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></Field>
        <Field label="Username" hint="Used to sign in. Letters, digits, dot, underscore, dash."><input dir="ltr" required minLength={3} maxLength={32} pattern="[A-Za-z0-9._\-]+" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoComplete="username" /></Field>
        {err && <div className="err" role="alert">{err}</div>}
        <div><Button type="submit" variant="primary" loading={busy} disabled={!dirty}>Save</Button></div>
      </form>
    </>
  );
}

function Preferences() {
  const theme = useStore((s) => s.theme);
  const { setTheme } = useStore.getState();
  return (
    <>
      <section className="settings-sec stack">
        <h3>Theme</h3>
        <Tabs variant="pill" value={theme} onChange={setTheme} items={[{ id: "dark", label: "Dark" }, { id: "light", label: "Light" }]} />
      </section>
    </>
  );
}

function Security() {
  const [f, setF] = useState({ cur: "", next: "", again: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (f.next !== f.again) return setErr("The two passwords don't match");
    setBusy(true); setErr("");
    try {
      await api("POST", "/me/password", { current_password: f.cur, new_password: f.next });
      setF({ cur: "", next: "", again: "" });
      toast("Password changed", "ok");
    } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  };
  return (
    <form className="settings-sec stack" onSubmit={submit}>
      <h3>Change password</h3>
      <Field label="Current password"><input dir="ltr" type="password" required autoComplete="current-password" value={f.cur} onChange={set("cur")} /></Field>
      <Field label="New password" hint={`$At least 8 characters. $Other devices will be signed out.`}><input dir="ltr" type="password" required minLength={8} maxLength={200} autoComplete="new-password" value={f.next} onChange={set("next")} /></Field>
      <Field label="Repeat new password"><input dir="ltr" type="password" required minLength={8} maxLength={200} autoComplete="new-password" value={f.again} onChange={set("again")} /></Field>
      {err && <div className="err" role="alert">{err}</div>}
      <div><Button type="submit" variant="primary" loading={busy}>Update password</Button></div>
    </form>
  );
}

export function SettingsPage() {
  const [tab, setTab] = useState("profile");
  return (
    <div className="admin body">
      <div className="admin-in settings-in">
        <div className="row admin-head"><Button icon="arrow-left" onClick={() => useStore.setState({ view: "app" })}>Back to app</Button><h2 className="grow">Settings</h2></div>
        <Tabs value={tab} onChange={setTab} items={[{ id: "profile", label: "Profile" }, { id: "preferences", label: "Preferences" }, { id: "security", label: "Security" }]} />
        <div className="admin-card">{tab === "profile" ? <Profile /> : tab === "preferences" ? <Preferences /> : <Security />}</div>
      </div>
    </div>
  );
}
