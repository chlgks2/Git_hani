// Warp 스타일 터미널. 명령은 블록 단위로 쌓이고, 말로 입력해도 동작한다.
import { useEffect, useRef, useState } from "react";
import { Columns2, FileDiff, Folder, GitBranch, Plus, SquareTerminal, X } from "lucide-react";
import { REPO_PATH } from "../data";
import type { Block, LineTone, Scenario, Session } from "../store";

const TONE: Record<LineTone, string> = {
  plain: "text-fg/90",
  ok: "text-green",
  warn: "text-amber",
  err: "text-red",
  dim: "text-dim",
  ai: "text-[#b9a6f5]",
};
const MARK: Partial<Record<LineTone, string>> = { ok: "✓", warn: "!", err: "✕", ai: "✦" };

export default function Terminal({ s, height }: { s: Scenario; height: number }) {
  const panes = [s.activeId, ...(s.splitId != null && s.splitId !== s.activeId ? [s.splitId] : [])]
    .map((id) => s.sessions.find((x) => x.id === id))
    .filter(Boolean) as Session[];

  return (
    <section className="flex shrink-0 flex-col bg-panel" style={{ height }}>
      {/* 탭 */}
      <div className="flex h-8 shrink-0 items-stretch border-b border-line-soft text-[12px]">
        {s.sessions.map((ss) => (
          <button
            key={ss.id}
            onClick={() => s.setActiveId(ss.id)}
            className={`group flex items-center gap-2 border-r border-line-soft px-3 ${
              ss.id === s.activeId ? "bg-base text-fg" : "text-dim hover:text-muted"
            }`}
          >
            <SquareTerminal size={12} />
            {ss.title}
            {s.sessions.length > 1 && (
              <X
                size={11}
                className="opacity-0 group-hover:opacity-100 hover:text-fg"
                onClick={(e) => {
                  e.stopPropagation();
                  s.closeSession(ss.id);
                }}
              />
            )}
          </button>
        ))}
        <button onClick={s.newSession} className="px-2.5 text-dim hover:text-fg" title="새 터미널">
          <Plus size={14} />
        </button>
        <button
          onClick={s.toggleSplit}
          className={`ml-auto flex items-center gap-1.5 px-3 text-[11px] ${s.splitId != null ? "text-teal" : "text-dim hover:text-fg"}`}
          title="나란히 보기"
        >
          <Columns2 size={13} /> 나란히 보기
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {panes.map((p, i) => (
          <Pane key={p.id} session={p} s={s} focused={p.id === s.activeId} divider={i > 0} />
        ))}
      </div>
    </section>
  );
}

function suggestions(s: Scenario): string[] {
  if (s.phase === "save") {
    const out: string[] = [];
    if (s.pending.length) out.push(s.analyzed ? "저장해줘" : "뭐가 바뀌었어?", s.analyzed ? "상태" : "저장해줘");
    if (s.unpushed.length) out.push("올려줘");
    out.push("기록 보여줘", "도움");
    return out;
  }
  if (s.phase === "restore" && s.restoreStep === "broken") return ["원래대로 되돌려줘", "상태", "도움"];
  return s.unpushed.length ? ["올려줘", "상태"] : ["상태", "도움"];
}

function Pane({ session, s, focused, divider }: { session: Session; s: Scenario; focused: boolean; divider: boolean }) {
  const [input, setInput] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [session.blocks]);

  const submit = (text: string) => {
    s.runInput(text, session.id);
    setInput("");
  };

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className={`flex min-w-0 flex-1 flex-col bg-base ${divider ? "border-l border-line" : ""}`}
    >
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        {session.blocks.map((b) => (
          <BlockView key={b.id} b={b} />
        ))}
      </div>

      {/* 프롬프트 */}
      <div className={`shrink-0 border-t px-4 pt-2.5 pb-3 ${focused ? "border-line" : "border-line-soft"}`}>
        <div className="mb-2 flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
          <Chip><SquareTerminal size={11} className="text-amber" /> <b className="text-amber">savepoint</b></Chip>
          <Chip><Folder size={11} className="text-teal" /> <span className="text-teal">{REPO_PATH}</span></Chip>
          <Chip><GitBranch size={11} className="text-green" /> <span className="text-green">main</span></Chip>
          <Chip>
            <FileDiff size={11} className="text-muted" />
            {s.changeCount ? <span className="text-amber">{s.changeCount} 변경</span> : <span className="text-dim">깨끗함</span>}
          </Chip>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="flex items-center gap-2"
        >
          <span className="font-mono text-teal">›</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => s.setActiveId(session.id)}
            placeholder="하고 싶은 일을 적어보세요 — 예: 뭐가 바뀌었어?  (git 명령어도 돼요)"
            className="flex-1 bg-transparent font-mono text-[13px] text-fg outline-none placeholder:font-sans placeholder:text-dim"
          />
        </form>
        <div className="mt-2 flex gap-1.5">
          {suggestions(s).map((t) => (
            <button
              key={t}
              onClick={(e) => {
                e.stopPropagation();
                submit(t);
              }}
              className="rounded-[3px] border border-line px-2 py-0.5 text-[11px] text-muted hover:border-teal/50 hover:text-fg"
            >
              {t}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="flex items-center gap-1 rounded-[3px] border border-line bg-panel px-1.5 py-[3px]">{children}</span>;
}

export function BlockView({ b }: { b: Block }) {
  return (
    <div className="rise border-b border-line-soft px-4 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className={`font-mono text-[12px] ${b.typed ? "text-teal" : "text-dim"}`}>{b.typed ? "›" : "●"}</span>
        <span className={`text-[13px] ${b.typed && !/[가-힣]/.test(b.title) ? "font-mono text-fg" : "font-medium text-fg"}`}>{b.title}</span>
        {b.git && <span className="ml-auto truncate pl-4 font-mono text-[10px] text-dim">$ {b.git}</span>}
      </div>
      <div className="mt-1 space-y-0.5 pl-4 font-mono text-[12px] leading-relaxed">
        {b.lines.map((l, i) => (
          <div key={i} className={`flex gap-2 ${TONE[l.tone]}`}>
            <span className="w-3 shrink-0 text-center">{MARK[l.tone] ?? ""}</span>
            <span className={`whitespace-pre-wrap ${/[가-힣]/.test(l.text) ? "font-sans text-[12.5px]" : ""}`}>{l.text}</span>
          </div>
        ))}
        {b.running && (
          <div className="flex gap-2 text-dim">
            <span className="w-3" />
            <span className="caret">▍</span>
          </div>
        )}
      </div>
    </div>
  );
}
