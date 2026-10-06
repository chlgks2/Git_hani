// 파일 하나의 바뀐 줄을 보여주는 화면. 기본은 나란히 보기(왼쪽 원래 / 오른쪽 바뀐 것)
import { useEffect, useState } from "react";
import { Columns2, FileCode2, Rows3, X } from "lucide-react";
import { gitFileDiff, STATUS_TONE, type DiffHunk, type DiffLine, type FileDiff } from "../git";
import type { RealRepo } from "./RealRepo";

type Row = { left?: DiffLine; right?: DiffLine };

/** 지워진 줄 묶음과 추가된 줄 묶음을 같은 높이에 짝지어 나란히 놓는다 */
function pairRows(lines: DiffLine[]): Row[] {
  const rows: Row[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) rows.push({ left: dels[i], right: adds[i] });
    dels = [];
    adds = [];
  };
  for (const l of lines) {
    if (l.kind === "del") {
      if (adds.length) flush(); // 추가 뒤에 다시 삭제가 오면 새 묶음
      dels.push(l);
    } else if (l.kind === "add") adds.push(l);
    else {
      flush();
      rows.push({ left: l, right: l });
    }
  }
  flush();
  return rows;
}

/** "@@ -10,7 +12,8 @@ function foo" → "12번째 줄 근처 · function foo" */
function hunkTitle(h: DiffHunk) {
  const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(h.header);
  if (!m) return h.header;
  return `${m[1]}번째 줄 근처${m[2] ? ` · ${m[2]}` : ""}`;
}

export default function DiffViewer({ r }: { r: RealRepo }) {
  const repo = r.repo!;
  const file = r.diffFile!;
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [split, setSplit] = useState(true);

  useEffect(() => {
    setDiff(null);
    setError(null);
    gitFileDiff(repo.root, file).then(setDiff).catch((e) => setError(String(e)));
  }, [file, repo.root]);

  // Esc 로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && r.closeDiff();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [r]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-base">
      <header className="flex shrink-0 items-center gap-4 border-b border-line bg-panel px-5 py-3">
        <FileCode2 size={17} className="text-teal" />
        <div className="min-w-0">
          <div className="truncate font-mono text-[14px] text-fg">{file}</div>
          <div className="text-[12px] text-muted">
            마지막 저장 이후 바뀐 내용
            {diff && !diff.binary && !diff.tooLarge && (
              <span className="ml-2 font-mono">
                <span className="text-green">+{diff.added}</span> <span className="text-red">−{diff.deleted}</span>
              </span>
            )}
            {diff?.untracked && <span className="ml-2 text-green">· 새 파일</span>}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1 rounded-[3px] border border-line p-0.5 text-[11px]">
          <button
            onClick={() => setSplit(true)}
            className={`flex items-center gap-1 rounded-[2px] px-2 py-1 ${split ? "bg-raised text-fg" : "text-dim hover:text-muted"}`}
          >
            <Columns2 size={12} /> 나란히
          </button>
          <button
            onClick={() => setSplit(false)}
            className={`flex items-center gap-1 rounded-[2px] px-2 py-1 ${!split ? "bg-raised text-fg" : "text-dim hover:text-muted"}`}
          >
            <Rows3 size={12} /> 한 줄로
          </button>
        </div>
        <button onClick={r.closeDiff} className="text-dim hover:text-fg" title="닫기 (Esc)">
          <X size={16} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 overflow-y-auto border-r border-line bg-panel py-2">
          <div className="px-3 pb-1 text-[11px] font-medium text-muted">바뀐 파일</div>
          {repo.files.map((f) => (
            <button
              key={f.path}
              onClick={() => r.openDiff(f.path)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[12px] ${
                f.path === file ? "bg-raised text-fg" : "text-fg/80 hover:bg-hover"
              }`}
            >
              <span className={`w-3 shrink-0 ${STATUS_TONE[f.status]}`}>{f.status}</span>
              <span className="truncate">{f.path}</span>
            </button>
          ))}
        </aside>

        <main className="min-w-0 flex-1 overflow-auto">
          {error ? (
            <div className="p-6 text-[12px] text-red">{error}</div>
          ) : !diff ? (
            <div className="p-6 text-[12px] text-dim">불러오는 중…</div>
          ) : diff.binary ? (
            <Notice text="이미지 같은 파일이라 줄 단위로 비교할 수 없어요." />
          ) : diff.tooLarge ? (
            <Notice text="파일이 너무 커서(2MB 이상) 줄 단위로 보여주지 않아요." />
          ) : diff.hunks.length === 0 ? (
            <Notice text="내용은 같아요. 권한이나 줄바꿈 방식만 바뀌었을 수 있어요." />
          ) : (
            <div className="space-y-4 p-4">
              {diff.hunks.map((h, i) => (
                <section key={i} className="overflow-hidden border border-line-soft">
                  <div className="border-b border-line-soft bg-panel px-3 py-1.5 text-[11px] text-muted">{hunkTitle(h)}</div>
                  {split ? <SplitHunk lines={h.lines} /> : <UnifiedHunk lines={h.lines} />}
                </section>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center text-[13px] text-dim">{text}</div>;
}

const ROW_TONE = { add: "bg-green/10", del: "bg-red/10", ctx: "" };
const SIGN = { add: "+", del: "−", ctx: " " };

function Cell({ line, side }: { line?: DiffLine; side: "left" | "right" }) {
  if (!line) return <td colSpan={2} className="bg-[repeating-linear-gradient(135deg,transparent_0_6px,#ffffff06_6px_12px)]" />;
  const no = side === "left" ? line.old : line.new;
  return (
    <>
      <td className={`w-12 border-r border-line-soft px-2 text-right align-top text-dim select-none ${ROW_TONE[line.kind]}`}>{no}</td>
      <td className={`px-2 align-top whitespace-pre-wrap break-all ${ROW_TONE[line.kind]}`}>
        <span className={`mr-1 select-none ${line.kind === "add" ? "text-green" : line.kind === "del" ? "text-red" : "text-dim"}`}>
          {SIGN[line.kind]}
        </span>
        {line.text || " "}
      </td>
    </>
  );
}

function SplitHunk({ lines }: { lines: DiffLine[] }) {
  return (
    <table className="w-full table-fixed border-collapse font-mono text-[12px] leading-[20px] text-fg/90">
      <colgroup>
        <col className="w-12" />
        <col />
        <col className="w-12" />
        <col />
      </colgroup>
      <tbody>
        {pairRows(lines).map((row, i) => (
          <tr key={i}>
            <Cell line={row.left} side="left" />
            <Cell line={row.right} side="right" />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function UnifiedHunk({ lines }: { lines: DiffLine[] }) {
  return (
    <table className="w-full border-collapse font-mono text-[12px] leading-[20px] text-fg/90">
      <tbody>
        {lines.map((l, i) => (
          <tr key={i} className={ROW_TONE[l.kind]}>
            <td className="w-12 px-2 text-right text-dim select-none">{l.old}</td>
            <td className="w-12 border-r border-line-soft px-2 text-right text-dim select-none">{l.new}</td>
            <td className="px-2 whitespace-pre-wrap break-all">
              <span className={`mr-1 select-none ${l.kind === "add" ? "text-green" : l.kind === "del" ? "text-red" : "text-dim"}`}>
                {SIGN[l.kind]}
              </span>
              {l.text || " "}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
