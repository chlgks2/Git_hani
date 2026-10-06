// 시나리오 진행 상태와 액션. 버튼과 터미널 입력이 같은 액션을 호출한다.
import { useRef, useState } from "react";
import {
  BASE_COMMITS,
  BROKEN,
  CHANGED_FILES,
  DEMO_CONFLICT_FILE,
  DEMO_TEAMMATE,
  NEW_HASHES,
  suggestMessage,
  type Commit,
} from "./data";

export type Phase = "save" | "restore" | "conflict" | "done";
/** 과제 3: incoming 팀원 저장 지점 도착 / failed 받아오기 충돌 / resolving 해결 화면 / merging 해결 중(화면 닫음) / merged 완료 */
export type ConflictStep = "incoming" | "failed" | "resolving" | "merging" | "merged";
export type RestoreStep = "broken" | "pick" | "confirm" | "restoring" | "restored";

export type Safety = null | { kind: "commit" } | { kind: "push"; upToId: string; secret: Commit };

export type LineTone = "plain" | "ok" | "warn" | "err" | "dim" | "ai";
export interface Line {
  tone: LineTone;
  text: string;
}
export interface Block {
  id: number;
  title: string; // 사용자에게 보이는 말
  git?: string; // 실제로 실행되는 Git 명령 (흐리게 표시)
  typed?: boolean; // 사용자가 직접 입력한 것인지
  lines: Line[];
  running?: boolean;
}
export interface Session {
  id: number;
  title: string;
  blocks: Block[];
}

const ALL_PATHS = CHANGED_FILES.map((f) => f.path);
const BASE = BASE_COMMITS.map((c) => ({ ...c, pushed: true }));
const WHEN = ["오늘 14:15", "오늘 14:18", "오늘 14:21", "오늘 14:24", "오늘 14:27", "오늘 14:30", "오늘 14:33"];

let blockSeq = 1;
let sessionSeq = 1;

function welcomeSession(): Session {
  return {
    id: sessionSeq++,
    title: "작업 터미널",
    blocks: [
      {
        id: blockSeq++,
        title: "지금 상태 확인",
        git: "git status",
        lines: [
          { tone: "plain", text: "main 에서 작업 중 · 마지막 저장: 어제 18:40 “영업시간 안내 수정”" },
          { tone: "warn", text: `아직 저장하지 않은 변경 ${CHANGED_FILES.length}개` },
          ...CHANGED_FILES.map((f) => ({ tone: "dim" as const, text: `  ${f.status}  ${f.path}` })),
        ],
      },
    ],
  };
}

function emptySession(): Session {
  const n = sessionSeq++;
  return {
    id: n,
    title: `새 세션 ${n}`,
    blocks: [
      {
        id: blockSeq++,
        title: "새 터미널",
        lines: [{ tone: "dim", text: "명령어를 몰라도 돼요. 하고 싶은 일을 말로 적어보세요. (도움말: '도움')" }],
      },
    ],
  };
}

export function useScenario() {
  const [phase, setPhase] = useState<Phase>("save");

  // 과제 1: 커밋 / 푸시
  const [pending, setPending] = useState<string[]>(ALL_PATHS); // 아직 저장 안 된 파일
  const [checked, setChecked] = useState<string[]>(ALL_PATHS); // 이번 커밋에 넣을 파일
  const [analyzed, setAnalyzed] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState("");
  const [description, setDescription] = useState("");
  const [local, setLocal] = useState<Commit[]>([]); // 새로 만든 저장 지점 (최신이 앞)
  const [envIgnored, setEnvIgnored] = useState(false);
  const [envChoice, setEnvChoice] = useState<"excluded" | "included" | null>(null);
  const [safety, setSafety] = useState<Safety>(null);
  const [pushing, setPushing] = useState<string | null>(null);

  // 과제 2: 되돌리기
  const [restoreStep, setRestoreStep] = useState<RestoreStep>("broken");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [restoredTo, setRestoredTo] = useState<string | null>(null);
  const [backupParent, setBackupParent] = useState<string | null>(null);

  // 터미널 세션
  const [sessions, setSessions] = useState<Session[]>(() => [welcomeSession()]);
  const [activeId, setActiveId] = useState(() => sessions[0].id);
  const [splitId, setSplitId] = useState<number | null>(null);

  const timers = useRef({ t1Start: Date.now(), firstCommit: 0, firstPush: 0, t2Start: 0, t2End: 0, t3Start: 0, t3End: 0 });

  // 과제 3: 팀원과 충돌
  const [conflictStep, setConflictStep] = useState<ConflictStep>("incoming");
  const [demoResolved, setDemoResolved] = useState<string | null>(null); // 저장한 결과 파일 내용
  const pendingBlock = useRef<number | null>(null);

  /* ---------- 터미널 로그 ---------- */

  const log = (b: Omit<Block, "id">, sessionId = activeId) => {
    const id = blockSeq++;
    setSessions((ss) => ss.map((s) => (s.id === sessionId ? { ...s, blocks: [...s.blocks, { ...b, id }] } : s)));
    return id;
  };
  const patch = (blockId: number, add: Line[], done = true) => {
    setSessions((ss) =>
      ss.map((s) => ({
        ...s,
        blocks: s.blocks.map((b) =>
          b.id === blockId ? { ...b, lines: [...b.lines, ...add], running: done ? false : b.running } : b,
        ),
      })),
    );
  };

  /* ---------- 그래프에 쓰일 기록 ---------- */

  const history: Commit[] = [...local, ...BASE];
  const head = history[0];
  const origin = history.find((c) => c.pushed)!;
  const unpushed = local.filter((c) => !c.pushed); // 최신이 앞

  /* ---------- 변경 설명 / 메시지 추천 ---------- */

  const analyze = (typed?: string, then?: () => void) => {
    if (analyzed || analyzing) return then?.();
    setAnalyzing(true);
    const id = log({
      title: typed ?? "무엇이 바뀌었는지 설명 듣기",
      typed: !!typed,
      git: "git diff",
      running: true,
      lines: [{ tone: "dim", text: `AI가 바뀐 파일 ${pending.length}개를 읽고 있어요…` }],
    });
    setTimeout(() => {
      setAnalyzing(false);
      setAnalyzed(true);
      patch(
        id,
        CHANGED_FILES.filter((f) => pending.includes(f.path)).map((f) => ({
          tone: (f.sensitive ? "warn" : "ai") as LineTone,
          text: `${f.path} — ${f.plain}`,
        })),
      );
      then?.();
    }, 1400);
  };

  const suggest = () => analyze(undefined, () => setMessage(suggestMessage(checked)));

  const toggleFile = (path: string) =>
    setChecked((c) => (c.includes(path) ? c.filter((p) => p !== path) : [...c, path]));
  const toggleAll = () => setChecked((c) => (c.length === pending.length ? [] : [...pending]));

  /* ---------- 커밋 ---------- */

  const canCommit = phase === "save" && checked.length > 0 && message.trim().length > 0 && !safety;

  const makeCommit = (files: string[], msg: string) => {
    if (!files.length) return;
    const idx = local.length;
    const prevFiles = local.flatMap((c) => c.files ?? []);
    const all = [...prevFiles, ...files];
    const c: Commit = {
      id: `n${idx + 1}`,
      hash: NEW_HASHES[idx % NEW_HASHES.length],
      msg,
      when: WHEN[idx % WHEN.length],
      lane: 0,
      parents: [head.id],
      preview: all.includes("menu.js") && all.includes("menu.html") ? "after" : "before",
      files,
      pushed: false,
      local: true,
    };
    setLocal((l) => [c, ...l]);
    const rest = pending.filter((p) => !files.includes(p));
    setPending((p) => p.filter((x) => !files.includes(x)));
    setChecked(rest.filter((p) => p !== ".env" || checked.includes(".env")));
    setMessage("");
    setDescription("");
    if (!timers.current.firstCommit) timers.current.firstCommit = Date.now();

    const lines: Line[] = [
      { tone: "ok", text: `저장 지점을 만들었어요 · ${c.hash} “${msg}”` },
      { tone: "dim", text: `  파일 ${files.length}개: ${files.join(", ")}` },
      { tone: "dim", text: "  아직 온라인에는 안 올라갔어요. ‘올리기’를 누르면 GitHub에 올라가요." },
    ];
    if (pendingBlock.current != null) {
      patch(pendingBlock.current, lines);
      pendingBlock.current = null;
    } else {
      log({ title: "커밋하기", git: `git add ${files.join(" ")} && git commit -m "${msg}"`, lines });
    }
  };

  const commit = (typed?: string, msgOverride?: string) => {
    const msg = (msgOverride ?? message).trim();
    if (phase !== "save" || !checked.length || !msg || safety) return;
    if (msgOverride) setMessage(msgOverride);
    if (checked.includes(".env")) {
      // 비밀 정보가 섞여 있으면 저장 전에 멈춘다
      pendingBlock.current = log({
        title: typed ?? "커밋하기",
        typed: !!typed,
        git: `git add ${checked.join(" ")} && git commit -m "${msg}"`,
        running: true,
        lines: [{ tone: "warn", text: ".env 파일에 API 키(비밀 정보)가 들어 있어요. 확인이 필요해요." }],
      });
      setSafety({ kind: "commit" });
      return;
    }
    if (typed) {
      pendingBlock.current = log({
        title: typed,
        typed: true,
        git: `git add ${checked.join(" ")} && git commit -m "${msg}"`,
        lines: [],
      });
    }
    makeCommit(checked, msg);
  };

  const resolveCommitSafety = (exclude: boolean, ignore: boolean) => {
    setSafety(null);
    setEnvChoice(exclude ? "excluded" : "included");
    const files = exclude ? checked.filter((p) => p !== ".env") : checked;
    if (exclude) {
      if (pendingBlock.current != null)
        patch(pendingBlock.current, [{ tone: "ok", text: ".env 파일은 빼고 저장해요" }], false);
      if (ignore) {
        setEnvIgnored(true);
        setPending((p) => p.filter((x) => x !== ".env"));
        if (pendingBlock.current != null)
          patch(pendingBlock.current, [{ tone: "ok", text: "앞으로도 .env 는 자동으로 빼둘게요 (.gitignore)" }], false);
      }
    } else if (pendingBlock.current != null) {
      patch(pendingBlock.current, [{ tone: "err", text: ".env 파일(API 키)도 함께 저장해요" }], false);
    }
    if (!files.length) {
      if (pendingBlock.current != null) patch(pendingBlock.current, [{ tone: "dim", text: "저장할 파일이 없어요" }]);
      pendingBlock.current = null;
      setChecked((c) => c.filter((p) => p !== ".env"));
      return;
    }
    // makeCommit 은 변경 전 상태 값을 쓰므로 .env 처리를 여기서 다시 반영
    const rest = pending.filter((p) => !files.includes(p) && !(exclude && ignore && p === ".env"));
    // AI 추천 메시지를 그대로 쓰는 중이면 빠진 파일에 맞게 다시 추천
    const msg = exclude && message.trim() === suggestMessage(checked) ? suggestMessage(files) : message.trim();
    makeCommit(files, msg);
    if (exclude) {
      setPending(rest);
      setChecked(rest.filter((p) => p !== ".env"));
    }
  };

  const cancelSafety = () => {
    setSafety(null);
    if (pendingBlock.current != null) patch(pendingBlock.current, [{ tone: "dim", text: "취소했어요" }]);
    pendingBlock.current = null;
  };

  /* ---------- 푸시 ---------- */

  const push = (upToId?: string, opts: { force?: boolean; typed?: string } = {}) => {
    if (pushing || !unpushed.length) return;
    const oldestFirst = [...unpushed].reverse();
    const targetId = upToId ?? unpushed[0].id;
    const idx = oldestFirst.findIndex((c) => c.id === targetId);
    if (idx < 0) return;
    const targets = oldestFirst.slice(0, idx + 1);
    const secret = targets.find((c) => c.files?.includes(".env"));
    if (secret && !opts.force) {
      setSafety({ kind: "push", upToId: targetId, secret });
      return;
    }
    setSafety(null);
    const all = targets.length === unpushed.length;
    const target = targets[targets.length - 1];
    setPushing(targetId);
    const id = log({
      title:
        opts.typed ??
        (all && targets.length > 1
          ? `모두 올리기 (${targets.length}개)`
          : targets.length > 1
            ? `“${target.msg}”까지 올리기`
            : `“${target.msg}” 올리기`),
      typed: !!opts.typed,
      git: all ? "git push origin main" : `git push origin ${target.hash}:main`,
      running: true,
      lines: [{ tone: "dim", text: "GitHub에 올리는 중…" }],
    });
    setTimeout(() => {
      const ids = new Set(targets.map((c) => c.id));
      setLocal((l) => l.map((c) => (ids.has(c.id) ? { ...c, pushed: true } : c)));
      setPushing(null);
      if (!timers.current.firstPush) timers.current.firstPush = Date.now();
      patch(id, [
        { tone: "ok", text: `저장 지점 ${targets.length}개를 GitHub에 올렸어요` },
        ...targets.map((c) => ({ tone: "dim" as const, text: `  ${c.hash}  ${c.msg}` })),
        ...(targets.length > 1 && !all
          ? [{ tone: "dim" as const, text: "  Git은 순서대로 올라가서, 그 전 저장 지점도 함께 올라갔어요." }]
          : []),
        ...(unpushed.length - targets.length > 0
          ? [{ tone: "plain" as const, text: `아직 올리지 않은 저장 지점 ${unpushed.length - targets.length}개가 남아 있어요.` }]
          : []),
      ]);
    }, 1200);
  };

  /* ---------- 과제 2: 되돌리기 ---------- */

  const canNext = phase === "save" && pending.filter((p) => p !== ".env").length === 0 && local.length > 0;

  const goBroken = () => {
    if (!canNext) return;
    timers.current.t2Start = Date.now();
    setPhase("restore");
    setRestoreStep("broken");
    setSelectedId(null);
    log({
      title: "AI 코딩 도구가 파일을 수정했어요",
      lines: [
        ...BROKEN.files.map((f) => ({ tone: "dim" as const, text: `  M  ${f}` })),
        { tone: "err", text: BROKEN.error },
        { tone: "ai", text: BROKEN.plain },
      ],
    });
  };

  const openPick = (typed?: string) => {
    if (phase !== "restore" || restoreStep !== "broken") {
      // 데모에서는 되돌리기를 과제 2 에서 체험한다. 그 전에 누르면 아무 반응이 없어 보이지 않게 안내한다
      if (phase === "save")
        log({
          title: typed ?? "되돌리기",
          typed: !!typed,
          lines: [
            { tone: "plain", text: "되돌리기는 사이트가 망가졌을 때 잘 되던 상태로 돌아가는 기능이에요." },
            { tone: "dim", text: "이 데모에서는 저장과 올리기를 마치고 ‘다음 과제’로 넘어가면 체험할 수 있어요." },
          ],
        });
      return;
    }
    setRestoreStep("pick");
    setSelectedId(head.id);
    log({
      title: typed ?? "잘 되던 때로 되돌리기",
      typed: !!typed,
      git: "git log --graph",
      lines: [
        { tone: "plain", text: "위 그래프에서 돌아가고 싶은 저장 지점을 골라주세요." },
        { tone: "dim", text: `가장 최근 저장 지점: ${head.hash} “${head.msg}” (${head.when})` },
      ],
    });
  };

  const pick = (id: string) => {
    if (restoreStep === "pick") setSelectedId(id);
  };

  const doRestore = () => {
    const target = history.find((c) => c.id === selectedId);
    if (!target) return;
    setRestoreStep("restoring");
    const id = log({
      title: `“${target.msg}” 상태로 되돌리기`,
      git: `git branch backup/before-restore && git restore --source=${target.hash} .`,
      running: true,
      lines: [{ tone: "dim", text: "지금 상태를 백업하고 되돌리는 중…" }],
    });
    setTimeout(() => {
      timers.current.t2End = Date.now();
      setBackupParent(head.id);
      if (target.id !== head.id) {
        const idx = local.length;
        setLocal((l) => [
          {
            id: "revert",
            hash: NEW_HASHES[idx % NEW_HASHES.length],
            msg: `되돌리기: “${target.msg}” 상태로`,
            when: "방금",
            lane: 0,
            parents: [head.id],
            preview: target.preview,
            files: BROKEN.files,
            pushed: false,
            local: true,
          },
          ...l,
        ]);
      }
      setRestoredTo(target.id);
      setRestoreStep("restored");
      patch(id, [
        { tone: "ok", text: "망가진 상태는 ‘되돌리기 전 백업’으로 따로 보관했어요" },
        { tone: "ok", text: `“${target.msg}” 상태로 돌아왔어요.` },
      ]);
    }, 1300);
  };

  /* ---------- 과제 3: 팀원과 충돌 ---------- */

  const goConflict = () => {
    timers.current.t3Start = Date.now();
    setPhase("conflict");
    setConflictStep("incoming");
    setDemoResolved(null);
    log({
      title: "온라인 확인",
      git: "git fetch",
      lines: [
        { tone: "warn", text: `${DEMO_TEAMMATE.author} 님이 온라인에 새 저장 지점을 올렸어요` },
        { tone: "dim", text: `  ${DEMO_TEAMMATE.hash}  ${DEMO_TEAMMATE.msg}` },
      ],
    });
  };

  const demoPull = (typed?: string) => {
    if (phase !== "conflict" || conflictStep !== "incoming") return;
    setConflictStep("failed");
    log({
      title: typed ?? "받아오기 (취소됨)",
      typed: !!typed,
      git: "git pull",
      lines: [
        { tone: "warn", text: "같은 부분을 서로 다르게 고쳐서 자동으로 합칠 수 없었어요" },
        { tone: "ok", text: "받아오기를 취소하고 원래 상태로 되돌려 놨어요. 내 파일은 그대로예요" },
        { tone: "dim", text: `  충돌  ${DEMO_CONFLICT_FILE}` },
      ],
    });
  };

  const demoOpenResolver = () => {
    if (conflictStep === "failed") {
      log({
        title: "충돌 해결 시작",
        git: "git merge origin/main",
        lines: [{ tone: "warn", text: `충돌 파일 1개 — 화면에서 어떤 내용을 남길지 골라 주세요` }],
      });
    }
    setConflictStep("resolving");
  };

  const demoSaveFile = (content: string, note: string) => {
    setDemoResolved(content);
    log({ title: "충돌 해결", git: `git add ${DEMO_CONFLICT_FILE}`, lines: [{ tone: "ok", text: `${DEMO_CONFLICT_FILE} — ${note}` }] });
  };

  const demoAbort = () => {
    setConflictStep("failed");
    setDemoResolved(null);
    log({
      title: "합치기 취소",
      git: "git merge --abort",
      lines: [{ tone: "ok", text: "합치기를 취소하고 받아오기 전 상태로 되돌렸어요. 내 파일은 그대로예요" }],
    });
  };

  const demoFinish = () => {
    if (!demoResolved) return;
    timers.current.t3End = Date.now();
    setConflictStep("merged");
    log({
      title: "합치기 완료",
      git: "git commit --no-edit",
      lines: [
        { tone: "ok", text: "충돌을 모두 해결하고 합친 저장 지점을 만들었어요 · 2f8b6a1" },
        { tone: "dim", text: "합친 결과는 아직 온라인에 없어요. ‘올리기’로 올리면 팀원도 받을 수 있어요" },
      ],
    });
  };

  /* ---------- 그래프 행 ---------- */

  let commits: Commit[];
  if (phase === "save") {
    commits = pending.length
      ? [
          {
            id: "wip",
            hash: "",
            msg: `저장 안 된 변경 ${pending.length}개`,
            when: "지금",
            lane: 0,
            parents: [head.id],
            preview: "after",
            kind: "wip",
          },
          ...history,
        ]
      : history;
  } else if (phase === "conflict" || (phase === "done" && conflictStep === "merged")) {
    // 팀원 저장 지점은 온라인(origin)에 있다. 합치면 두 갈래를 잇는 합친 저장 지점이 생긴다
    const mate: Commit = {
      id: "mate",
      hash: DEMO_TEAMMATE.hash,
      msg: `${DEMO_TEAMMATE.author}: ${DEMO_TEAMMATE.msg}`,
      when: "방금",
      lane: 1,
      parents: [origin.id],
      preview: "after",
    };
    const merging = conflictStep === "resolving" || conflictStep === "merging";
    const top: Commit[] =
      conflictStep === "merged"
        ? [{ id: "merge", hash: "2f8b6a1", msg: "Merge remote-tracking branch 'origin/main'", when: "방금", lane: 0, parents: [head.id, "mate"], preview: "after", local: true }]
        : merging
          ? [{ id: "wip", hash: "", msg: "합치는 중 · 충돌 1개", when: "지금", lane: 0, parents: [head.id], preview: "after", kind: "wip" }]
          : [];
    commits = [...top, mate, ...history];
  } else if (restoreStep === "restored" && backupParent) {
    commits = [
      {
        id: "backup",
        hash: "9f1c2aa",
        msg: "되돌리기 전 백업",
        when: "방금",
        lane: 2,
        parents: [backupParent],
        preview: "broken",
        kind: "backup",
        broken: true,
      },
      ...history,
    ];
  } else {
    commits = [
      {
        id: "wip",
        hash: "",
        msg: `저장 안 된 변경 ${BROKEN.files.length}개 · 메뉴 페이지 오류`,
        when: "지금",
        lane: 0,
        parents: [head.id],
        preview: "broken",
        kind: "wip",
        broken: true,
      },
      ...history,
    ];
  }

  /* ---------- 미리보기 ---------- */

  let preview = commits.find((c) => c.id === "wip")?.preview ?? "after";
  let previewLabel = "지금 내 사이트";
  if (phase === "restore" && (restoreStep === "pick" || restoreStep === "confirm") && selectedId) {
    const sel = commits.find((c) => c.id === selectedId);
    if (sel) {
      preview = sel.preview;
      previewLabel = `${sel.hash} 시점 미리보기`;
    }
  } else if (phase !== "save" && restoreStep === "restored") {
    preview = history.find((c) => c.id === restoredTo)?.preview ?? "after";
  }

  /* ---------- 세션 ---------- */

  const newSession = () => {
    const s = emptySession();
    setSessions((ss) => [...ss, s]);
    setActiveId(s.id);
  };
  const closeSession = (id: number) => {
    if (sessions.length === 1) return;
    const rest = sessions.filter((s) => s.id !== id);
    setSessions(rest);
    if (activeId === id) setActiveId(rest[0].id);
    if (splitId === id) setSplitId(null);
  };
  const toggleSplit = () => {
    if (splitId != null) return setSplitId(null);
    let other = sessions.find((s) => s.id !== activeId);
    if (!other) {
      const o = emptySession();
      setSessions((ss) => [...ss, o]);
      other = o;
    }
    setSplitId(other.id);
  };

  /* ---------- 터미널 입력 해석 ---------- */

  const runInput = (raw: string, sessionId: number) => {
    const text = raw.trim();
    if (!text) return;
    setActiveId(sessionId);
    const t = text.toLowerCase();
    const has = (...ks: string[]) => ks.some((k) => t.includes(k));
    const say = (lines: Line[]) => log({ title: text, typed: true, lines }, sessionId);

    if (has("도움", "help", "뭘 할 수")) {
      return say([
        { tone: "plain", text: "이렇게 말해보세요:" },
        { tone: "dim", text: "  · 뭐가 바뀌었어? / 설명해줘     → 변경 내용 설명 (git diff)" },
        { tone: "dim", text: "  · 저장해줘                       → 커밋하기 (git commit)" },
        { tone: "dim", text: "  · 올려줘                         → 모두 올리기 (git push)" },
        { tone: "dim", text: "  · 기록 보여줘                    → 저장 기록 (git log)" },
        { tone: "dim", text: "  · 되돌려줘 / 원래대로            → 예전 상태로 되돌리기 (git restore)" },
        { tone: "dim", text: "Git 명령어를 그대로 입력해도 알아들어요. 예: git commit -m \"메뉴 수정\"" },
      ]);
    }
    if (has("되돌", "원래대로", "복구", "revert", "reset", "restore", "undo")) {
      if (phase === "restore" && restoreStep === "broken") return openPick(text);
      return say([{ tone: "dim", text: "지금은 되돌릴 필요가 없어 보여요. 사이트가 잘 동작하고 있어요." }]);
    }
    if (has("올려", "올리", "push", "업로드")) {
      if (!unpushed.length) return say([{ tone: "dim", text: "올릴 저장 지점이 없어요. 모두 GitHub에 올라가 있어요." }]);
      return push(undefined, { typed: text });
    }
    if (has("git add", "스테이지", "stage")) {
      return say([{ tone: "plain", text: "오른쪽 ‘바뀐 내용’에서 체크한 파일이 이번 저장에 들어가요." }]);
    }
    if (has("저장", "커밋", "commit")) {
      if (phase !== "save" || !pending.length) return say([{ tone: "dim", text: "지금은 저장할 변경이 없어요." }]);
      const m = text.match(/-m\s+["“']?(.+?)["”']?\s*$/);
      if (m) return commit(text, m[1]);
      if (!message.trim()) {
        say([
          { tone: "ai", text: "오른쪽 메시지 칸에 AI가 추천한 메시지를 넣어둘게요." },
          { tone: "dim", text: "확인하고 ‘커밋하기’를 누르거나, 다시 ‘저장해줘’라고 입력하세요." },
        ]);
        return suggest();
      }
      return commit(text);
    }
    if (has("설명", "바뀌", "변경", "diff")) {
      if (phase === "save" && pending.length && !analyzed) return analyze(text);
      return say([{ tone: "dim", text: "바뀐 내용 설명은 오른쪽 ‘바뀐 내용’ 패널에 있어요." }]);
    }
    if (has("기록", "log", "히스토리")) {
      return say(
        history.slice(0, 6).map((c) => ({
          tone: (c.pushed ? "dim" : "plain") as LineTone,
          text: `${c.hash}  ${c.msg}${c.pushed ? "" : "   ↑ 아직 안 올림"}`,
        })),
      );
    }
    if (has("상태", "status")) {
      const n = phase === "save" ? pending.length : restoreStep !== "restored" ? BROKEN.files.length : 0;
      return say([
        { tone: "plain", text: `main 에서 작업 중 · 마지막 저장: “${head.msg}”` },
        n ? { tone: "warn", text: `아직 저장하지 않은 변경 ${n}개` } : { tone: "ok", text: "저장하지 않은 변경이 없어요" },
        unpushed.length
          ? { tone: "warn", text: `아직 온라인에 올리지 않은 저장 지점 ${unpushed.length}개` }
          : { tone: "ok", text: "온라인(GitHub)과 같은 상태예요" },
      ]);
    }
    if (has("pull", "받아") && phase === "conflict") {
      if (conflictStep === "incoming") return demoPull(text);
      return say([{ tone: "dim", text: "이미 받아오기를 시도했어요. 오른쪽에서 충돌을 해결해 주세요." }]);
    }
    if (has("pull", "받아", "branch", "브랜치", "merge")) {
      return say([{ tone: "dim", text: "이 기능은 이번 프로토타입에 포함되지 않았어요." }]);
    }
    if (has("clear", "지워")) {
      setSessions((ss) => ss.map((s) => (s.id === sessionId ? { ...s, blocks: [] } : s)));
      return;
    }
    say([{ tone: "dim", text: "무슨 뜻인지 잘 모르겠어요. ‘도움’이라고 입력하면 할 수 있는 일을 알려드려요." }]);
  };

  /* ---------- 전체 초기화 ---------- */

  const reset = () => {
    setPhase("save");
    setPending(ALL_PATHS);
    setChecked(ALL_PATHS);
    setAnalyzed(false);
    setAnalyzing(false);
    setMessage("");
    setDescription("");
    setLocal([]);
    setEnvIgnored(false);
    setEnvChoice(null);
    setSafety(null);
    setPushing(null);
    setRestoreStep("broken");
    setSelectedId(null);
    setRestoredTo(null);
    setBackupParent(null);
    setConflictStep("incoming");
    setDemoResolved(null);
    const s = welcomeSession();
    setSessions([s]);
    setActiveId(s.id);
    setSplitId(null);
    pendingBlock.current = null;
    timers.current = { t1Start: Date.now(), firstCommit: 0, firstPush: 0, t2Start: 0, t2End: 0, t3Start: 0, t3End: 0 };
  };

  const changeCount =
    phase === "save"
      ? pending.length
      : phase === "conflict"
        ? conflictStep === "resolving" || conflictStep === "merging" ? 1 : 0
        : restoreStep !== "restored" ? BROKEN.files.length : 0;

  return {
    phase, restoreStep, selectedId, restoredTo,
    pending, checked, analyzed, analyzing, message, setMessage, description, setDescription,
    local, unpushed, envIgnored, envChoice, safety, pushing, canCommit, canNext,
    commits,
    // 합친 뒤에는 합친 저장 지점이 지금 위치
    headId: conflictStep === "merged" && (phase === "conflict" || phase === "done") ? "merge" : head.id,
    // 과제 3 에서는 팀원 저장 지점이 온라인(GitHub)의 마지막 위치
    originId: phase === "conflict" || (phase === "done" && conflictStep === "merged") ? "mate" : origin.id, preview, previewLabel, changeCount, timers,
    sessions, activeId, setActiveId, splitId,
    analyze, suggest, toggleFile, toggleAll, commit, resolveCommitSafety, cancelSafety, push,
    goBroken, openPick, pick,
    askConfirm: () => setRestoreStep("confirm"),
    cancelConfirm: () => setRestoreStep("pick"),
    doRestore, finish: () => setPhase("done"), reset,
    conflictStep, demoResolved, goConflict, demoPull, demoOpenResolver, demoSaveFile, demoAbort, demoFinish,
    demoCloseResolver: () => setConflictStep("merging"),
    newSession, closeSession, toggleSplit, runInput,
  };
}

export type Scenario = ReturnType<typeof useScenario>;
