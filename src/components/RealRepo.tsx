// 실제 저장소 모드: 사용자가 고른 폴더의 git status 를 보여준다.
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, CloudOff, FileCode2, FolderGit2, GitBranch, RefreshCw } from "lucide-react";
import { gitStatus, pickFolder, STATUS_LABEL, STATUS_TONE, type RepoStatus } from "../git";
import type { Block } from "../store";
import Splitter, { clamp } from "./Splitter";
import { BlockView } from "./Terminal";
import { GitChip } from "./Term";

let seq = 1;

export function useRealRepo() {
  const [repo, setRepo] = useState<RepoStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState<Block[]>([]);
  const pathRef = useRef<string | null>(null);

  const load = async (path: string, title: string) => {
    setLoading(true);
    try {
      const st = await gitStatus(path);
      pathRef.current = st.root;
      setRepo(st);
      setLog((l) => [...l, statusBlock(st, title)]);
    } catch (e) {
      setLog((l) => [...l, { id: seq++, title, git: "git status", lines: [{ tone: "err", text: String(e) }] }]);
    } finally {
      setLoading(false);
    }
  };

  const open = async () => {
    const path = await pickFolder();
    if (path) await load(path, "저장소 열기");
  };
  const refresh = () => pathRef.current && load(pathRef.current, "지금 상태 확인");
  const close = () => {
    pathRef.current = null;
    setRepo(null);
    setLog([]);
  };

  // 다른 프로그램(AI 코딩 도구 등)에서 파일을 바꾸고 돌아오면 자동으로 다시 읽는다
  useEffect(() => {
    const onFocus = () => {
      if (pathRef.current) gitStatus(pathRef.current).then(setRepo).catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  return { repo, loading, log, open, refresh, close };
}

export type RealRepo = ReturnType<typeof useRealRepo>;

function statusBlock(st: RepoStatus, title: string): Block {
  const lines: Block["lines"] = [];
  const where = st.branch ? `${st.branch} 에서 작업 중` : "갈래가 아닌 곳(특정 저장 지점)에 있어요";
  lines.push({ tone: "plain", text: `${st.name} · ${where}` });
  if (st.noCommits) lines.push({ tone: "dim", text: "아직 저장 지점이 하나도 없는 새 저장소예요" });
  if (st.upstream) {
    if (st.ahead) lines.push({ tone: "warn", text: `아직 온라인에 올리지 않은 저장 지점 ${st.ahead}개` });
    if (st.behind) lines.push({ tone: "warn", text: `온라인에 새로 올라온 저장 지점 ${st.behind}개 (아직 안 받음)` });
    if (!st.ahead && !st.behind) lines.push({ tone: "ok", text: `온라인(${st.upstream})과 같은 상태예요` });
  } else if (!st.noCommits) {
    lines.push({ tone: "dim", text: "온라인 저장소와 연결되지 않은 갈래예요" });
  }
  if (st.files.length) {
    lines.push({ tone: "warn", text: `아직 저장하지 않은 변경 ${st.files.length}개` });
    for (const f of st.files.slice(0, 30)) lines.push({ tone: "dim", text: `  ${f.status}  ${f.path}` });
    if (st.files.length > 30) lines.push({ tone: "dim", text: `  … 외 ${st.files.length - 30}개` });
  } else {
    lines.push({ tone: "ok", text: "저장하지 않은 변경이 없어요" });
  }
  return { id: seq++, title, git: "git status", lines };
}

/* ---------- 왼쪽: 바뀐 파일 트리 ---------- */

export function RealExplorer({ r }: { r: RealRepo }) {
  const [width, setWidth] = useState(240);
  const start = useRef(0);
  const repo = r.repo!;
  return (
    <>
      <aside className="flex shrink-0 flex-col bg-panel" style={{ width }}>
        <div className="flex h-8 shrink-0 items-center justify-between border-b border-line-soft px-3 text-[11px] font-medium tracking-wide text-muted">
          바뀐 파일
          <span className="text-[10px] font-normal text-dim">{repo.files.length ? `${repo.files.length} 변경` : "깨끗함"}</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium text-fg">
          <FolderGit2 size={14} className="text-muted" /> {repo.name}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          {repo.files.map((f) => (
            <div key={f.path} className="flex h-[26px] items-center gap-1.5 pr-2 pl-6 hover:bg-hover" title={f.path}>
              <FileCode2 size={13} className="shrink-0 text-dim" />
              <span className={`truncate ${STATUS_TONE[f.status]}`}>{f.path}</span>
              <span className={`ml-auto font-mono text-[11px] ${STATUS_TONE[f.status]}`}>{f.status}</span>
            </div>
          ))}
          {!repo.files.length && <div className="px-6 text-[12px] text-dim">저장하지 않은 변경이 없어요</div>}
        </div>
      </aside>
      <Splitter dir="x" onStart={() => (start.current = width)} onDrag={(d) => setWidth(clamp(start.current + d, 180, 480))} />
    </>
  );
}

/* ---------- 가운데: 그래프 자리 + 상태 기록 ---------- */

export function RealMain({ r, termH, splitter }: { r: RealRepo; termH: number; splitter: React.ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [r.log]);
  const repo = r.repo!;

  return (
    <>
      <section className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-base text-center">
        <GitBranch size={22} className="text-dim" />
        <div className="text-[13px] text-muted">
          저장 기록 그래프 <GitChip term="graph" />
        </div>
        <div className="text-[12px] text-dim">다음 단계에서 실제 저장 기록(git log)과 연결돼요</div>
      </section>
      {splitter}
      <section className="flex shrink-0 flex-col bg-panel" style={{ height: termH }}>
        <div className="flex h-8 shrink-0 items-center border-b border-line-soft px-3 text-[12px] text-fg">
          작업 기록
          <span className="ml-auto font-mono text-[10px] text-dim">{repo.root}</span>
        </div>
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto bg-base">
          {r.log.map((b) => (
            <BlockView key={b.id} b={b} />
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-2.5">
          <button
            onClick={r.refresh}
            disabled={r.loading}
            className="flex items-center gap-1.5 rounded-[3px] border border-line px-2 py-1 text-[11px] text-muted hover:border-teal/50 hover:text-fg disabled:opacity-40"
          >
            <RefreshCw size={11} className={r.loading ? "animate-spin" : ""} /> 지금 상태 다시 확인
          </button>
          <span className="text-[11px] text-dim">다른 프로그램에서 파일을 바꾸고 돌아오면 자동으로 다시 읽어요</span>
        </div>
      </section>
    </>
  );
}

/* ---------- 오른쪽: 변경 목록 ---------- */

export function RealInspector({ r }: { r: RealRepo }) {
  const [width, setWidth] = useState(380);
  const start = useRef(0);
  const repo = r.repo!;

  return (
    <>
      <Splitter dir="x" onStart={() => (start.current = width)} onDrag={(d) => setWidth(clamp(start.current - d, 300, 760))} />
      <aside className="flex shrink-0 flex-col overflow-y-auto bg-panel" style={{ width }}>
        <div className="sticky top-0 z-10 flex h-8 items-center gap-2 border-b border-line-soft bg-panel px-4 text-[11px] font-medium tracking-wide text-muted">
          바뀐 내용 <GitChip term="changes" />
          <span className="ml-auto text-[11px] font-normal text-dim">{repo.files.length}개 파일</span>
        </div>
        <div className="space-y-4 p-4">
          <Sync repo={repo} />
          {repo.files.length ? (
            <ul className="border border-line-soft">
              {repo.files.map((f) => (
                <li key={f.path} className="flex items-center gap-2 border-b border-line-soft px-2.5 py-1.5 last:border-0">
                  <span className={`w-3 font-mono text-[12px] ${STATUS_TONE[f.status]}`}>{f.status}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg/90" title={f.path}>
                    {f.path}
                  </span>
                  <span className="shrink-0 text-[10px] text-dim">
                    {STATUS_LABEL[f.status]}
                    {f.staged && " · 준비됨"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-2 text-[12px] text-dim">
              <Check size={14} className="text-green" /> 저장하지 않은 변경이 없어요
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-dim">
            지금은 상태 확인만 연결돼 있어요. 커밋·올리기는 다음 단계에서 이 화면에 붙어요.
          </p>
        </div>
      </aside>
    </>
  );
}

function Sync({ repo }: { repo: RepoStatus }) {
  if (repo.noCommits) return <Row icon={<GitBranch size={13} className="text-dim" />} text="아직 저장 지점이 없는 새 저장소예요" />;
  if (!repo.upstream) return <Row icon={<CloudOff size={13} className="text-dim" />} text="온라인 저장소와 연결되지 않은 갈래예요" />;
  return (
    <div className="flex items-center gap-4 border border-line-soft px-3 py-2 text-[12px]">
      <span className="truncate font-mono text-[11px] text-muted">{repo.upstream}</span>
      <span className={`ml-auto flex items-center gap-1 ${repo.ahead ? "text-amber" : "text-dim"}`} title="아직 올리지 않은 저장 지점">
        <ArrowUp size={12} /> {repo.ahead}
      </span>
      <span className={`flex items-center gap-1 ${repo.behind ? "text-amber" : "text-dim"}`} title="아직 받지 않은 저장 지점">
        <ArrowDown size={12} /> {repo.behind}
      </span>
    </div>
  );
}

function Row({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 border border-line-soft px-3 py-2 text-[12px] text-muted">
      {icon} {text}
    </div>
  );
}
