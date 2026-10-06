import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, FileCode2, FileText, Folder, FolderOpen, GitBranch, Image, KeyRound, Plus, SquareTerminal, X } from "lucide-react";
import { BROKEN, CHANGED_FILES, REPO_PATH, TREE, type TreeNode } from "../data";
import type { Scenario } from "../store";
import Splitter, { clamp } from "./Splitter";

type Status = { code: string; tone: string; ignored?: boolean };

function fileStatuses(s: Scenario): Record<string, Status> {
  const map: Record<string, Status> = {};
  if (s.phase === "save") {
    for (const f of CHANGED_FILES)
      if (s.pending.includes(f.path)) map[f.path] = { code: f.status, tone: f.status === "A" ? "text-green" : "text-amber" };
  }
  if (s.envIgnored) map[".env"] = { code: "", tone: "", ignored: true };
  if (s.phase === "restore" && s.restoreStep !== "restored") {
    map["menu.js"] = { code: "M", tone: "text-red" };
    map["data.json"] = { code: "M", tone: "text-amber" };
  }
  return map;
}

function iconFor(n: TreeNode) {
  if (n.name === ".env") return KeyRound;
  if (/\.(png|jpg)$/.test(n.name)) return Image;
  if (/\.(md|json)$/.test(n.name) || n.name.startsWith(".")) return FileText;
  return FileCode2;
}

export default function Explorer({ s }: { s: Scenario }) {
  const statuses = fileStatuses(s);
  const [open, setOpen] = useState<Record<string, boolean>>({ "": true });
  const [sel, setSel] = useState<string | null>(null);
  const [width, setWidth] = useState(240);
  const [sessH, setSessH] = useState(200);
  const start = useRef(0);

  const renderNode = (n: TreeNode, depth: number) => {
    const st = statuses[n.path];
    const isOpen = open[n.path];
    const Icon = n.dir ? (isOpen ? FolderOpen : Folder) : iconFor(n);
    const muted = n.hidden || st?.ignored;
    const errored = s.phase === "restore" && s.restoreStep !== "restored" && n.path === BROKEN.files[0];
    return (
      <div key={n.path || "root"}>
        <button
          onClick={() => (n.dir ? setOpen((o) => ({ ...o, [n.path]: !o[n.path] })) : setSel(n.path))}
          className={`flex h-[26px] w-full items-center gap-1.5 pr-2 text-left hover:bg-hover ${
            sel === n.path || depth === 0 ? "bg-raised" : ""
          }`}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          <span className="w-3 text-dim">{n.dir && (isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}</span>
          <Icon size={14} className={n.name === ".env" ? "text-amber" : n.dir ? "text-muted" : "text-dim"} strokeWidth={1.75} />
          <span className={`truncate ${muted ? "text-dim italic" : st ? st.tone : "text-fg/90"} ${depth === 0 ? "font-medium text-fg" : ""}`}>
            {n.name}
          </span>
          {errored && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-red" />}
          {st?.ignored && <span className="ml-auto font-mono text-[10px] text-dim">무시됨</span>}
          {st?.code && <span className={`ml-auto font-mono text-[11px] font-medium ${st.tone}`}>{st.code}</span>}
        </button>
        {n.dir && isOpen && n.children?.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <>
    <aside className="flex shrink-0 flex-col bg-panel" style={{ width }}>
      <SectionHead title="파일" right={`${s.changeCount ? `${s.changeCount} 변경` : "깨끗함"}`} />
      <div className="min-h-0 flex-1 overflow-y-auto py-1">{renderNode(TREE, 0)}</div>

      <Splitter dir="y" onStart={() => (start.current = sessH)} onDrag={(d) => setSessH(clamp(start.current - d, 60, 600))} />
      <SectionHead
        title="터미널 세션"
        right={
          <button onClick={s.newSession} className="text-muted hover:text-fg" title="새 세션">
            <Plus size={14} />
          </button>
        }
      />
      <div className="shrink-0 overflow-y-auto py-1" style={{ height: sessH }}>
        {s.sessions.map((ss) => {
          const active = ss.id === s.activeId || ss.id === s.splitId;
          const last = [...ss.blocks].reverse().find((b) => b.title)?.title ?? "새 터미널";
          return (
            <div
              key={ss.id}
              onClick={() => s.setActiveId(ss.id)}
              className={`group mx-1.5 mb-1 flex cursor-pointer items-start gap-2.5 rounded-[3px] border px-2.5 py-2 ${
                ss.id === s.activeId ? "border-line bg-raised" : active ? "border-line-soft bg-raised/50" : "border-transparent hover:bg-hover"
              }`}
            >
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-hover text-muted">
                <SquareTerminal size={13} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] text-fg">{last}</span>
                <span className="flex items-center gap-1 text-[10px] text-dim">
                  <GitBranch size={10} /> main
                  <span className="truncate">· {REPO_PATH}</span>
                </span>
              </span>
              {s.sessions.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    s.closeSession(ss.id);
                  }}
                  className="hidden text-dim group-hover:block hover:text-fg"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </aside>
    <Splitter dir="x" onStart={() => (start.current = width)} onDrag={(d) => setWidth(clamp(start.current + d, 180, 480))} />
    </>
  );
}

function SectionHead({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex h-8 shrink-0 items-center justify-between border-y border-line-soft px-3 text-[11px] font-medium tracking-wide text-muted first:border-t-0">
      {title}
      <span className="text-[10px] font-normal text-dim">{right}</span>
    </div>
  );
}
