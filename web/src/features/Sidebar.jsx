import { memo, useMemo, useRef, useState } from "react";
import { useStore, can } from "../store.js";
import { cx, debounce } from "../lib/utils.js";
import { Tabs } from "../components/ui/Tabs.jsx";
import { Button, IconButton } from "../components/ui/Button.jsx";
import { Menu } from "../components/ui/Menu.jsx";
import { Icon } from "../components/ui/Icon.jsx";
import { exportRemote, InteropModal } from "./InteropModal.jsx";
import { modals } from "../components/ui/modals.js";
import { useT } from "../i18n/index.js";
import { protocolOf } from "../lib/protocols.js";

const byPos = (a, b) => a.position - b.position || a.name.localeCompare(b.name);
let dragging = null; // module-level: HTML5 drag payload ({type, id})

function useCtx() {
  const [m, setM] = useState({ open: false, anchor: null, items: [] });
  return { m, show: (anchor, items) => setM({ open: true, anchor, items }), hide: () => setM((x) => ({ ...x, open: false })) };
}

const Guides = ({ guides, last }) => (
  <span className="guides">{guides.map((on, i) => <span key={i} className={cx("g", on && "line")} />)}<span className={cx("g", last ? "elbow" : "tee")} /></span>
);

const RequestRow = memo(function RequestRow({ r, guides, last, depth, write, active, ctx }) {
  const { openRequest, send, dropOn, renameRequest, duplicateRequest, deleteRequest } = useStore.getState();
  const t = useT();
  const [over, setOver] = useState(false);
  const items = [
    { label: t("sidebar.rename"), icon: "pen", onClick: () => renameRequest(r) },
    { label: t("sidebar.duplicate"), icon: "copy", onClick: () => duplicateRequest(r) },
    "-",
    { label: t("common.delete"), icon: "trash-can", danger: true, onClick: () => deleteRequest(r) },
  ];
  return (
    <div className={cx("node", active && "sel", over && "over")} draggable={write} role="treeitem" tabIndex={0}
      onClick={() => { openRequest(r.id); useStore.getState().set({ sidebarOpen: false }); }}
      onKeyDown={(e) => e.key === "Enter" && openRequest(r.id)}
      onContextMenu={(e) => { if (write) { e.preventDefault(); ctx.show({ x: e.clientX, y: e.clientY }, items); } }}
      onDragStart={() => (dragging = { type: "request", id: r.id })}
      onDragOver={(e) => { if (dragging?.type === "request") { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const d = dragging; dragging = null; dropOn(d, { type: "before", id: r.id, collection_id: r.collection_id }); }}>
      {depth > 0 && <Guides guides={guides} last={last} />}
      <span className={`m m-${r.protocol && r.protocol !== "http" ? "proto" : r.method}`}>{r.protocol && r.protocol !== "http" ? protocolOf(r.protocol).tag : r.method}</span>
      <span className="nm">{r.name}</span>
      <span className="acts">
        <IconButton icon="play" label={t("sidebar.run")} size="sm" onClick={async (e) => { e.stopPropagation(); await openRequest(r.id); send(); }} />
        {write && <IconButton icon="ellipsis" label={t("sidebar.actions")} size="sm" onClick={(e) => { e.stopPropagation(); ctx.show(e.currentTarget, items); }} />}
      </span>
    </div>
  );
});

function CollectionRow({ c, open, guides, last, depth, write, active, ctx }) {
  const { toggle, openCollection, newRequestIn, addCollection, renameCollection, duplicateCollection, moveCollectionToRoot, sortChildren, deleteCollection, dropOn } = useStore.getState();
  const t = useT();
  const [over, setOver] = useState(false);
  const items = [
    { label: t("sidebar.rename"), icon: "pen", onClick: () => renameCollection(c) },
    { label: t("sidebar.duplicate"), icon: "copy", onClick: () => duplicateCollection(c) },
    { label: t("sidebar.moveToRoot"), icon: "arrow-up-from-bracket", onClick: () => moveCollectionToRoot(c) },
    { label: t("sidebar.sort"), icon: "arrow-down-a-z", onClick: () => sortChildren(c.id) },
    "-",
    { label: t("sidebar.exportPostman"), icon: "file-export", onClick: () => useStore.getState().guard(exportRemote)({ format: "postman", collection: c.id }) },
    { label: t("sidebar.exportHoppscotch"), icon: "file-export", onClick: () => useStore.getState().guard(exportRemote)({ format: "hoppscotch", collection: c.id }) },
    "-",
    { label: t("common.delete"), icon: "trash-can", danger: true, onClick: () => deleteCollection(c) },
  ];
  return (
    <div className={cx("node", active && "sel", over && "over")} draggable={write} role="treeitem" aria-expanded={open} tabIndex={0}
      onClick={() => { toggle(c.id, true); openCollection(c.id); useStore.getState().set({ sidebarOpen: false }); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(c.id, true); openCollection(c.id); } }}
      onContextMenu={(e) => { if (write) { e.preventDefault(); ctx.show({ x: e.clientX, y: e.clientY }, items); } }}
      onDragStart={() => (dragging = { type: "collection", id: c.id })}
      onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const d = dragging; dragging = null; dropOn(d, { type: "collection", id: c.id }); }}>
      {depth > 0 && <Guides guides={guides} last={last} />}
      <Icon name={open ? "chevron-down" : "chevron-right"} className="chev" onClick={(e) => { e.stopPropagation(); toggle(c.id); }} />
      <Icon name={open ? "folder-open" : "folder"} className="folder" />
      <span className="nm">{c.name}</span>
      {(c.has_pre || c.has_post) && <span className="sc" title={t("sidebar.colScript", { kinds: [c.has_pre && t("req.pre"), c.has_post && t("req.post")].filter(Boolean).join(" + ") })}><Icon name="code" /></span>}
      {write && (
        <span className="acts">
          <IconButton icon="file-circle-plus" label={t("sidebar.newRequest")} size="sm" onClick={(e) => { e.stopPropagation(); newRequestIn(c.id); }} />
          <IconButton icon="folder-plus" label={t("sidebar.newSub")} size="sm" onClick={(e) => { e.stopPropagation(); addCollection(c.id); }} />
          <IconButton icon="ellipsis" label={t("sidebar.actions")} size="sm" onClick={(e) => { e.stopPropagation(); ctx.show(e.currentTarget, items); }} />
        </span>
      )}
    </div>
  );
}

function Tree() {
  const t = useT();
  const { tree, filter, expanded, ws } = useStore();
  const activeId = useStore((s) => s.tabs.find((t) => t.key === s.active)?.id);
  const activeCid = useStore((s) => { const t = s.tabs.find((x) => x.key === s.active); return t?.kind === "collection" ? t.cid : null; });
  const ctx = useCtx();
  const write = can(ws).write;
  const f = filter.toLowerCase();
  const { kidsC, kidsR } = useMemo(() => {
    const kidsC = new Map(), kidsR = new Map();
    for (const c of tree.collections) (kidsC.get(c.parent_id ?? null) ?? kidsC.set(c.parent_id ?? null, []).get(c.parent_id ?? null)).push(c);
    for (const r of tree.requests) (kidsR.get(r.collection_id) ?? kidsR.set(r.collection_id, []).get(r.collection_id)).push(r);
    return { kidsC, kidsR };
  }, [tree]);
  const matches = (c) => !f || c.name.toLowerCase().includes(f) || (kidsR.get(c.id) ?? []).some((r) => r.name.toLowerCase().includes(f)) || (kidsC.get(c.id) ?? []).some(matches);

  const rows = [];
  const draw = (parent, depth, guides, pc) => {
    const items = [
      ...(kidsC.get(parent) ?? []).slice().sort(byPos).filter(matches).map((c) => ({ c })),
      ...(pc ? (kidsR.get(parent) ?? []).slice().sort(byPos).filter((r) => !f || r.name.toLowerCase().includes(f) || pc.name.toLowerCase().includes(f)).map((r) => ({ r })) : []),
    ];
    items.forEach((it, i) => {
      const last = i === items.length - 1;
      if (it.r) return rows.push(<RequestRow key={it.r.id} r={it.r} guides={guides} last={last} depth={depth} write={write} active={activeId === it.r.id} ctx={ctx} />);
      const open = !!expanded[it.c.id] || !!f;
      rows.push(<CollectionRow key={it.c.id} c={it.c} open={open} guides={guides} last={last} depth={depth} write={write} active={activeCid === it.c.id} ctx={ctx} />);
      if (open) draw(it.c.id, depth + 1, depth ? [...guides, !last] : [], it.c);
    });
  };
  draw(null, 0, [], null);
  return (
    <div className="tree" role="tree">
      {rows}
      {!tree.collections.length && (
        <div className="empty-mini"><Icon name="folder-plus" className="big" /><p>{t("sidebar.noCollections")}</p>{write && <div className="row wrap empty-actions"><Button variant="primary" icon="plus" onClick={() => useStore.getState().addCollection(null)}>{t("sidebar.newCollection")}</Button><Button icon="file-import" onClick={() => modals.open((close) => <InteropModal close={close} />)}>{t("common.import")}</Button></div>}</div>
      )}
      {f && !rows.length && tree.collections.length > 0 && <div className="muted pad">{t("sidebar.noMatch", { q: filter })}</div>}
      <Menu anchor={ctx.m.anchor} open={ctx.m.open} onClose={ctx.hide} items={ctx.m.items} />
    </div>
  );
}

function History() {
  const t = useT();
  const history = useStore((s) => s.history);
  const { openHistory } = useStore.getState();
  if (!history.length) return <div className="empty-mini"><Icon name="clock-rotate-left" className="big" /><p>{t("sidebar.noHistory")}</p></div>;
  return (
    <div className="tree">
      {history.map((x) => (
        <div className="node" key={x.id} title={x.created_at} role="treeitem" tabIndex={0} onClick={() => openHistory(x.id)} onKeyDown={(e) => e.key === "Enter" && openHistory(x.id)}>
          <span className={`m m-${x.method}`}>{x.method}</span><span className="nm">{x.url || t("sidebar.emptyUrl")}</span>
          <span className={x.status >= 400 || !x.status ? "err" : "ok"}>{x.status ?? "✗"}</span>
        </div>
      ))}
    </div>
  );
}

export function Sidebar() {
  const t = useT();
  const { side, ws, filter, sidebarOpen, sidebarW } = useStore();
  const { setSide, setFilter, addCollection, clearHistory, set } = useStore.getState();
  const write = can(ws).write;
  const [text, setText] = useState(filter);
  const deb = useRef(debounce((v) => setFilter(v), 150)).current;
  return (
    <>
      <div className={cx("scrim", sidebarOpen && "on")} onClick={() => set({ sidebarOpen: false })} />
      <aside className={cx("side", sidebarOpen && "open")} style={{ width: sidebarW }}>
        <Tabs variant="pill" value={side} onChange={setSide} items={[{ id: "collections", label: <><Icon name="folder-tree" /> {t("sidebar.collections")}</> }, { id: "history", label: <><Icon name="clock-rotate-left" /> {t("sidebar.history")}</> }]} />
        {side === "collections" ? (
          <div className="side-tools">
            <div className="searchbox"><Icon name="magnifying-glass" /><input type="search" placeholder={t("sidebar.search")} value={text} aria-label={t("ui.search")} onChange={(e) => { setText(e.target.value); deb(e.target.value); }} /></div>
            {write && <IconButton icon="plus" label={t("sidebar.newCollection")} onClick={() => addCollection(null)} />}
          </div>
        ) : (
          <div className="side-tools"><Button size="sm" icon="trash-can" onClick={clearHistory}>{t("sidebar.clearHistory")}</Button></div>
        )}
        <div className="side-body">{side === "collections" ? <Tree /> : <History />}</div>
      </aside>
    </>
  );
}
