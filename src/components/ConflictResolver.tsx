// 충돌 해결 화면.
// Git 은 충돌 부분을 파일 안에 <<<<<<< ======= >>>>>>> 기호로 써 넣는데, 초보자는 이걸 직접 고치기 어렵다.
// 이 화면은 그 부분을 "내 것 / 온라인 것" 카드로 보여주고, 버튼으로 고르면 기호 없이 깔끔한 파일을 만들어 준다.
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Code2, FileWarning, GitMerge, Sparkles, X } from "lucide-react";
import type { ConflictExplanation } from "../ai";
import type { ConflictFile, Segment } from "../git";

/**
 * 충돌 해결 화면이 필요로 하는 것들. 실제 저장소(git 명령)와 웹 데모(미리 준비한 데이터)가 각자 채워 넣는다.
 * 화면은 하나로 두고 뒤에서 하는 일만 바꿔 끼우는 방식이다.
 */
export interface ResolverBackend {
  oursLabel: string;
  theirsLabel: string;
  /** 처음 충돌 났던 파일 전체 (진행률 표시용) */
  all: string[];
  /** 아직 해결하지 않은 파일 */
  remaining: string[];
  load(file: string): Promise<ConflictFile>;
  saveFile(file: string, content: string, note: string): Promise<void>;
  chooseWhole(file: string, side: "ours" | "theirs", note: string): Promise<void>;
  explain(req: {
    path: string;
    oursLabel: string;
    theirsLabel: string;
    ours: string;
    theirs: string;
    base: string | null;
    before: string;
    after: string;
  }): Promise<ConflictExplanation>;
  abort(): void;
  finish(): void;
  close(): void;
}

type Choice = "ours" | "theirs" | "oursFirst" | "theirsFirst";

const CHOICES: { key: Choice; label: string }[] = [
  { key: "ours", label: "내 것 쓰기" },
  { key: "theirs", label: "온라인 것 쓰기" },
  { key: "oursFirst", label: "둘 다 · 내 것 먼저" },
  { key: "theirsFirst", label: "둘 다 · 온라인 것 먼저" },
];

/** 두 조각을 이어 붙일 때 앞 조각이 줄바꿈으로 끝나지 않으면 줄바꿈을 넣어 줄이 붙어 버리지 않게 한다 */
function join(a: string, b: string) {
  if (!a || !b || a.endsWith("\n")) return a + b;
  return a + (b.includes("\r\n") || a.includes("\r\n") ? "\r\n" : "\n") + b;
}

function pick(seg: Extract<Segment, { kind: "conflict" }>, c: Choice) {
  if (c === "ours") return seg.ours;
  if (c === "theirs") return seg.theirs;
  if (c === "oursFirst") return join(seg.ours, seg.theirs);
  return join(seg.theirs, seg.ours);
}

export default function ConflictResolver({ backend: b }: { backend: ResolverBackend }) {
  const { remaining, all } = b;
  const [current, setCurrent] = useState<string | null>(remaining[0] ?? null);
  const [cf, setCf] = useState<ConflictFile | null>(null);
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [showRaw, setShowRaw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 충돌 조각별 AI 설명 (불러오는 중이면 "loading", 실패하면 에러 문구)
  const [explain, setExplain] = useState<Record<number, ConflictExplanation | "loading" | { error: string }>>({});

  // 지금 파일이 해결되면 다음 남은 파일로 (remaining 은 매번 새 배열이라 문자열로 바꿔 비교한다)
  const remainingKey = remaining.join("\n");
  useEffect(() => {
    if (current && !remaining.includes(current)) setCurrent(remaining[0] ?? null);
    if (!current && remaining.length) setCurrent(remaining[0]);
  }, [remainingKey]);

  useEffect(() => {
    setCf(null);
    setChoices({});
    setExplain({});
    setShowRaw(false);
    setError(null);
    if (!current) return;
    b.load(current).then(setCf).catch((e) => setError(String(e)));
  }, [current]); // b 는 화면이 다시 그려질 때마다 새로 만들어지므로 넣지 않는다

  const conflicts = useMemo(
    () => (cf?.segments ?? []).flatMap((s, i) => (s.kind === "conflict" ? [i] : [])),
    [cf],
  );
  const chosenAll = conflicts.length > 0 && conflicts.every((i) => choices[i]);

  /** 충돌 조각 하나를 AI 에게 설명받는다. 앞뒤의 같은 줄도 조금 보내서 무엇에 관한 코드인지 알려준다 */
  const askAi = async (i: number) => {
    if (!cf?.segments || !current) return;
    const seg = cf.segments[i];
    if (seg.kind !== "conflict") return;
    const near = (j: number, fromEnd: boolean) => {
      const s = cf.segments![j];
      if (!s || s.kind !== "same") return "";
      const lines = s.text.split(/\r?\n/);
      return (fromEnd ? lines.slice(-15) : lines.slice(0, 15)).join("\n");
    };
    setExplain((m) => ({ ...m, [i]: "loading" }));
    try {
      const res = await b.explain({
        path: current,
        oursLabel: ours,
        theirsLabel: theirs,
        ours: seg.ours,
        theirs: seg.theirs,
        base: seg.base,
        before: near(i - 1, true),
        after: near(i + 1, false),
      });
      setExplain((m) => ({ ...m, [i]: res }));
    } catch (e) {
      setExplain((m) => ({ ...m, [i]: { error: e instanceof Error ? e.message : String(e) } }));
    }
  };

  const saveFile = async () => {
    if (!cf?.segments || !chosenAll || !current) return;
    const content = cf.segments.map((s, i) => (s.kind === "same" ? s.text : pick(s, choices[i]))).join("");
    setBusy(true);
    setError(null);
    try {
      await b.saveFile(current, content, `${conflicts.length}곳 골라서 저장`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const chooseWhole = async (side: "ours" | "theirs", what: string) => {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      await b.chooseWhole(current, side, what);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const ours = b.oursLabel;
  const theirs = b.theirsLabel;
  const done = all.length - remaining.length;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-base">
      {/* 머리글 */}
      <header className="flex shrink-0 items-center gap-4 border-b border-line bg-panel px-5 py-3">
        <GitMerge size={18} className="text-amber" />
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-fg">충돌 해결</div>
          <div className="text-[12px] text-muted">
            나(<span className="text-teal">{ours}</span>)와 온라인(<span className="text-blue">{theirs}</span>)이 같은 부분을 서로 다르게
            고쳤어요. 어떤 내용을 남길지 골라 주세요.
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="font-mono text-[12px] text-muted">
            {done}/{all.length} 파일 해결
          </span>
          <button
            onClick={b.abort}
            disabled={busy}
            className="rounded-[3px] border border-line px-3 py-1.5 text-[12px] text-muted hover:border-red/50 hover:text-red disabled:opacity-40"
            title="고른 것을 모두 버리고 받아오기 전 상태로 돌아가요"
          >
            합치기 취소
          </button>
          <button
            onClick={b.finish}
            disabled={busy || remaining.length > 0}
            className="flex items-center gap-1.5 rounded-[3px] bg-teal px-3 py-1.5 text-[12px] font-semibold text-[#0b2626] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Check size={13} /> 합치기 완료
          </button>
          <button onClick={b.close} className="text-dim hover:text-fg" title="닫기 (합치기는 계속 진행 중으로 남아요)">
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 파일 목록 */}
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-line bg-panel py-2">
          <div className="px-3 pb-1 text-[11px] font-medium text-muted">충돌 파일</div>
          {all.map((f) => {
            const left = remaining.includes(f);
            return (
              <button
                key={f}
                onClick={() => left && setCurrent(f)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[12px] ${
                  current === f ? "bg-raised text-fg" : left ? "text-fg/80 hover:bg-hover" : "cursor-default text-dim"
                }`}
              >
                {left ? <AlertTriangle size={12} className="shrink-0 text-amber" /> : <Check size={12} className="shrink-0 text-green" />}
                <span className="truncate">{f}</span>
              </button>
            );
          })}
          {remaining.length === 0 && (
            <div className="mx-3 mt-3 border border-green/30 bg-green/5 p-3 text-[12px] leading-relaxed text-green">
              모든 충돌을 해결했어요. 위의 ‘합치기 완료’를 누르면 합친 결과가 저장 지점으로 기록돼요.
            </div>
          )}
        </aside>

        {/* 파일 내용 */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          {!current ? (
            <div className="flex h-full items-center justify-center text-[13px] text-dim">해결할 파일이 없어요</div>
          ) : !cf ? (
            <div className="p-6 text-[12px] text-dim">{error ?? "불러오는 중…"}</div>
          ) : (
            <div className="mx-auto max-w-5xl space-y-4 p-6">
              <div className="flex items-center gap-3">
                <span className="font-mono text-[14px] text-fg">{cf.path}</span>
                {cf.segments && (
                  <span className="text-[12px] text-muted">
                    충돌 {conflicts.length}곳 · {conflicts.filter((i) => choices[i]).length}곳 고름
                  </span>
                )}
                {cf.segments && (
                  <button
                    onClick={() => setShowRaw(!showRaw)}
                    className={`ml-auto flex items-center gap-1 text-[11px] ${showRaw ? "text-amber" : "text-dim hover:text-muted"}`}
                  >
                    <Code2 size={12} /> 원래 Git 표시 보기
                  </button>
                )}
              </div>

              {showRaw && <RawView raw={cf.raw} />}

              {cf.segments ? (
                <>
                  {cf.segments.map((seg, i) =>
                    seg.kind === "same" ? (
                      <SameBlock key={i} text={seg.text} />
                    ) : (
                      <ConflictBlock
                        key={i}
                        n={conflicts.indexOf(i) + 1}
                        seg={seg}
                        ours={ours}
                        theirs={theirs}
                        choice={choices[i]}
                        onChoose={(c) => setChoices((m) => ({ ...m, [i]: c }))}
                        explain={explain[i]}
                        onAskAi={() => askAi(i)}
                      />
                    ),
                  )}
                  <div className="sticky bottom-0 flex items-center gap-3 border-t border-line bg-base/95 py-3 backdrop-blur">
                    <button
                      onClick={saveFile}
                      disabled={!chosenAll || busy}
                      className="rounded-[3px] bg-teal px-4 py-2 text-[13px] font-semibold text-[#0b2626] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      이 파일 저장
                    </button>
                    <span className="text-[12px] text-dim">
                      {chosenAll ? "고른 내용으로 파일을 만들고 ‘해결됨’으로 표시해요" : "충돌마다 어떤 내용을 쓸지 골라 주세요"}
                    </span>
                    {error && <span className="text-[12px] text-red">{error}</span>}
                  </div>
                </>
              ) : (
                <WholeFile cf={cf} ours={ours} theirs={theirs} busy={busy} onChoose={chooseWhole} error={error} />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

/** 양쪽이 같은 부분. 길면 가운데를 접어 둔다 */
function SameBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const lines = text.replace(/\r?\n$/, "").split(/\r?\n/);
  const long = lines.length > 8;
  const shown = !long || open ? lines : [...lines.slice(0, 3), null, ...lines.slice(-3)];
  return (
    <pre className="overflow-x-auto border-l-2 border-line px-3 py-1 font-mono text-[12px] leading-relaxed text-dim">
      {shown.map((l, i) =>
        l === null ? (
          <button key={i} onClick={() => setOpen(true)} className="block py-0.5 text-[11px] text-muted hover:text-fg">
            … 양쪽이 같은 {lines.length - 6}줄 펼치기 …
          </button>
        ) : (
          <div key={i}>{l || " "}</div>
        ),
      )}
    </pre>
  );
}

function ConflictBlock({
  n,
  seg,
  ours,
  theirs,
  choice,
  onChoose,
  explain,
  onAskAi,
}: {
  n: number;
  seg: Extract<Segment, { kind: "conflict" }>;
  ours: string;
  theirs: string;
  choice?: Choice;
  onChoose: (c: Choice) => void;
  explain?: ConflictExplanation | "loading" | { error: string };
  onAskAi: () => void;
}) {
  const ai = explain && explain !== "loading" && !("error" in explain) ? explain : null;
  const [showBase, setShowBase] = useState(false);
  const usesOurs = choice && choice !== "theirs";
  const usesTheirs = choice && choice !== "ours";
  return (
    <section className={`border ${choice ? "border-line" : "border-amber/40"} bg-panel`}>
      <div className="flex items-center gap-2 border-b border-line-soft px-4 py-2 text-[12px]">
        <AlertTriangle size={13} className={choice ? "text-dim" : "text-amber"} />
        <span className={choice ? "text-muted" : "text-amber"}>충돌 {n}</span>
        <span className="text-dim">· 같은 부분을 서로 다르게 고쳤어요</span>
        <span className="ml-auto flex items-center gap-3">
          {choice && (
            <span className="flex items-center gap-1 text-green">
              <Check size={12} /> {CHOICES.find((c) => c.key === choice)!.label}
            </span>
          )}
          {!ai && (
            <button
              onClick={onAskAi}
              disabled={explain === "loading"}
              className="flex items-center gap-1 text-[11px] text-[#b9a6f5] hover:underline disabled:opacity-60"
            >
              <Sparkles size={11} /> {explain === "loading" ? "AI 가 읽고 있어요…" : "AI 설명 듣기"}
            </button>
          )}
        </span>
      </div>
      {explain && explain !== "loading" && "error" in explain && (
        <p className="border-b border-line-soft px-4 py-2 text-[11px] text-red/90">{explain.error}</p>
      )}
      {ai && (
        <div className="rise space-y-1.5 border-b border-line-soft bg-[#b9a6f5]/5 px-4 py-3 text-[12px] leading-relaxed">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#b9a6f5]">
            <Sparkles size={11} /> AI 설명
          </div>
          <p className="text-fg">{ai.summary}</p>
          <p className="text-muted">
            <span className="text-teal">내 것</span> · {ai.ours}
          </p>
          <p className="text-muted">
            <span className="text-blue">온라인 것</span> · {ai.theirs}
          </p>
          <p className="text-muted">
            <span className="text-[#b9a6f5]">추천</span> ·{" "}
            {ai.recommendation === "manual" ? "직접 고치는 게 좋아요" : CHOICES.find((c) => c.key === ai.recommendation)?.label} — {ai.reason}
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 p-3">
        <Side title="내 것" sub={ours} text={seg.ours} tone="teal" dim={!!choice && !usesOurs} />
        <Side title="온라인 것" sub={theirs} text={seg.theirs} tone="blue" dim={!!choice && !usesTheirs} />
      </div>
      {seg.base != null && (
        <div className="px-3 pb-2">
          <button onClick={() => setShowBase(!showBase)} className="flex items-center gap-1 text-[11px] text-dim hover:text-muted">
            {showBase ? <ChevronDown size={11} /> : <ChevronRight size={11} />} 둘 다 고치기 전의 원래 내용
          </button>
          {showBase && <pre className="mt-1 overflow-x-auto bg-base p-2 font-mono text-[12px] text-dim">{seg.base || "(비어 있음)"}</pre>}
        </div>
      )}
      <div className="flex flex-wrap gap-2 border-t border-line-soft px-3 py-2.5">
        {CHOICES.map((c) => (
          <button
            key={c.key}
            onClick={() => onChoose(c.key)}
            className={`rounded-[3px] border px-3 py-1.5 text-[12px] ${
              choice === c.key ? "border-teal bg-teal/15 text-fg" : "border-line text-muted hover:border-teal/50 hover:text-fg"
            } ${ai?.recommendation === c.key && choice !== c.key ? "border-[#b9a6f5]/60" : ""}`}
          >
            {c.label}
            {ai?.recommendation === c.key && <span className="ml-1.5 text-[10px] text-[#b9a6f5]">✦ 추천</span>}
          </button>
        ))}
      </div>
    </section>
  );
}

function Side({ title, sub, text, tone, dim }: { title: string; sub: string; text: string; tone: "teal" | "blue"; dim: boolean }) {
  return (
    <div className={`min-w-0 border transition-opacity ${tone === "teal" ? "border-teal/40" : "border-blue/40"} ${dim ? "opacity-35" : ""}`}>
      <div className={`flex items-center gap-2 px-3 py-1.5 text-[11px] ${tone === "teal" ? "bg-teal/10 text-teal" : "bg-blue/10 text-blue"}`}>
        <span className="font-semibold">{title}</span>
        <span className="truncate font-mono opacity-80">{sub}</span>
      </div>
      <pre className="overflow-x-auto px-3 py-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-fg">
        {text ? text.replace(/\r?\n$/, "") : <span className="text-dim italic">(이 부분을 지웠어요)</span>}
      </pre>
    </div>
  );
}

/** Git 이 파일에 써 넣은 원래 모습. 기호 줄을 강조해서 무엇이 무엇인지 알려준다 */
function RawView({ raw }: { raw: string }) {
  const lines = raw.replace(/\r?\n$/, "").split(/\r?\n/);
  return (
    <div className="border border-amber/30 bg-panel">
      <div className="border-b border-line-soft px-3 py-1.5 text-[11px] text-muted">
        Git 은 충돌 부분을 파일 안에 이렇게 표시해요. 이 화면에서 고르면 기호는 알아서 정리되니 몰라도 돼요.
      </div>
      <pre className="max-h-72 overflow-auto px-3 py-2 font-mono text-[12px] leading-relaxed">
        {lines.map((l, i) => {
          const m = /^(<{7}|={7}|>{7}|\|{7})( |$)/.exec(l);
          const hint = m
            ? { "<": "← 여기부터 내 것", "=": "← 여기부터 온라인 것", ">": "← 충돌 끝", "|": "← 원래 내용" }[m[1][0]]
            : null;
          return (
            <div key={i} className={m ? "text-amber" : "text-fg/80"}>
              {l || " "}
              {hint && <span className="ml-3 font-sans text-[11px] text-dim">{hint}</span>}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

/** 줄 단위로 고를 수 없는 충돌 (한쪽에서 삭제, 이미지 등) */
function WholeFile({
  cf,
  ours,
  theirs,
  busy,
  onChoose,
  error,
}: {
  cf: ConflictFile;
  ours: string;
  theirs: string;
  busy: boolean;
  onChoose: (side: "ours" | "theirs", what: string) => void;
  error: string | null;
}) {
  let why: string;
  let oursLabel = "내 것으로";
  let theirsLabel = "온라인 것으로";
  if (cf.oursExists && !cf.theirsExists) {
    why = "온라인(팀원)은 이 파일을 지웠고, 나는 이 파일을 고쳤어요.";
    oursLabel = "내가 고친 파일 남기기";
    theirsLabel = "파일 지우기 (온라인 따르기)";
  } else if (!cf.oursExists && cf.theirsExists) {
    why = "나는 이 파일을 지웠고, 온라인(팀원)은 이 파일을 고쳤어요.";
    oursLabel = "파일 지우기 (내 쪽 따르기)";
    theirsLabel = "팀원이 고친 파일 남기기";
  } else {
    why = "이미지 같은 파일이라 줄 단위로 비교할 수 없어요. 둘 중 하나를 통째로 골라 주세요.";
  }
  return (
    <section className="space-y-4 border border-amber/40 bg-panel p-5">
      <div className="flex items-start gap-2.5">
        <FileWarning size={18} className="mt-0.5 shrink-0 text-amber" />
        <p className="text-[13px] leading-relaxed text-fg">{why}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onChoose("ours", oursLabel)}
          disabled={busy}
          className="rounded-[3px] border border-teal/50 bg-teal/10 px-4 py-2 text-[13px] text-fg hover:bg-teal/20 disabled:opacity-40"
        >
          {oursLabel} <span className="font-mono text-[11px] text-teal">{ours}</span>
        </button>
        <button
          onClick={() => onChoose("theirs", theirsLabel)}
          disabled={busy}
          className="rounded-[3px] border border-blue/50 bg-blue/10 px-4 py-2 text-[13px] text-fg hover:bg-blue/20 disabled:opacity-40"
        >
          {theirsLabel} <span className="font-mono text-[11px] text-blue">{theirs}</span>
        </button>
      </div>
      {error && <p className="text-[12px] text-red">{error}</p>}
    </section>
  );
}
