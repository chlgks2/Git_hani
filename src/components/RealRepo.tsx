// 실제 저장소 모드: 사용자가 고른 폴더의 상태·저장 기록을 보여주고, 고른 파일을 커밋한다.
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Cloud, CloudOff, CloudUpload, FileCode2, FolderGit2, GitBranch, GitCommitHorizontal, KeyRound, RefreshCw } from "lucide-react";
import {
  gitCommit,
  gitLog,
  gitPush,
  gitStatus,
  gitUnpushed,
  looksSecret,
  pickFolder,
  STATUS_LABEL,
  STATUS_TONE,
  type CommitInfo,
  type FileChange,
  type RepoStatus,
  type UnpushedCommit,
} from "../git";
import type { Block } from "../store";
import RealGraph from "./RealGraph";
import Splitter, { clamp } from "./Splitter";
import { BlockView } from "./Terminal";
import { GitChip } from "./Term";

let seq = 1;

/** 비밀 정보로 보이는 파일이 있어 확인이 필요한 상황 */
type SecretAsk = { mode: "commit"; files: string[] } | { mode: "push"; files: string[]; upTo?: string };

export function useRealRepo() {
  const [repo, setRepo] = useState<RepoStatus | null>(null);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState<Block[]>([]);
  const [checked, setCheckedState] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [description, setDescription] = useState("");
  const [committing, setCommitting] = useState(false);
  const [unpushed, setUnpushed] = useState<UnpushedCommit[]>([]);
  const [pushing, setPushing] = useState<string | null>(null); // 올리는 중인 대상 (해시 또는 "all")
  const [secretAsk, setSecretAsk] = useState<SecretAsk | null>(null);

  const pathRef = useRef<string | null>(null);
  const checkedRef = useRef(checked);
  const seen = useRef<Set<string>>(new Set()); // 이전에 본 파일들 (새로 나타난 파일만 기본 체크)

  const setChecked = (next: Set<string>) => {
    checkedRef.current = next;
    setCheckedState(next);
  };
  const addBlock = (b: Omit<Block, "id">) => setLog((l) => [...l, { ...b, id: seq++ }]);

  /** 상태와 기록을 다시 읽어 화면에 반영한다 */
  const fetchAll = async (path: string) => {
    const [st, list, ahead] = await Promise.all([
      gitStatus(path),
      gitLog(path),
      gitUnpushed(path).catch(() => [] as UnpushedCommit[]),
    ]);
    pathRef.current = st.root;
    // 체크 상태 유지: 이미 있던 파일은 그대로, 새로 나타난 파일은 체크 (비밀 정보로 보이면 체크 안 함)
    const next = new Set<string>();
    for (const f of st.files) {
      const isNew = !seen.current.has(f.path);
      if (isNew ? !looksSecret(f.path) : checkedRef.current.has(f.path)) next.add(f.path);
    }
    seen.current = new Set(st.files.map((f) => f.path));
    setChecked(next);
    setRepo(st);
    setCommits(list);
    setUnpushed(ahead);
    return st;
  };

  const load = async (path: string, title: string) => {
    setLoading(true);
    try {
      const st = await fetchAll(path);
      addBlock(statusBlock(st, title));
    } catch (e) {
      addBlock({ title, git: "git status", lines: [{ tone: "err", text: String(e) }] });
    } finally {
      setLoading(false);
    }
  };

  const open = async () => {
    const path = await pickFolder();
    if (!path) return;
    seen.current = new Set();
    setMessage("");
    setDescription("");
    await load(path, "저장소 열기");
  };
  const refresh = () => pathRef.current && load(pathRef.current, "지금 상태 확인");
  const close = () => {
    pathRef.current = null;
    seen.current = new Set();
    setRepo(null);
    setCommits([]);
    setUnpushed([]);
    setLog([]);
  };

  const toggle = (path: string) => {
    const next = new Set(checkedRef.current);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setChecked(next);
  };
  const toggleAll = () => {
    if (!repo) return;
    setChecked(checkedRef.current.size === repo.files.length ? new Set() : new Set(repo.files.map((f) => f.path)));
  };

  /**
   * 체크한 파일을 커밋한다.
   * 비밀 정보로 보이는 파일이 있으면 먼저 확인 창을 띄운다(force 로 넘어가거나, exclude 로 빼고 저장).
   */
  const commit = async (opts: { force?: boolean; exclude?: string[] } = {}) => {
    if (!repo || committing) return;
    const msg = message.trim();
    const picked = repo.files.filter((f) => checkedRef.current.has(f.path) && !opts.exclude?.includes(f.path));
    if (!msg || !picked.length) return;

    const secrets = picked.map((f) => f.path).filter(looksSecret);
    if (secrets.length && !opts.force) {
      setSecretAsk({ mode: "commit", files: secrets });
      return;
    }
    setSecretAsk(null);
    if (opts.exclude?.length) {
      const next = new Set(checkedRef.current);
      opts.exclude.forEach((p) => next.delete(p));
      setChecked(next);
    }

    // 이름이 바뀐 파일은 원래 이름(삭제 쪽)도 함께 넣어야 온전히 저장된다
    const paths = picked.flatMap((f) => (f.origPath ? [f.path, f.origPath] : [f.path]));
    setCommitting(true);
    try {
      const res = await gitCommit(repo.root, paths, msg, description);
      addBlock({
        title: "커밋하기",
        git: `git commit -m "${msg}" -- ${picked.length}개 파일`,
        lines: [
          { tone: "ok", text: `저장 지점을 만들었어요 · ${res.short} “${msg}”` },
          ...picked.slice(0, 20).map((f) => ({ tone: "dim" as const, text: `  ${f.status}  ${f.path}` })),
          ...(picked.length > 20 ? [{ tone: "dim" as const, text: `  … 외 ${picked.length - 20}개` }] : []),
          ...(opts.exclude?.length ? [{ tone: "ok" as const, text: `비밀 정보로 보이는 파일 ${opts.exclude.length}개는 빼고 저장했어요` }] : []),
          { tone: "dim", text: "아직 온라인에는 안 올라갔어요. 오른쪽 ‘올리기’를 누르면 올라가요." },
        ],
      });
      setMessage("");
      setDescription("");
      await fetchAll(repo.root);
    } catch (e) {
      addBlock({ title: "커밋하기", git: "git commit", lines: [{ tone: "err", text: String(e) }] });
    } finally {
      setCommitting(false);
    }
  };


  /**
   * 저장 지점을 온라인에 올린다. upTo 가 있으면 그 저장 지점까지만.
   * 올라갈 저장 지점 안에 비밀 정보로 보이는 파일이 있으면 먼저 확인한다.
   */
  const push = async (opts: { upTo?: string; force?: boolean } = {}) => {
    if (!repo || pushing || !unpushed.length) return;
    // 올라가는 범위: upTo 와 그보다 오래된 것들 (목록은 최신이 앞)
    const idx = opts.upTo ? unpushed.findIndex((c) => c.hash === opts.upTo) : 0;
    if (idx < 0) return;
    const targets = unpushed.slice(idx);
    const secrets = [...new Set(targets.flatMap((c) => c.files).filter(looksSecret))];
    if (secrets.length && !opts.force) {
      setSecretAsk({ mode: "push", files: secrets, upTo: opts.upTo });
      return;
    }
    setSecretAsk(null);

    const all = idx === 0;
    const target = targets[0];
    const title =
      targets.length === 1
        ? `“${target.subject}” 올리기`
        : all
          ? `모두 올리기 (${targets.length}개)`
          : `“${target.subject}”까지 올리기 (${targets.length}개)`;
    const remoteBranch = repo.upstream ?? `${repo.remotes.includes("origin") ? "origin" : repo.remotes[0]}/${repo.branch}`;
    setPushing(all ? "all" : target.hash);
    try {
      const res = await gitPush(repo.root, all ? undefined : target.hash);
      addBlock({
        title,
        git: res.created
          ? `git push -u ${res.remote} ${res.branch}`
          : `git push ${res.remote} ${all ? "HEAD" : target.short}:${res.branch}`,
        lines: [
          { tone: "ok", text: `저장 지점 ${targets.length}개를 온라인(${res.remote}/${res.branch})에 올렸어요` },
          ...targets.slice(0, 20).map((c) => ({ tone: "dim" as const, text: `  ${c.short}  ${c.subject}` })),
          ...(res.created ? [{ tone: "ok" as const, text: "온라인에 이 갈래를 새로 만들고 연결했어요. 다음부터는 바로 올라가요." }] : []),
          ...(!all && targets.length > 1
            ? [{ tone: "dim" as const, text: "Git 은 순서대로 쌓여서, 그 전 저장 지점도 함께 올라갔어요." }]
            : []),
          ...(unpushed.length - targets.length > 0
            ? [{ tone: "plain" as const, text: `아직 올리지 않은 저장 지점 ${unpushed.length - targets.length}개가 남아 있어요.` }]
            : []),
        ],
      });
      await fetchAll(repo.root);
    } catch (e) {
      addBlock({ title, git: `git push ${remoteBranch}`, lines: [{ tone: "err", text: String(e) }] });
    } finally {
      setPushing(null);
    }
  };

  // 다른 프로그램(AI 코딩 도구 등)에서 파일을 바꾸고 돌아오면 자동으로 다시 읽는다
  useEffect(() => {
    const onFocus = () => {
      if (pathRef.current) fetchAll(pathRef.current).catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // fetchAll 은 ref 만 읽으므로 처음 한 번만 등록해도 된다
  }, []);

  return {
    repo, commits, loading, log, checked, message, setMessage, description, setDescription, committing, secretAsk,
    unpushed, pushing,
    open, refresh, close, toggle, toggleAll, commit, push, cancelSecret: () => setSecretAsk(null),
  };
}

export type RealRepo = ReturnType<typeof useRealRepo>;

function statusBlock(st: RepoStatus, title: string): Omit<Block, "id"> {
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
  return { title, git: "git status", lines };
}

/* ---------- 왼쪽: 바뀐 파일 ---------- */

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
              {looksSecret(f.path) ? <KeyRound size={13} className="shrink-0 text-amber" /> : <FileCode2 size={13} className="shrink-0 text-dim" />}
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

/* ---------- 가운데: 그래프 + 작업 기록 ---------- */

export function RealMain({ r, termH, splitter }: { r: RealRepo; termH: number; splitter: React.ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [r.log]);
  const repo = r.repo!;

  return (
    <>
      <RealGraph root={repo.root} commits={r.commits} fileNames={repo.files.map((f) => f.path)} unpushed={r.unpushed} />
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

/* ---------- 오른쪽: 바뀐 내용 + 커밋 ---------- */

export function RealInspector({ r }: { r: RealRepo }) {
  const [width, setWidth] = useState(380);
  const start = useRef(0);
  const repo = r.repo!;
  const n = r.checked.size;
  const allOn = repo.files.length > 0 && n === repo.files.length;

  return (
    <>
      <Splitter dir="x" onStart={() => (start.current = width)} onDrag={(d) => setWidth(clamp(start.current - d, 300, 760))} />
      <aside className="flex shrink-0 flex-col overflow-y-auto bg-panel" style={{ width }}>
        <div className="sticky top-0 z-10 flex h-8 items-center gap-2 border-b border-line-soft bg-panel px-4 text-[11px] font-medium tracking-wide text-muted">
          바뀐 내용 <GitChip term="changes" />
          {repo.files.length > 0 && (
            <button onClick={r.toggleAll} className="ml-auto flex items-center gap-1.5 font-normal text-muted hover:text-fg">
              <Box on={allOn} partial={!allOn && n > 0} /> 전체 {repo.files.length}
            </button>
          )}
        </div>

        <div className="space-y-4 p-4">
          <Sync repo={repo} />

          {repo.files.length ? (
            <ul className="border border-line-soft">
              {repo.files.map((f) => (
                <FileRow key={f.path} f={f} on={r.checked.has(f.path)} toggle={() => r.toggle(f.path)} />
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-2 text-[12px] text-dim">
              <Check size={14} className="text-green" /> 저장하지 않은 변경이 없어요
            </div>
          )}
        </div>

        {repo.files.length > 0 && (
          <div className="border-t border-line-soft">
            <div className="flex h-8 items-center gap-2 border-b border-line-soft px-4 text-[11px] font-medium tracking-wide text-muted">
              저장 메시지 <GitChip term="commit" />
            </div>
            <div className="space-y-2 p-4">
              <input
                value={r.message}
                onChange={(e) => r.setMessage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && r.commit()}
                placeholder="무엇을 바꿨나요? (예: 로그인 화면 문구 수정)"
                className="w-full rounded-[3px] border border-line bg-base px-2.5 py-2 text-[13px] text-fg outline-none placeholder:text-dim focus:border-teal/60"
              />
              <textarea
                value={r.description}
                onChange={(e) => r.setDescription(e.target.value)}
                rows={2}
                placeholder="자세한 설명 (선택)"
                className="w-full resize-none rounded-[3px] border border-line bg-base px-2.5 py-2 text-[12px] text-fg outline-none placeholder:text-dim focus:border-teal/60"
              />
              <button
                onClick={() => r.commit()}
                disabled={!n || !r.message.trim() || r.committing}
                className="flex w-full items-center justify-center gap-2 rounded-[3px] bg-teal px-3 py-2 text-[13px] font-semibold text-[#0b2626] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
              >
                {r.committing ? (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#0b2626]/30 border-t-[#0b2626]" />
                ) : (
                  <GitCommitHorizontal size={15} />
                )}
                커밋하기 <span className="font-normal opacity-70">· 파일 {n}개</span>
              </button>
              <p className="text-[11px] leading-relaxed text-dim">
                {!n
                  ? "저장할 파일을 하나 이상 체크해 주세요."
                  : !r.message.trim()
                    ? "무엇을 바꿨는지 짧게 적어 주세요. (Ctrl+Enter 로 바로 커밋)"
                    : "체크한 파일만 내 컴퓨터에 저장 지점으로 기록돼요. 온라인에는 아래 ‘올리기’로 올려요."}
              </p>
            </div>
          </div>
        )}

        <PushPanel r={r} />
      </aside>

      {r.secretAsk && <SecretModal r={r} ask={r.secretAsk} />}
    </>
  );
}

function FileRow({ f, on, toggle }: { f: FileChange; on: boolean; toggle: () => void }) {
  const secret = looksSecret(f.path);
  return (
    <li className="border-b border-line-soft last:border-0">
      <button onClick={toggle} className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left hover:bg-hover/50">
        <Box on={on} />
        <span className={`w-3 font-mono text-[12px] ${STATUS_TONE[f.status]}`}>{f.status}</span>
        <span className={`min-w-0 flex-1 truncate font-mono text-[12px] ${on ? "text-fg/90" : "text-dim"}`} title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}>
          {f.path}
        </span>
        {secret && <KeyRound size={11} className="shrink-0 text-amber" />}
        <span className="shrink-0 text-[10px] text-dim">{STATUS_LABEL[f.status]}</span>
      </button>
      {secret && !on && (
        <div className="px-2.5 pb-1.5 pl-[42px] text-[10px] text-amber/80">비밀 정보일 수 있어서 기본으로 뺐어요</div>
      )}
    </li>
  );
}

function SecretModal({ r, ask }: { r: RealRepo; ask: SecretAsk }) {
  const forPush = ask.mode === "push";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
      <div
        className="rise w-[460px] border border-line bg-panel shadow-2xl shadow-black/60"
        style={{ borderTop: `2px solid var(--color-${forPush ? "red" : "amber"})` }}
      >
        <div className="p-5">
          <div className={`flex items-center gap-2 text-[11px] font-medium tracking-wide ${forPush ? "text-red" : "text-amber"}`}>
            <KeyRound size={13} /> {forPush ? "올리기 전 확인" : "저장 전 확인"}
          </div>
          <h3 className="mt-2 text-[16px] font-semibold text-fg">
            {forPush ? "올라갈 저장 지점에 비밀 정보 파일이 들어 있어요" : "비밀 정보가 들어 있을 수 있는 파일이 있어요"}
          </h3>
          <ul className="mt-3 space-y-1 border border-line-soft bg-base px-3 py-2 font-mono text-[12px] text-fg">
            {ask.files.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <p className={`mt-3 text-[12px] leading-relaxed ${forPush ? "text-red/90" : "text-amber/90"}`}>
            {forPush
              ? "온라인에 올리면 저장소를 볼 수 있는 사람 누구나 이 내용을 볼 수 있고, 한 번 올라간 기록은 지워도 남아요. 올렸다면 키를 새로 발급받는 게 안전해요."
              : "API 키나 비밀번호가 담긴 파일을 저장해서 온라인에 올리면 다른 사람이 볼 수 있고, 한 번 올라간 기록은 지워도 남아요."}
          </p>
        </div>
        {forPush ? (
          <div className="flex justify-end gap-2 border-t border-line-soft p-4">
            <button onClick={() => r.push({ upTo: ask.upTo, force: true })} className="px-3 text-[12px] text-dim hover:text-red">
              그래도 올리기
            </button>
            <button
              onClick={r.cancelSecret}
              className="rounded-[3px] bg-teal px-4 py-2 text-[13px] font-semibold text-[#0b2626] hover:brightness-110"
            >
              올리지 않기
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1 border-t border-line-soft p-4">
            <button
              onClick={() => r.commit({ exclude: ask.files })}
              className="rounded-[3px] bg-teal px-3 py-2 text-[13px] font-semibold text-[#0b2626] hover:brightness-110"
            >
              이 파일은 빼고 저장하기 (권장)
            </button>
            <button onClick={() => r.commit({ force: true })} className="py-1.5 text-[12px] text-dim hover:text-muted">
              그래도 포함해서 저장할게요
            </button>
            <button onClick={r.cancelSecret} className="py-1 text-[11px] text-dim hover:text-muted">
              취소
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- 올리기 (push) ---------- */

function PushPanel({ r }: { r: RealRepo }) {
  const repo = r.repo!;
  const list = r.unpushed; // 최신이 앞
  const n = list.length;
  const canPartial = !!repo.upstream; // 처음 올리는 갈래는 한꺼번에만
  const busy = r.pushing != null;

  let note: string | null = null;
  if (!repo.remotes.length) note = "온라인 저장소(GitHub 등)와 연결되어 있지 않아서 올릴 수 없어요.";
  else if (!repo.branch) note = "갈래가 아닌 곳(특정 저장 지점)에 있어서 올릴 수 없어요.";

  return (
    <div className="border-t border-line-soft">
      <div className="flex h-8 items-center gap-2 border-b border-line-soft px-4 text-[11px] font-medium tracking-wide text-muted">
        올리기 <GitChip term="push" />
        <span className="ml-auto text-[11px] font-normal">
          {n ? <span className="text-amber">↑ {n}개 올리기 전</span> : <span className="text-dim">모두 올라감</span>}
        </span>
      </div>
      <div className="space-y-3 p-4">
        {note ? (
          <Row icon={<CloudOff size={13} className="text-dim" />} text={note} />
        ) : n === 0 ? (
          <div className="flex items-center gap-2 text-[12px] text-dim">
            <Cloud size={14} className="text-green" /> 온라인과 같은 상태예요. 올릴 저장 지점이 없어요.
          </div>
        ) : (
          <>
            <ul className="max-h-[260px] overflow-y-auto border border-line-soft">
              {list.map((c, i) => {
                const together = n - 1 - i; // 이 저장 지점보다 오래된, 함께 올라갈 개수
                const secret = c.files.some(looksSecret);
                return (
                  <li key={c.hash} className="flex items-center gap-2.5 border-b border-line-soft px-2.5 py-2 last:border-0">
                    <GitCommitHorizontal size={14} className="shrink-0 text-amber" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] text-fg" title={c.subject}>{c.subject}</div>
                      <div className="truncate font-mono text-[10px] text-dim">
                        {c.short} · 파일 {c.files.length}개
                        {secret && <span className="font-sans text-amber"> · 비밀 파일 포함</span>}
                      </div>
                    </div>
                    {canPartial && (
                      <button
                        onClick={() => r.push({ upTo: c.hash })}
                        disabled={busy}
                        title={together > 0 ? `그 전 저장 지점 ${together}개도 함께 올라가요` : "이 저장 지점만 올려요"}
                        className="flex shrink-0 items-center gap-1 rounded-[3px] border border-line px-2 py-1 text-[11px] text-muted hover:border-teal/50 hover:text-fg disabled:opacity-40"
                      >
                        {r.pushing === c.hash ? <Spin /> : <CloudUpload size={12} />}
                        {together > 0 ? `여기까지 (${together + 1})` : "올리기"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <button
              onClick={() => r.push()}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-[3px] bg-teal px-3 py-2 text-[13px] font-semibold text-[#0b2626] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {r.pushing === "all" ? <Spin dark /> : <CloudUpload size={15} />}
              {canPartial ? "모두 올리기" : "온라인에 처음 올리기"}
              <span className="font-normal opacity-70">· {n}개</span>
            </button>
            <p className="text-[11px] leading-relaxed text-dim">
              {canPartial
                ? n > 1
                  ? "하나씩 올릴 수도 있어요. Git 은 순서대로 쌓여서, 새 저장 지점을 올리면 그 전 것도 함께 올라가요."
                  : "처음 올릴 때 GitHub 로그인 창이 뜰 수 있어요."
                : `온라인에 ‘${repo.branch}’ 갈래를 새로 만들어 올리고 연결해요. 처음에는 GitHub 로그인 창이 뜰 수 있어요.`}
            </p>
          </>
        )}
        {repo.behind > 0 && (
          <p className="text-[11px] leading-relaxed text-amber/90">
            온라인에 아직 받지 않은 저장 지점 {repo.behind}개가 있어요. 올리기 전에 받아와야(pull) 할 수 있어요.
          </p>
        )}
      </div>
    </div>
  );
}

function Spin({ dark }: { dark?: boolean }) {
  return (
    <span
      className={`h-3 w-3 animate-spin rounded-full border-2 ${dark ? "border-[#0b2626]/30 border-t-[#0b2626]" : "border-line border-t-teal"}`}
    />
  );
}

function Box({ on, partial }: { on: boolean; partial?: boolean }) {
  return (
    <span
      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[2px] border ${
        on ? "border-teal bg-teal text-[#0b2626]" : partial ? "border-teal" : "border-dim"
      }`}
    >
      {on ? <Check size={10} strokeWidth={3} /> : partial ? <span className="h-0.5 w-1.5 bg-teal" /> : null}
    </span>
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
