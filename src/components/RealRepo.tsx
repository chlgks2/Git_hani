// 실제 저장소 모드: 사용자가 고른 폴더의 상태·저장 기록을 보여주고, 고른 파일을 커밋한다.
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Cloud, CloudDownload, CloudOff, CloudUpload, FileCode2, FolderGit2, GitBranch, GitCommitHorizontal, GitMerge, KeyRound, LifeBuoy, RefreshCw, RotateCcw, Sparkles, Undo2, X } from "lucide-react";
import {
  gitCommit,
  gitAbortMerge,
  gitConflictFile,
  gitFetch,
  gitFinishMerge,
  gitIncoming,
  gitLog,
  gitPull,
  gitPush,
  gitResolveFile,
  gitResolveWhole,
  gitRestorePreview,
  gitRestoreTo,
  gitStartMerge,
  gitStatus,
  gitUnpushed,
  looksSecret,
  isBackupRef,
  isDesktop,
  pickFolder,
  startupPath,
  timeAgo,
  STATUS_LABEL,
  STATUS_TONE,
  type CommitInfo,
  type CommitWithFiles,
  type RestorePreview,
  type FileChange,
  type RepoStatus,
  type UnpushedCommit,
} from "../git";
import type { Block } from "../store";
import { aiCommitMessage, aiExplainConflict, aiHealth, aiSummarize, collectPatches, type AiState, type Summary } from "../ai";
import type { ResolverBackend } from "./ConflictResolver";
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
  const [incoming, setIncoming] = useState<CommitWithFiles[]>([]);
  const [pulling, setPulling] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lastCheck, setLastCheck] = useState<number | null>(null); // 마지막으로 온라인을 확인한 시각(초)
  const [conflict, setConflict] = useState<string[] | null>(null); // 마지막 받아오기에서 충돌 난 파일
  const [resolving, setResolving] = useState(false); // 충돌 해결 화면을 열었는지
  const [mergeFiles, setMergeFiles] = useState<string[]>([]); // 이번 합치기에서 충돌 난 파일 전체
  const [selected, setSelected] = useState<string | null>(null); // 그래프에서 고른 저장 지점
  const [restoreAsk, setRestoreAsk] = useState<RestorePreview | null>(null); // 되돌리기 확인 창
  const [restoring, setRestoring] = useState(false);
  const [diffFile, setDiffFile] = useState<string | null>(null); // diff 보기로 연 파일
  const [aiState, setAiState] = useState<AiState>("unknown");
  const [summary, setSummary] = useState<Summary | null>(null); // AI 가 설명한 바뀐 내용
  const [summarizing, setSummarizing] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

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
    const [st, list, ahead, behind] = await Promise.all([
      gitStatus(path),
      gitLog(path),
      gitUnpushed(path).catch(() => [] as UnpushedCommit[]),
      gitIncoming(path).catch(() => [] as CommitWithFiles[]),
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
    setIncoming(behind);
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
    setConflict(null);
    setLastCheck(null);
    setSummary(null);
    await load(path, "저장소 열기");
    void quietCheck();
    void checkAi();
  };

  /* ---------- AI ---------- */

  const checkAi = async () => {
    const st = await aiHealth();
    setAiState(st);
    return st;
  };

  /** 바뀐 파일들을 AI 가 쉬운 말로 설명한다 (비밀 정보 파일은 보내지 않음) */
  const explainChanges = async () => {
    if (!repo || summarizing) return;
    setSummarizing(true);
    setAiError(null);
    try {
      const { patches, skipped } = await collectPatches(repo.root, repo.files);
      if (!patches.length) throw new Error("설명할 수 있는 파일이 없어요. (비밀 정보 파일은 AI 에게 보내지 않아요)");
      const res = await aiSummarize(patches);
      setSummary(res);
      setAiState("ok");
      addBlock({
        title: "바뀐 내용 설명",
        git: "git diff",
        lines: [
          { tone: "ai", text: res.overall },
          ...res.files.map((f) => ({ tone: "dim" as const, text: `  ${f.path} — ${f.summary}` })),
          ...(skipped.length ? [{ tone: "dim" as const, text: `  비밀 정보로 보이는 파일 ${skipped.length}개는 AI 에게 보내지 않았어요` }] : []),
          ...(res.truncated ? [{ tone: "dim" as const, text: "  변경이 많아 일부만 보고 설명했어요" }] : []),
        ],
      });
    } catch (e) {
      setAiError(String(e instanceof Error ? e.message : e));
      void checkAi();
    } finally {
      setSummarizing(false);
    }
  };

  /** 체크한 파일로 저장 메시지를 추천받아 칸에 채운다 */
  const suggestMessage = async () => {
    if (!repo || suggesting) return;
    const picked = repo.files.filter((f) => checkedRef.current.has(f.path));
    if (!picked.length) return;
    setSuggesting(true);
    setAiError(null);
    try {
      const { patches } = await collectPatches(repo.root, picked);
      if (!patches.length) throw new Error("체크한 파일이 모두 비밀 정보 파일이라 AI 에게 보내지 않았어요.");
      // 이 저장소의 최근 저장 메시지로 말투를 맞춘다 (합치기·되돌리기 메시지는 빼고)
      const recent = commits
        .map((c) => c.subject)
        .filter((s) => !/^(Merge |되돌리기:)/.test(s))
        .slice(0, 10);
      const res = await aiCommitMessage(patches, recent);
      setMessage(res.title);
      setDescription(res.body);
      setAiState("ok");
    } catch (e) {
      setAiError(String(e instanceof Error ? e.message : e));
      void checkAi();
    } finally {
      setSuggesting(false);
    }
  };

  /**
   * 온라인에 새 저장 지점이 있는지 조용히 확인한다 (로그인 창 없이).
   * 저장소를 열 때와 창으로 돌아올 때 부른다. 너무 자주 묻지 않게 30초 간격을 둔다.
   */
  const lastQuiet = useRef(0);
  const quietCheck = async () => {
    const path = pathRef.current;
    if (!path || Date.now() - lastQuiet.current < 30_000) return;
    lastQuiet.current = Date.now();
    try {
      await gitFetch(path, false);
      setLastCheck(Date.now() / 1000);
      await fetchAll(path);
    } catch {
      // 로그인이 필요하거나 오프라인이면 조용히 넘어간다. 사용자가 직접 확인하면 그때 안내한다
    }
  };

  /** 사용자가 직접 누른 확인: 필요하면 로그인 창을 띄우고, 결과를 작업 기록에 남긴다 */
  const checkNow = async () => {
    if (!repo || checking) return;
    setChecking(true);
    try {
      await gitFetch(repo.root, true);
      setLastCheck(Date.now() / 1000);
      const st = await fetchAll(repo.root);
      const n = await gitIncoming(st.root).then((l) => l.length).catch(() => 0);
      addBlock({
        title: "온라인 확인",
        git: "git fetch",
        lines: [n ? { tone: "warn", text: `온라인에 아직 받지 않은 저장 지점 ${n}개가 있어요` } : { tone: "ok", text: "온라인에 새 저장 지점이 없어요" }],
      });
    } catch (e) {
      addBlock({ title: "온라인 확인", git: "git fetch", lines: [{ tone: "err", text: String(e) }] });
    } finally {
      setChecking(false);
    }
  };

  /** 온라인의 최신 내용을 받아온다. 충돌이 나면 Rust 쪽에서 자동으로 취소하고 원래대로 되돌린다 */
  const pull = async () => {
    if (!repo || pulling) return;
    setPulling(true);
    setConflict(null);
    const upstream = repo.upstream ?? "";
    try {
      const res = await gitPull(repo.root);
      setLastCheck(Date.now() / 1000);
      const lines: Block["lines"] = [];
      if (res.kind === "upToDate") lines.push({ tone: "ok", text: "이미 최신이에요. 받아올 저장 지점이 없어요" });
      if (res.kind === "fastForward") lines.push({ tone: "ok", text: `온라인(${upstream})의 저장 지점 ${res.count}개를 받아왔어요` });
      if (res.kind === "merged") {
        lines.push({ tone: "ok", text: `온라인의 저장 지점 ${res.count}개를 받아와 내 저장 지점과 합쳤어요` });
        lines.push({ tone: "dim", text: "합친 결과는 아직 온라인에 없어요. ‘올리기’로 올려 주세요" });
      }
      if (res.kind === "conflict") {
        setConflict(res.conflicts);
        lines.push({ tone: "warn", text: "같은 부분을 서로 다르게 고쳐서 자동으로 합칠 수 없었어요" });
        lines.push({ tone: "ok", text: "받아오기를 취소하고 원래 상태로 되돌려 놨어요. 내 파일은 그대로예요" });
        for (const f of res.conflicts) lines.push({ tone: "dim", text: `  충돌  ${f}` });
      }
      addBlock({
        title: res.kind === "conflict" ? "받아오기 (취소됨)" : "받아오기",
        git: res.kind === "fastForward" ? "git pull --ff-only" : "git pull",
        lines,
      });
      await fetchAll(repo.root);
    } catch (e) {
      addBlock({ title: "받아오기", git: "git pull", lines: [{ tone: "err", text: String(e) }] });
    } finally {
      setPulling(false);
    }
  };
  const refresh = () => pathRef.current && load(pathRef.current, "지금 상태 확인");
  const close = () => {
    pathRef.current = null;
    seen.current = new Set();
    setRepo(null);
    setCommits([]);
    setUnpushed([]);
    setIncoming([]);
    setConflict(null);
    setResolving(false);
    setMergeFiles([]);
    setSelected(null);
    setRestoreAsk(null);
    setDiffFile(null);
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
      setSummary(null);
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

  /* ---------- 충돌 해결 ---------- */

  /** 화면만 조용히 다시 읽는다 (작업 기록을 남기지 않음) */
  const reload = async () => {
    if (pathRef.current) await fetchAll(pathRef.current).catch(() => {});
  };

  /** 충돌 해결 화면 열기: 이미 합치는 중이면 이어서, 아니면 합치기를 다시 시작한다 */
  const openResolver = async () => {
    if (!repo) return;
    if (repo.merging) {
      const left = repo.files.filter((f) => f.status === "U").map((f) => f.path);
      setMergeFiles((prev) => (prev.length ? prev : left));
      setResolving(true);
      return;
    }
    try {
      const files = await gitStartMerge(repo.root);
      if (!files.length) {
        addBlock({ title: "합치기", git: "git merge", lines: [{ tone: "ok", text: "충돌 없이 합쳐졌어요" }] });
        setConflict(null);
        await reload();
        return;
      }
      setMergeFiles(files);
      setConflict(null);
      addBlock({
        title: "충돌 해결 시작",
        git: `git merge ${repo.upstream ?? ""}`,
        lines: [
          { tone: "warn", text: `충돌 파일 ${files.length}개 — 화면에서 어떤 내용을 남길지 골라 주세요` },
          ...files.map((f) => ({ tone: "dim" as const, text: `  충돌  ${f}` })),
        ],
      });
      await reload();
      setResolving(true);
    } catch (e) {
      addBlock({ title: "충돌 해결 시작", git: "git merge", lines: [{ tone: "err", text: String(e) }] });
    }
  };

  const noteResolved = (file: string, what: string) =>
    addBlock({ title: "충돌 해결", git: `git add ${file}`, lines: [{ tone: "ok", text: `${file} — ${what}` }] });

  const finishMerge = async () => {
    if (!repo) return;
    try {
      const res = await gitFinishMerge(repo.root);
      addBlock({
        title: "합치기 완료",
        git: "git commit --no-edit",
        lines: [
          { tone: "ok", text: `충돌을 모두 해결하고 합친 저장 지점을 만들었어요 · ${res.short}` },
          { tone: "dim", text: "합친 결과는 아직 온라인에 없어요. ‘올리기’로 올려 주세요" },
        ],
      });
      setResolving(false);
      setMergeFiles([]);
      await reload();
    } catch (e) {
      addBlock({ title: "합치기 완료", git: "git commit", lines: [{ tone: "err", text: String(e) }] });
    }
  };

  const abortMerge = async () => {
    if (!repo) return;
    try {
      await gitAbortMerge(repo.root);
      addBlock({
        title: "합치기 취소",
        git: "git merge --abort",
        lines: [{ tone: "ok", text: "합치기를 취소하고 받아오기 전 상태로 되돌렸어요. 내 파일은 그대로예요" }],
      });
      setResolving(false);
      setMergeFiles([]);
      await reload();
    } catch (e) {
      addBlock({ title: "합치기 취소", git: "git merge --abort", lines: [{ tone: "err", text: String(e) }] });
    }
  };

  /* ---------- 되돌리기 ---------- */

  /** 지금 마지막 저장 지점 */
  const headHash = commits.find((c) => c.refs.some((ref) => ref === "HEAD" || ref.startsWith("HEAD -> ")))?.hash ?? null;

  /** 되돌리기 확인 창 열기: 무엇이 바뀌는지 먼저 계산해서 보여준다 */
  const askRestore = async (target: string) => {
    if (!repo) return;
    try {
      setRestoreAsk(await gitRestorePreview(repo.root, target));
    } catch (e) {
      addBlock({ title: "되돌리기", git: "git restore", lines: [{ tone: "err", text: String(e) }] });
    }
  };

  /** 툴바의 되돌리기 버튼: 고른 저장 지점이 있으면 그쪽으로, 없으면 저장 안 한 변경 취소 */
  const restoreShortcut = () => {
    if (selected) return askRestore(selected);
    if (repo?.files.length && headHash) return askRestore(headHash);
    addBlock({
      title: "되돌리기",
      lines: [{ tone: "plain", text: "그래프에서 돌아가고 싶은 저장 지점을 눌러 고른 뒤 다시 눌러 주세요." }],
    });
  };

  const doRestore = async () => {
    if (!repo || !restoreAsk || restoring) return;
    const t = restoreAsk.target;
    setRestoring(true);
    try {
      const res = await gitRestoreTo(repo.root, t.hash);
      const lines: Block["lines"] = [];
      if (res.backup) lines.push({ tone: "ok", text: "저장 안 한 변경과 새 파일은 ‘되돌리기 전 백업’으로 보관했어요" });
      if (res.uncommitted) lines.push({ tone: "ok", text: "백업을 되살렸어요. 저장 안 한 변경으로 돌아왔으니 확인한 뒤 커밋하세요" });
      else if (restoreAsk.isHead) lines.push({ tone: "ok", text: "저장 안 한 변경을 취소하고 마지막 저장 상태로 돌아왔어요" });
      else lines.push({ tone: "ok", text: `“${t.subject}” (${t.short}) 상태로 돌아왔어요` });
      if (res.commit) lines.push({ tone: "dim", text: `되돌린 상태를 새 저장 지점으로 기록했어요 · ${res.commit.short} (기록은 지워지지 않아요)` });
      if (res.backup) lines.push({ tone: "dim", text: "그래프의 ‘되돌리기 전 백업’을 고르면 언제든 다시 되살릴 수 있어요" });
      addBlock({
        title: res.uncommitted ? "백업 되살리기" : restoreAsk.isHead ? "변경 모두 취소" : "되돌리기",
        git: `git restore --source=${t.short} .${res.commit ? " && git commit" : ""}`,
        lines,
      });
      setRestoreAsk(null);
      setSelected(null);
      setSummary(null);
      await reload();
    } catch (e) {
      addBlock({ title: "되돌리기", git: "git restore", lines: [{ tone: "err", text: String(e) }] });
    } finally {
      setRestoring(false);
    }
  };

  // 실행할 때 폴더를 함께 줬으면 그 폴더를 바로 연다
  useEffect(() => {
    if (!isDesktop()) return;
    startupPath()
      .then(async (path) => {
        if (!path) return;
        await load(path, "저장소 열기");
        await quietCheck();
        await checkAi();
      })
      .catch(() => {});
  }, []);

  // 다른 프로그램(AI 코딩 도구 등)에서 파일을 바꾸고 돌아오면 자동으로 다시 읽는다
  useEffect(() => {
    const onFocus = () => {
      if (!pathRef.current) return;
      fetchAll(pathRef.current).catch(() => {});
      void quietCheck();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // fetchAll 은 ref 만 읽으므로 처음 한 번만 등록해도 된다
  }, []);

  return {
    repo, commits, loading, log, checked, message, setMessage, description, setDescription, committing, secretAsk,
    unpushed, pushing, incoming, pulling, checking, lastCheck, conflict,
    open, refresh, close, toggle, toggleAll, commit, push, pull, checkNow,
    cancelSecret: () => setSecretAsk(null),
    dismissConflict: () => setConflict(null),
    resolving, mergeFiles, reload, openResolver, closeResolver: () => setResolving(false), noteResolved, finishMerge, abortMerge,
    selected, setSelected, headHash, restoreAsk, restoring, askRestore, restoreShortcut, doRestore,
    cancelRestore: () => setRestoreAsk(null),
    diffFile, openDiff: (file: string) => setDiffFile(file), closeDiff: () => setDiffFile(null),
    aiState, summary, summarizing, suggesting, aiError, explainChanges, suggestMessage, checkAi,
  };
}

export type RealRepo = ReturnType<typeof useRealRepo>;

/** 충돌 해결 화면을 실제 git 명령으로 움직이게 연결한다 */
export function realResolverBackend(r: RealRepo): ResolverBackend {
  const repo = r.repo!;
  return {
    oursLabel: repo.branch ?? "내 갈래",
    theirsLabel: repo.upstream ?? "온라인",
    all: r.mergeFiles,
    // 남은 충돌 파일은 항상 git 상태(U)에서 읽는다 — 해결하면 목록에서 빠진다
    remaining: repo.files.filter((f) => f.status === "U").map((f) => f.path),
    load: (file) => gitConflictFile(repo.root, file),
    saveFile: async (file, content, note) => {
      await gitResolveFile(repo.root, file, content);
      r.noteResolved(file, note);
      await r.reload();
    },
    chooseWhole: async (file, side, note) => {
      await gitResolveWhole(repo.root, file, side);
      r.noteResolved(file, note);
      await r.reload();
    },
    explain: aiExplainConflict,
    abort: r.abortMerge,
    finish: r.finishMerge,
    close: r.closeResolver,
  };
}

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
            <div
              key={f.path}
              onClick={() => r.openDiff(f.path)}
              className="flex h-[26px] cursor-pointer items-center gap-1.5 pr-2 pl-6 hover:bg-hover"
              title={`${f.path} — 눌러서 바뀐 줄 보기`}
            >
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
      <RealGraph
        root={repo.root}
        commits={r.commits}
        fileNames={repo.files.map((f) => f.path)}
        unpushed={r.unpushed}
        incoming={r.incoming}
        selected={r.selected}
        onSelect={r.setSelected}
      />
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
          {repo.merging && (
            <div className="space-y-2 border border-amber/40 bg-amber/5 p-3 text-[12px] leading-relaxed">
              <div className="flex items-center gap-1.5 font-medium text-amber">
                <GitMerge size={13} /> 합치는 중이에요
              </div>
              <p className="text-muted">
                충돌 {repo.files.filter((f) => f.status === "U").length}개가 남아 있어요. 해결을 마치거나 취소해야 다른 작업을 할 수 있어요.
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={r.openResolver}
                  className="rounded-[3px] bg-amber px-3 py-1.5 text-[12px] font-semibold text-[#2a1a00] hover:brightness-110"
                >
                  이어서 해결하기
                </button>
                <button onClick={r.abortMerge} className="text-[11px] text-dim hover:text-red">
                  합치기 취소
                </button>
              </div>
            </div>
          )}
          {r.selected && <SelectedCommit r={r} />}

          <Sync repo={repo} />

          {repo.files.length ? (
            <ul className="border border-line-soft">
              {repo.files.map((f) => (
                <FileRow
                  key={f.path}
                  f={f}
                  on={r.checked.has(f.path)}
                  toggle={() => r.toggle(f.path)}
                  view={() => r.openDiff(f.path)}
                  explain={r.summary?.files.find((s) => s.path === f.path)?.summary}
                />
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-2 text-[12px] text-dim">
              <Check size={14} className="text-green" /> 저장하지 않은 변경이 없어요
            </div>
          )}
        </div>

        {repo.files.length > 0 && (
          <div className="-mt-2 space-y-2 px-4 pb-3">
            {r.summary && (
              <div className="rise border-l-2 border-[#b9a6f5]/60 pl-2.5 text-[12px] leading-relaxed text-fg/90">
                <Sparkles size={11} className="mr-1 inline text-[#b9a6f5]" />
                {r.summary.overall}
                {r.summary.truncated && <span className="text-dim"> (변경이 많아 일부만 보고 설명했어요)</span>}
              </div>
            )}
            <button
              onClick={r.explainChanges}
              disabled={r.summarizing}
              className="flex w-full items-center justify-center gap-1.5 rounded-[3px] border border-[#b9a6f5]/30 py-1.5 text-[12px] text-[#b9a6f5] hover:bg-[#b9a6f5]/10 disabled:opacity-60"
            >
              {r.summarizing ? <Spin /> : <Sparkles size={13} />}
              {r.summarizing ? "AI 가 읽고 있어요…" : r.summary ? "다시 설명 듣기" : "무엇이 바뀌었는지 쉬운 말로 설명 듣기"}
            </button>
            <AiNotice r={r} />
          </div>
        )}

        {repo.files.length > 0 && !repo.merging && r.headHash && (
          <div className="-mt-1 px-4 pb-3">
            <button
              onClick={() => r.askRestore(r.headHash!)}
              className="flex items-center gap-1.5 text-[11px] text-dim hover:text-red"
              title="AI 가 망쳐 놨을 때처럼, 마지막 저장 이후의 변경을 모두 버려요 (백업은 남겨요)"
            >
              <Undo2 size={11} /> 변경 모두 취소 (마지막 저장 상태로)
            </button>
          </div>
        )}

        {repo.files.length > 0 && !repo.merging && (
          <div className="border-t border-line-soft">
            <div className="flex h-8 items-center gap-2 border-b border-line-soft px-4 text-[11px] font-medium tracking-wide text-muted">
              저장 메시지 <GitChip term="commit" />
            </div>
            <div className="space-y-2 p-4">
              <div className="relative">
                <input
                  value={r.message}
                  onChange={(e) => r.setMessage(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && r.commit()}
                  placeholder="무엇을 바꿨나요? (예: 로그인 화면 문구 수정)"
                  className="w-full rounded-[3px] border border-line bg-base py-2 pr-20 pl-2.5 text-[13px] text-fg outline-none placeholder:text-dim focus:border-teal/60"
                />
                <button
                  onClick={r.suggestMessage}
                  disabled={!n || r.suggesting}
                  title="체크한 파일의 변경을 보고 저장 메시지를 추천해요"
                  className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-1 rounded-[3px] px-1.5 py-1 text-[11px] text-[#b9a6f5] hover:bg-[#b9a6f5]/10 disabled:opacity-40"
                >
                  {r.suggesting ? <Spin /> : <Sparkles size={11} />} AI 추천
                </button>
              </div>
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

        <PullPanel r={r} />
        <PushPanel r={r} />
      </aside>

      {r.secretAsk && <SecretModal r={r} ask={r.secretAsk} />}
      {r.restoreAsk && <RestoreModal r={r} pv={r.restoreAsk} />}
    </>
  );
}

function FileRow({
  f,
  on,
  toggle,
  view,
  explain,
}: {
  f: FileChange;
  on: boolean;
  toggle: () => void;
  view: () => void;
  explain?: string;
}) {
  const secret = looksSecret(f.path);
  return (
    <li className="border-b border-line-soft last:border-0">
      <div className="flex w-full items-center gap-2.5 px-2.5 py-1.5 hover:bg-hover/50">
        <button onClick={toggle} title={on ? "이번 저장에서 빼기" : "이번 저장에 넣기"}>
          <Box on={on} />
        </button>
        <span className={`w-3 font-mono text-[12px] ${STATUS_TONE[f.status]}`} title={STATUS_LABEL[f.status]}>
          {f.status}
        </span>
        <button
          onClick={view}
          className={`min-w-0 flex-1 truncate text-left font-mono text-[12px] hover:underline ${on ? "text-fg/90" : "text-dim"}`}
          title={`${f.origPath ? `${f.origPath} → ` : ""}${f.path} — 눌러서 바뀐 줄 보기`}
        >
          {f.path}
        </button>
        {secret && <KeyRound size={11} className="shrink-0 text-amber" />}
        <button onClick={view} className="shrink-0 font-mono text-[10px] text-dim hover:text-teal">
          diff
        </button>
      </div>
      {explain && (
        <div className="rise px-2.5 pb-1.5 pl-[42px] text-[12px] leading-snug text-muted">
          <Sparkles size={10} className="mr-1 inline text-[#b9a6f5]" />
          {explain}
        </div>
      )}
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

/* ---------- AI 상태 안내 ---------- */

function AiNotice({ r }: { r: RealRepo }) {
  if (r.aiError) return <p className="text-[11px] leading-relaxed whitespace-pre-line text-red/90">{r.aiError}</p>;
  if (r.aiState === "offline")
    return (
      <p className="text-[11px] leading-relaxed text-dim">
        AI 서버가 꺼져 있어요. <span className="font-mono">server</span> 폴더에서 <span className="font-mono">npm run start:dev</span> 로 켜 주세요.
      </p>
    );
  if (r.aiState === "nokey")
    return (
      <p className="text-[11px] leading-relaxed text-dim">
        AI 서버에 API 키가 없어요. <span className="font-mono">server/.env</span> 에 <span className="font-mono">ANTHROPIC_API_KEY</span> 를 넣어 주세요.
      </p>
    );
  return null;
}

/* ---------- 되돌리기 ---------- */

/** 그래프에서 고른 저장 지점 */
function SelectedCommit({ r }: { r: RealRepo }) {
  const c = r.commits.find((x) => x.hash === r.selected);
  if (!c) return null;
  const isHead = c.hash === r.headHash;
  const backup = c.refs.some((ref) => isBackupRef(ref.replace(/^refs\/heads\//, "")));
  const dirty = r.repo!.files.length > 0;
  const canRestore = !r.repo!.merging && (!isHead || dirty);
  return (
    <div className="rise border border-teal/40 bg-teal/5 p-3">
      <div className="flex items-center gap-2 font-mono text-[10px] text-dim">
        <span>{c.short}</span>
        <span className="font-sans">{c.author}</span>
        <span className="font-sans">{timeAgo(c.time)}</span>
        <button onClick={() => r.setSelected(null)} className="ml-auto text-dim hover:text-fg" title="선택 해제">
          <X size={12} />
        </button>
      </div>
      <div className="mt-1 text-[13px] font-medium text-fg">{backup ? "되돌리기 전 백업" : c.subject}</div>
      {backup && <div className="mt-0.5 text-[11px] text-amber">되돌리기 직전에 보관해 둔 상태예요. 이 상태로 되살릴 수 있어요.</div>}
      {isHead && <div className="mt-0.5 text-[11px] text-muted">지금 마지막 저장 지점이에요.</div>}
      <button
        onClick={() => r.askRestore(c.hash)}
        disabled={!canRestore}
        className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-[3px] border border-teal/60 py-1.5 text-[12px] font-medium text-teal hover:bg-teal/10 disabled:cursor-not-allowed disabled:opacity-30"
        title={isHead && !dirty ? "지금 상태와 같아서 되돌릴 게 없어요" : undefined}
      >
        <RotateCcw size={12} /> {backup ? "백업 되살리기" : isHead ? "저장 안 한 변경 취소" : "이 상태로 되돌리기"}
      </button>
    </div>
  );
}

const KIND_LABEL: Record<string, { text: string; tone: string }> = {
  modify: { text: "내용 바뀜", tone: "text-amber" },
  restore: { text: "되살아남", tone: "text-green" },
  delete: { text: "지워짐", tone: "text-red" },
  clean: { text: "새 파일 정리", tone: "text-dim" },
};

function RestoreModal({ r, pv }: { r: RealRepo; pv: RestorePreview }) {
  const t = pv.target;
  const backup = t.refs.some((ref) => isBackupRef(ref.replace(/^refs\/heads\//, "")));
  const title = pv.isHead
    ? "저장 안 한 변경을 모두 취소할까요?"
    : backup
      ? "되돌리기 전 백업을 되살릴까요?"
      : `“${t.subject}” 상태로 되돌릴까요?`;
  const shown = pv.changes.slice(0, 12);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
      <div className="rise w-[500px] border border-line bg-panel shadow-2xl shadow-black/60" style={{ borderTop: "2px solid var(--color-teal)" }}>
        <div className="p-5">
          <div className="flex items-center gap-2 text-[11px] font-medium tracking-wide text-teal">
            <RotateCcw size={13} /> {pv.isHead ? "변경 모두 취소" : "되돌리기"}
          </div>
          <h3 className="mt-2 text-[16px] leading-snug font-semibold text-fg">{title}</h3>
          {!pv.isHead && (
            <p className="mt-1 font-mono text-[11px] text-dim">
              {t.short} · {t.author} · {timeAgo(t.time)}
            </p>
          )}

          {pv.changes.length === 0 ? (
            <p className="mt-4 text-[13px] text-muted">이미 이 상태와 같아요. 바뀌는 파일이 없어요.</p>
          ) : (
            <>
              <div className="mt-4 mb-1.5 text-[11px] text-muted">이렇게 바뀌어요 · 파일 {pv.changes.length}개</div>
              <ul className="max-h-56 overflow-y-auto border border-line-soft bg-base">
                {shown.map((c) => (
                  <li key={c.kind + c.path} className="flex items-center gap-2 border-b border-line-soft px-3 py-1.5 text-[12px] last:border-0">
                    <span className="min-w-0 flex-1 truncate font-mono text-fg/90">{c.path}</span>
                    <span className={`shrink-0 text-[11px] ${KIND_LABEL[c.kind].tone}`}>{KIND_LABEL[c.kind].text}</span>
                  </li>
                ))}
                {pv.changes.length > shown.length && (
                  <li className="px-3 py-1.5 text-[11px] text-dim">… 외 {pv.changes.length - shown.length}개</li>
                )}
              </ul>
            </>
          )}

          <div className="mt-4 space-y-2 text-[12px] leading-relaxed">
            {pv.dirty && (
              <div className="flex items-start gap-2 border-l-2 border-green/60 pl-3 text-muted">
                <LifeBuoy size={14} className="mt-0.5 shrink-0 text-green" />
                <span>
                  <span className="text-fg">저장 안 한 변경과 새 파일은 지워지지 않아요.</span> ‘되돌리기 전 백업’으로 따로 보관하고,
                  그래프에서 골라 언제든 되살릴 수 있어요. (.env 처럼 .gitignore 에 있는 파일은 건드리지 않아요)
                </span>
              </div>
            )}
            {backup && (
              <div className="flex items-start gap-2 border-l-2 border-line pl-3 text-dim">
                <LifeBuoy size={14} className="mt-0.5 shrink-0" />
                <span>되살린 내용은 저장 지점이 아니라 ‘저장 안 한 변경’으로 돌아와요. 확인한 뒤 필요한 것만 골라 커밋하면 돼요.</span>
              </div>
            )}
            {!pv.isHead && !backup && (
              <div className="flex items-start gap-2 border-l-2 border-line pl-3 text-dim">
                <GitCommitHorizontal size={14} className="mt-0.5 shrink-0" />
                <span>지금까지의 기록은 지워지지 않아요. 되돌린 상태가 새 저장 지점으로 하나 더 쌓여서, 온라인에 올린 기록도 안전하게 되돌릴 수 있어요.</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line-soft p-4">
          <button onClick={r.cancelRestore} className="px-4 text-[12px] text-dim hover:text-muted">
            취소
          </button>
          <button
            onClick={r.doRestore}
            disabled={r.restoring || pv.changes.length === 0}
            className="flex items-center gap-1.5 rounded-[3px] bg-teal px-4 py-2 text-[13px] font-semibold text-[#0b2626] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {r.restoring ? <Spin dark /> : <RotateCcw size={14} />}
            {pv.isHead ? "변경 취소" : backup ? "되살리기" : "되돌리기"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- 받아오기 (pull) ---------- */

function PullPanel({ r }: { r: RealRepo }) {
  const repo = r.repo!;
  const list = r.incoming; // 최신이 앞
  const n = list.length;

  let note: string | null = null;
  if (!repo.remotes.length) note = "온라인 저장소(GitHub 등)와 연결되어 있지 않아요.";
  else if (!repo.upstream) note = "이 갈래는 아직 온라인 갈래와 연결되지 않았어요. 처음 올리면 연결돼요.";

  return (
    <div className="border-t border-line-soft">
      <div className="flex h-8 items-center gap-2 border-b border-line-soft px-4 text-[11px] font-medium tracking-wide text-muted">
        받아오기 <GitChip term="pull" />
        <span className="ml-auto text-[11px] font-normal">
          {n ? <span className="text-blue">↓ {n}개 새로 있음</span> : <span className="text-dim">최신</span>}
        </span>
      </div>
      <div className="space-y-3 p-4">
        {r.conflict && (
          <div className="rise space-y-2 border border-amber/40 bg-amber/5 p-3 text-[12px] leading-relaxed">
            <div className="flex items-center gap-1.5 font-medium text-amber">
              <GitMerge size={13} /> 자동으로 합칠 수 없었어요
            </div>
            <p className="text-muted">
              나와 온라인이 같은 부분을 서로 다르게 고쳤어요. <span className="text-fg">받아오기를 취소하고 원래 상태로 되돌려 놨어요.</span>{" "}
              내 파일은 그대로예요.
            </p>
            <ul className="font-mono text-[11px] text-fg">
              {r.conflict.map((f) => (
                <li key={f}>· {f}</li>
              ))}
            </ul>
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={r.openResolver}
                className="rounded-[3px] bg-amber px-3 py-1.5 text-[12px] font-semibold text-[#2a1a00] hover:brightness-110"
              >
                충돌 해결하기
              </button>
              <button onClick={r.dismissConflict} className="text-[11px] text-dim hover:text-muted">
                나중에
              </button>
            </div>
            <p className="text-[11px] text-dim">두 내용 중 무엇을 남길지 화면에서 골라 합칠 수 있어요.</p>
          </div>
        )}

        {note ? (
          <Row icon={<CloudOff size={13} className="text-dim" />} text={note} />
        ) : (
          <>
            {n > 0 ? (
              <ul className="max-h-[220px] overflow-y-auto border border-line-soft">
                {list.map((c) => (
                  <li key={c.hash} className="flex items-center gap-2.5 border-b border-line-soft px-2.5 py-2 last:border-0">
                    <ArrowDown size={13} className="shrink-0 text-blue" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] text-fg" title={c.subject}>{c.subject}</div>
                      <div className="truncate text-[10px] text-dim">
                        {c.author} · {timeAgo(c.time)} · 파일 {c.files.length}개
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-center gap-2 text-[12px] text-dim">
                <Cloud size={14} className="text-green" /> 온라인에 새 저장 지점이 없어요
              </div>
            )}

            {n > 0 && (
              <button
                onClick={r.pull}
                disabled={r.pulling}
                className="flex w-full items-center justify-center gap-2 rounded-[3px] bg-blue px-3 py-2 text-[13px] font-semibold text-[#081a33] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
              >
                {r.pulling ? <Spin dark /> : <CloudDownload size={15} />}
                받아오기 <span className="font-normal opacity-70">· {n}개</span>
              </button>
            )}
            {n > 0 && repo.files.length > 0 && (
              <p className="text-[11px] leading-relaxed text-dim">
                저장하지 않은 변경이 있어요. 온라인에서도 같은 파일을 바꿨다면 받아오기가 멈추니, 먼저 커밋하는 게 좋아요.
              </p>
            )}

            <div className="flex items-center gap-2 text-[11px] text-dim">
              <button
                onClick={r.checkNow}
                disabled={r.checking}
                className="flex items-center gap-1 rounded-[3px] border border-line px-2 py-0.5 text-muted hover:border-teal/50 hover:text-fg disabled:opacity-40"
              >
                <RefreshCw size={10} className={r.checking ? "animate-spin" : ""} /> 지금 온라인 확인
              </button>
              {r.lastCheck ? `마지막 확인 ${timeAgo(r.lastCheck)}` : "아직 확인하지 않았어요"}
            </div>
          </>
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
        {r.incoming.length > 0 && n > 0 && (
          <p className="text-[11px] leading-relaxed text-amber/90">
            온라인에 아직 받지 않은 저장 지점 {r.incoming.length}개가 있어요. 위의 ‘받아오기’를 먼저 하면 올리기가 거절되지 않아요.
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
