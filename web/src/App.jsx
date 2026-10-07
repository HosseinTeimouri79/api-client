import { useEffect, useRef } from "react";
import { useStore, activeTab } from "./store.js";
import { cx } from "./lib/utils.js";
import { blankReq } from "./lib/http.js";
import { ModalHost } from "./components/ui/Modal.jsx";
import { Toasts, toast } from "./components/ui/Toasts.jsx";
import { Splitter } from "./components/ui/Splitter.jsx";
import { Button, IconButton } from "./components/ui/Button.jsx";
import { Icon, Spinner } from "./components/ui/Icon.jsx";
import { ResponseViewer } from "./components/response/ResponseViewer.jsx";
import { AuthScreen } from "./features/AuthScreen.jsx";
import { TopBar } from "./features/TopBar.jsx";
import { Sidebar } from "./features/Sidebar.jsx";
import { RequestTabs } from "./features/RequestTabs.jsx";
import { RequestEditor } from "./features/RequestEditor.jsx";
import { CollectionSettings } from "./features/CollectionSettings.jsx";
import { AdminPanel } from "./features/AdminPanel.jsx";
import { Console } from "./features/Console.jsx";

const LS = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* private mode */ } };

function Workspace() {
  const tab = useStore(activeTab);
  const { splitDir, editorFrac, sidebarW } = useStore();
  const { set, addTab } = useStore.getState();
  const split = useRef(null);
  const vertical = splitDir === "col"; // editor and response side by side
  return (
    <div className="main">
      <RequestTabs />
      {tab?.kind === "collection" ? (
        <div className="split"><div className="pane grow"><CollectionSettings key={tab.key} tab={tab} /></div></div>
      ) : tab ? (
        <div className={cx("split", vertical ? "cols" : "rows")} ref={split}>
          <div className="pane" style={{ flexBasis: `${editorFrac * 100}%` }}><RequestEditor key={tab.key} tab={tab} /></div>
          <Splitter dir={vertical ? "col" : "row"} onDrag={(d) => { const r = split.current.getBoundingClientRect(); set((s) => ({ editorFrac: Math.min(0.85, Math.max(0.15, s.editorFrac + d / (vertical ? r.width : r.height))) })); }} onEnd={() => LS("editorFrac", useStore.getState().editorFrac)} />
          <div className="pane grow">
            <div className="pane-tools"><IconButton icon={vertical ? "table-columns" : "table-cells-large"} size="sm" label="Switch layout" onClick={() => { const d = vertical ? "row" : "col"; set({ splitDir: d }); LS("splitDir", d); }} /></div>
            <ResponseViewer tab={tab} />
          </div>
        </div>
      ) : (
        <div className="empty"><div><Icon name="paper-plane" className="big" /><h2>No request open</h2><p className="muted">Open a request from the sidebar, or start a new one.</p><Button variant="primary" icon="plus" onClick={() => addTab(blankReq())}>New request</Button></div></div>
      )}
    </div>
  );
}

function Shell() {
  const { ws, sidebarW, view, user } = useStore();
  const { set, createWorkspace } = useStore.getState();
  return (
    <div className="app">
      <TopBar />
      {view === "admin" && user.is_admin ? (
        <AdminPanel />
      ) : ws ? (
        <div className="body">
          <Sidebar />
          <Splitter dir="col" className="side-split" onDrag={(d) => set((s) => ({ sidebarW: Math.min(560, Math.max(200, s.sidebarW + d)) }))} onEnd={() => LS("sidebarW", useStore.getState().sidebarW)} />
          <Workspace />
        </div>
      ) : (
        <div className="empty body"><div><Icon name="briefcase" className="big" /><h2>Welcome</h2><p className="muted">Create a workspace to get started.</p><Button variant="primary" icon="plus" onClick={createWorkspace}>New workspace</Button></div></div>
      )}
      {ws && view !== "admin" && <Console />}
    </div>
  );
}

export default function App() {
  const { user, booting, theme } = useStore();
  useEffect(() => { document.documentElement.dataset.theme = theme; useStore.getState().boot(); }, []);
  useEffect(() => {
    const key = (e) => {
      const s = useStore.getState(), mod = e.ctrlKey || e.metaKey;
      if (!s.ws || s.view === "admin" || document.querySelector(".modal")) return;
      const k = e.key.toLowerCase();
      if (mod && e.key === "Enter") { e.preventDefault(); s.send(); }
      else if (mod && k === "s") { e.preventDefault(); s.save(); }
      else if (mod && e.key === "`") { e.preventDefault(); s.set({ consoleOpen: !s.consoleOpen }); }
      else if (mod && k === "t") { e.preventDefault(); s.addTab(blankReq()); }
      else if (mod && k === "w" && s.active) { e.preventDefault(); s.closeTab(s.active); }
    };
    const rej = (e) => toast(e.reason?.message ?? "Unexpected error", "error");
    addEventListener("keydown", key);
    addEventListener("unhandledrejection", rej);
    return () => { removeEventListener("keydown", key); removeEventListener("unhandledrejection", rej); };
  }, []);
  return (
    <>
      {booting ? <div className="boot"><Spinner /></div> : user ? <Shell /> : <AuthScreen />}
      <ModalHost />
      <Toasts />
    </>
  );
}
