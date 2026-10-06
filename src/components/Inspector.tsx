// 오른쪽 패널: 바뀐 파일 고르기 → 커밋 메시지 → 커밋하기 → 올리기(푸시)
import { Fragment, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, Check, CheckCircle2, Cloud, CloudDownload, CloudUpload, GitCommitHorizontal, GitMerge, KeyRound, RotateCcw, Sparkles } from "lucide-react";
import { BROKEN, CHANGED_FILES, DEMO_CONFLICT_FILE, DEMO_TEAMMATE, type ChangedFile } from "../data";
import type { Scenario } from "../store";
import SitePreview from "./SitePreview";
import Splitter, { clamp } from "./Splitter";
import { GitChip } from "./Term";

type PaneKey = "changes" | "commit" | "restore" | "push";
const DEFAULT_H: Record<PaneKey, number> = { changes: 250, commit: 240, restore: 330, push: 210 };
const MIN_PANE = 64;
const MIN_PREVIEW = 140;

export default function Inspector({ s }: { s: Scenario }) {
  const [width, setWidth] = useState(380);
  const [heights, setHeights] = useState(DEFAULT_H);
  const startW = useRef(0);
  const startH = useRef(0);

  // 지금 보여줄 칸들 (위에서부터). 미리보기는 항상 마지막에 남은 공간을 차지
  const panes: { key: PaneKey; node: React.ReactNode }[] = [];
  if (s.phase === "save") {
    panes.push({ key: "changes", node: <ChangesPanel s={s} /> });
    if (s.pending.length) panes.push({ key: "commit", node: <CommitBox s={s} /> });
  } else if (s.phase === "conflict") {
    panes.push({ key: "restore", node: <ConflictPanel s={s} /> });
  } else {
    panes.push({ key: "restore", node: <RestorePanel s={s} /> });
  }
  if (s.local.length) panes.push({ key: "push", node: <PushPanel s={s} /> });

  return (
    <>
      <Splitter
        dir="x"
        onStart={() => (startW.current = width)}
        onDrag={(d) => setWidth(clamp(startW.current - d, 300, 760))}
      />
      <aside className="flex shrink-0 flex-col overflow-hidden bg-panel" style={{ width }}>
        {panes.map((p) => (
          <Fragment key={p.key}>
            <div className="min-h-0 overflow-y-auto" style={{ flex: `0 1 ${heights[p.key]}px`, minHeight: MIN_PANE }}>
              {p.node}
            </div>
            <Splitter
              dir="y"
              onStart={() => (startH.current = heights[p.key])}
              onDrag={(d) => setHeights((h) => ({ ...h, [p.key]: clamp(startH.current + d, MIN_PANE, 900) }))}
            />
          </Fragment>
        ))}
        <div className="flex min-h-0 flex-col p-3" style={{ flex: `1 1 ${MIN_PREVIEW}px`, minHeight: MIN_PREVIEW }}>
          <div className="mb-2 flex shrink-0 items-center justify-between text-[11px]">
            <span className="font-medium text-muted">미리보기</span>
            <span className="text-dim">{s.previewLabel}</span>
          </div>
          <div className="min-h-0 flex-1">
            <SitePreview state={s.preview} />
          </div>
        </div>
      </aside>
    </>
  );
}

/* ---------- 바뀐 파일 ---------- */

function ChangesPanel({ s }: { s: Scenario }) {
  const files = CHANGED_FILES.filter((f) => s.pending.includes(f.path));
  const allOn = files.length > 0 && s.checked.length === files.length;

  return (
    <Panel
      title="바뀐 내용"
      term="changes"
      right={
        files.length ? (
          <button onClick={s.toggleAll} className="flex items-center gap-1.5 text-muted hover:text-fg">
            <Box on={allOn} partial={!allOn && s.checked.length > 0} /> 전체 {files.length}
          </button>
        ) : null
      }
    >
      {files.length === 0 ? (
        <div className="flex items-center gap-2 text-[12px] text-dim">
          <Check size={14} className="text-green" /> 저장하지 않은 변경이 없어요
          {s.envIgnored && <span className="text-dim">· .env 는 자동 제외 중</span>}
        </div>
      ) : (
        <div className="space-y-3">
          <ul className="border border-line-soft">
            {files.map((f) => (
              <FileRow key={f.path} f={f} on={s.checked.includes(f.path)} toggle={() => s.toggleFile(f.path)} explained={s.analyzed} />
            ))}
          </ul>
          {!s.analyzed && (
            <button
              onClick={() => s.analyze()}
              disabled={s.analyzing}
              className="flex w-full items-center justify-center gap-1.5 rounded-[3px] border border-[#b9a6f5]/30 py-1.5 text-[12px] text-[#b9a6f5] hover:bg-[#b9a6f5]/10 disabled:opacity-60"
            >
              {s.analyzing ? <Spin /> : <Sparkles size={13} />}
              {s.analyzing ? "AI가 읽고 있어요…" : "무엇이 바뀌었는지 쉬운 말로 설명 듣기"}
            </button>
          )}
          <p className="text-[11px] leading-relaxed text-dim">체크한 파일만 이번 저장에 들어가요. 나눠서 여러 번 저장해도 돼요.</p>
        </div>
      )}
    </Panel>
  );
}

function FileRow({ f, on, toggle, explained }: { f: ChangedFile; on: boolean; toggle: () => void; explained: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-line-soft last:border-0">
      <div className="flex items-start gap-2.5 px-2.5 py-2">
        <button onClick={toggle} className="mt-0.5">
          <Box on={on} />
        </button>
        <button onClick={toggle} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2 font-mono text-[12px]">
            <span className={f.status === "A" ? "text-green" : "text-amber"}>{f.status}</span>
            <span className={on ? "text-fg" : "text-dim"}>{f.path}</span>
            {f.sensitive && <KeyRound size={11} className="text-amber" />}
          </div>
          {explained && (
            <div className="rise mt-1 text-[12px] leading-snug text-muted">
              <Sparkles size={10} className="mr-1 inline text-[#b9a6f5]" />
              {f.plain}
            </div>
          )}
        </button>
        <button onClick={() => setOpen(!open)} className="shrink-0 pt-0.5 font-mono text-[10px] text-dim hover:text-teal">
          {open ? "접기" : "diff"}
        </button>
      </div>
      {open && (
        <pre className="mx-2.5 mb-2 overflow-x-auto bg-base p-2 font-mono text-[10.5px] leading-relaxed">
          {f.diff.map((l, i) => (
            <div key={i} className={l.type === "add" ? "text-green" : l.type === "del" ? "text-red" : "text-dim"}>
              {l.type === "add" ? "+ " : l.type === "del" ? "- " : "  "}
              {l.text}
            </div>
          ))}
        </pre>
      )}
    </li>
  );
}

/* ---------- 커밋 메시지 ---------- */

function CommitBox({ s }: { s: Scenario }) {
  if (!s.pending.length) return null;
  const n = s.checked.length;
  return (
    <Panel title="저장 메시지" term="commit">
      <div className="space-y-2">
        <div className="relative">
          <input
            value={s.message}
            onChange={(e) => s.setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && s.commit()}
            placeholder="무엇을 바꿨나요? (예: 메뉴에 시즌 음료 추가)"
            className="w-full rounded-[3px] border border-line bg-base py-2 pr-20 pl-2.5 text-[13px] text-fg outline-none placeholder:text-dim focus:border-teal/60"
          />
          <button
            onClick={s.suggest}
            disabled={!n || s.analyzing}
            className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-1 rounded-[3px] px-1.5 py-1 text-[11px] text-[#b9a6f5] hover:bg-[#b9a6f5]/10 disabled:opacity-40"
          >
            {s.analyzing ? <Spin /> : <Sparkles size={11} />} AI 추천
          </button>
        </div>
        <textarea
          value={s.description}
          onChange={(e) => s.setDescription(e.target.value)}
          rows={2}
          placeholder="자세한 설명 (선택)"
          className="w-full resize-none rounded-[3px] border border-line bg-base px-2.5 py-2 text-[12px] text-fg outline-none placeholder:text-dim focus:border-teal/60"
        />
        <Primary onClick={() => s.commit()} disabled={!s.canCommit}>
          <GitCommitHorizontal size={15} />
          커밋하기
          <span className="font-normal opacity-70">· 파일 {n}개</span>
        </Primary>
        <p className="text-[11px] text-dim">
          {!n ? "저장할 파일을 하나 이상 체크해 주세요." : !s.message.trim() ? "메시지를 적거나 ‘AI 추천’을 눌러보세요." : "내 컴퓨터에 저장 지점이 만들어져요. 온라인에는 ‘올리기’로 올려요."}
        </p>
      </div>
    </Panel>
  );
}

/* ---------- 올리기 (푸시) ---------- */

function PushPanel({ s }: { s: Scenario }) {
  const list = s.local; // 최신이 앞
  if (!list.length) return null;
  const n = s.unpushed.length;
  const oldestFirstUnpushed = [...s.unpushed].reverse();

  return (
    <Panel
      title="내가 만든 저장 지점"
      term="push"
      right={n ? <span className="text-amber">↑ {n}개 올리기 전</span> : <span className="text-green">모두 올라감</span>}
    >
      <div className="space-y-3">
        <ul className="border border-line-soft">
          {list.map((c) => {
            const order = oldestFirstUnpushed.findIndex((x) => x.id === c.id);
            const busy = s.pushing != null;
            return (
              <li key={c.id} className="flex items-center gap-2.5 border-b border-line-soft px-2.5 py-2 last:border-0">
                {c.pushed ? (
                  <Cloud size={14} className="shrink-0 text-green" />
                ) : (
                  <GitCommitHorizontal size={14} className="shrink-0 text-amber" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] text-fg">{c.msg}</div>
                  <div className="font-mono text-[10px] text-dim">
                    {c.hash} · 파일 {c.files?.length ?? 0}개{c.files?.includes(".env") && <span className="text-amber"> · API 키 포함</span>}
                  </div>
                </div>
                {c.pushed ? (
                  <span className="text-[11px] text-dim">올라감</span>
                ) : (
                  <button
                    onClick={() => s.push(c.id)}
                    disabled={busy}
                    title={order > 0 ? `이전 저장 지점 ${order}개도 함께 올라가요` : undefined}
                    className="flex shrink-0 items-center gap-1 rounded-[3px] border border-line px-2 py-1 text-[11px] text-muted hover:border-teal/50 hover:text-fg disabled:opacity-40"
                  >
                    {s.pushing === c.id ? <Spin /> : <CloudUpload size={12} />}
                    {order > 0 ? `여기까지 (${order + 1})` : "올리기"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {n > 0 && (
          <>
            <Primary onClick={() => s.push()} disabled={s.pushing != null}>
              {s.pushing ? <Spin dark /> : <CloudUpload size={15} />}
              모두 올리기
              <span className="font-normal opacity-70">· {n}개</span>
            </Primary>
            {n > 1 && (
              <p className="text-[11px] leading-relaxed text-dim">
                하나씩 올릴 수도 있어요. 다만 Git은 순서대로 올라가서, 새 저장 지점을 올리면 그 전 것도 함께 올라가요.
              </p>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

/* ---------- 과제 2 ---------- */

function RestorePanel({ s }: { s: Scenario }) {
  const step = s.restoreStep;
  const sel = s.commits.find((c) => c.id === s.selectedId);

  if (step === "broken") {
    return (
      <Panel title="문제가 생겼어요" right={<span className="text-red">오류 1</span>}>
        <div className="rise space-y-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={17} className="mt-0.5 shrink-0 text-red" />
            <div className="text-[13px] leading-relaxed text-fg">메뉴 페이지가 하얗게 보여요.</div>
          </div>
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-[#b9a6f5]">
              <Sparkles size={12} /> 무슨 일이 생겼냐면요
            </div>
            <p className="text-[12px] leading-relaxed text-muted">{BROKEN.plain}</p>
            <details className="mt-2 text-[11px] text-dim">
              <summary className="cursor-pointer hover:text-muted">원래 오류 메시지</summary>
              <code className="mt-1 block font-mono text-red/80">{BROKEN.error}</code>
            </details>
          </div>
          <p className="border-l-2 border-green/60 pl-2.5 text-[12px] leading-relaxed text-muted">
            아까 잘 되던 상태를 저장해 뒀기 때문에 그때로 돌아갈 수 있어요.
          </p>
          <Primary onClick={() => s.openPick()}>
            <RotateCcw size={14} /> 잘 되던 때로 되돌리기 <span className="font-mono text-[10px] opacity-60">revert</span>
          </Primary>
          <button className="w-full py-1.5 text-[12px] text-dim hover:text-muted">AI에게 고쳐달라고 하기 (준비 중)</button>
        </div>
      </Panel>
    );
  }

  if (step === "restored") {
    return (
      <Panel title="되돌리기 완료" term="revert">
        <div className="rise space-y-3">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green" />
            <div className="text-[12px] leading-relaxed text-muted">
              사이트가 다시 잘 보여요. 망가졌던 상태는 그래프의 <span className="text-amber">백업/되돌리기-전</span> 갈래에
              남겨 뒀으니 필요하면 다시 꺼내볼 수 있어요.
            </div>
          </div>
          <Primary onClick={s.goConflict}>다음 상황으로 (팀원과 충돌)</Primary>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="돌아갈 시점 고르기" term="revert">
      <div className="space-y-4">
        <p className="text-[12px] leading-relaxed text-muted">
          왼쪽 그래프에서 저장 지점을 누르면 그때 모습을 아래에서 미리 볼 수 있어요.
        </p>
        {sel && (
          <div className="rise border border-line bg-base p-3">
            <div className="flex items-center justify-between font-mono text-[10px] text-dim">
              <span>{sel.hash}</span>
              <span>{sel.when}</span>
            </div>
            <div className="mt-1 text-[13px] font-medium text-fg">{sel.msg}</div>
            <div className={`mt-1 text-[11px] ${sel.preview === "broken" ? "text-red" : "text-green"}`}>
              {sel.preview === "broken" ? "● 오류 있음" : "● 이 시점에는 사이트가 잘 동작했어요"}
            </div>
            {sel.preview === "before" && (
              <div className="mt-1 text-[11px] text-amber">이 시점으로 가면 가을 시즌 음료 메뉴는 없어져요</div>
            )}
          </div>
        )}
        <Primary onClick={s.askConfirm} disabled={!sel || step !== "pick"}>
          이 상태로 되돌리기
        </Primary>
        {step === "restoring" && (
          <div className="flex items-center gap-2 font-mono text-[12px] text-dim">
            <Spin /> 되돌리는 중…
          </div>
        )}
      </div>
    </Panel>
  );
}

/* ---------- 과제 3: 팀원과 충돌 ---------- */

function ConflictPanel({ s }: { s: Scenario }) {
  const step = s.conflictStep;

  if (step === "merged") {
    return (
      <Panel title="합치기 완료" term="pull">
        <div className="rise space-y-3">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green" />
            <div className="text-[12px] leading-relaxed text-muted">
              팀원의 변경과 내 변경을 합쳤어요. 그래프에서 두 갈래가 하나로 이어진 걸 볼 수 있어요. 이제 ‘올리기’를 하면 팀원도 합친 결과를 받을 수 있어요.
            </div>
          </div>
          <Primary onClick={s.finish}>테스트 마치기</Primary>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="받아오기" term="pull" right={<span className="text-blue">↓ 1개 새로 있음</span>}>
      <div className="rise space-y-4">
        <div className="flex items-start gap-2.5 border border-line-soft p-2.5">
          <ArrowDown size={14} className="mt-0.5 shrink-0 text-blue" />
          <div className="min-w-0">
            <div className="text-[12px] text-fg">{DEMO_TEAMMATE.msg}</div>
            <div className="text-[10px] text-dim">
              {DEMO_TEAMMATE.author} · 방금 · 파일 1개 ({DEMO_CONFLICT_FILE})
            </div>
          </div>
        </div>

        {step === "incoming" && (
          <>
            <p className="text-[12px] leading-relaxed text-muted">
              팀원이 온라인에 새 저장 지점을 올렸어요. 받아와서 내 작업과 합쳐 볼까요?
            </p>
            <button
              onClick={() => s.demoPull()}
              className="flex w-full items-center justify-center gap-2 rounded-[3px] bg-blue px-3 py-2 text-[13px] font-semibold text-[#081a33] hover:brightness-110"
            >
              <CloudDownload size={15} /> 받아오기 <span className="font-normal opacity-70">· 1개</span>
            </button>
          </>
        )}

        {(step === "failed" || step === "merging") && (
          <div className="space-y-2 border border-amber/40 bg-amber/5 p-3 text-[12px] leading-relaxed">
            <div className="flex items-center gap-1.5 font-medium text-amber">
              <GitMerge size={13} /> {step === "failed" ? "자동으로 합칠 수 없었어요" : "합치는 중이에요"}
            </div>
            <p className="text-muted">
              {step === "failed" ? (
                <>
                  나와 팀원이 같은 부분을 서로 다르게 고쳤어요. <span className="text-fg">받아오기를 취소하고 원래 상태로 되돌려 놨어요.</span>
                </>
              ) : (
                "충돌 해결을 마치거나 취소해야 다른 작업을 할 수 있어요."
              )}
            </p>
            <ul className="font-mono text-[11px] text-fg">
              <li>· {DEMO_CONFLICT_FILE}</li>
            </ul>
            <button
              onClick={s.demoOpenResolver}
              className="rounded-[3px] bg-amber px-3 py-1.5 text-[12px] font-semibold text-[#2a1a00] hover:brightness-110"
            >
              {step === "failed" ? "충돌 해결하기" : "이어서 해결하기"}
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}

/* ---------- 공통 ---------- */

function Panel({
  title,
  term,
  right,
  children,
}: {
  title: string;
  term?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="sticky top-0 z-10 flex h-8 items-center gap-2 border-b border-line-soft bg-panel px-4 text-[11px] font-medium tracking-wide text-muted">
        {title}
        {term && <GitChip term={term} />}
        <span className="ml-auto text-[11px] font-normal text-dim">{right}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Box({ on, partial }: { on: boolean; partial?: boolean }) {
  return (
    <span
      className={`flex h-3.5 w-3.5 items-center justify-center rounded-[2px] border ${
        on ? "border-teal bg-teal text-[#0b2626]" : partial ? "border-teal" : "border-dim"
      }`}
    >
      {on ? <Check size={10} strokeWidth={3} /> : partial ? <span className="h-0.5 w-1.5 bg-teal" /> : null}
    </span>
  );
}

function Spin({ dark }: { dark?: boolean }) {
  return (
    <span
      className={`h-3 w-3 animate-spin rounded-full border-2 ${dark ? "border-[#0b2626]/30 border-t-[#0b2626]" : "border-line border-t-teal"}`}
    />
  );
}

export function Primary({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-center gap-2 rounded-[3px] bg-teal px-3 py-2 text-[13px] font-semibold text-[#0b2626] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}
