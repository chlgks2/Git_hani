// GitKraken 스타일 커밋 그래프. 레인(갈래)별 색, 갈라짐/합침 곡선, 갈래 라벨.
import { useMemo, useState } from "react";
import { ArrowUp, Check, Cloud, GitBranch, LifeBuoy } from "lucide-react";
import { BROKEN, DEMO_STATS, DEMO_TEAMMATE, demoStatsFor, LANE_COLORS, type Commit } from "../data";
import { buildInsights } from "../graphInsights";
import type { Scenario } from "../store";
import CommitCard, { type CardData } from "./CommitCard";
import { GitChip } from "./Term";

const ROW = 34;
const LABEL_W = 150;
const GRAPH_W = 76;
const laneX = (l: number) => 18 + l * 18;
const rowY = (r: number) => r * ROW + ROW / 2;

export default function GitGraph({ s }: { s: Scenario }) {
  const rows = s.commits;
  const index = new Map(rows.map((c, i) => [c.id, i]));
  const picking = s.phase === "restore" && (s.restoreStep === "pick" || s.restoreStep === "confirm");
  const [hover, setHover] = useState<string | null>(null);

  const labels: Record<string, { text: string; lane: number; head?: boolean; remote?: boolean }[]> = {};
  const addLabel = (id: string, text: string, lane: number, head?: boolean, remote?: boolean) =>
    (labels[id] ??= []).push({ text, lane, head, remote });
  addLabel(s.headId, "main", 0, true);
  addLabel(s.originId, "GitHub", 0, false, true);
  addLabel("g2", "실험/갤러리", 1);
  if (index.has("backup")) addLabel("backup", "백업/되돌리기-전", 2);

  // 점마다 "여기서 무슨 일이 있었는지"
  const insights = useMemo(() => {
    const names = new Map<string, string[]>([[s.headId, ["main"]], ["g2", ["실험/갤러리"]], ["backup", ["백업/되돌리기-전"]]]);
    const input = rows.filter((c) => c.kind !== "wip").map((c) => ({ hash: c.id, parents: c.parents, subject: c.msg, lane: c.lane }));
    return buildInsights(input, names, s.headId, "main");
  }, [rows, s.headId]);

  // 간선 경로
  const edges: { d: string; color: string; dashed?: boolean }[] = [];
  rows.forEach((c, r) => {
    c.parents.forEach((pid, pi) => {
      const pr = index.get(pid);
      if (pr == null) return;
      const p = rows[pr];
      const x1 = laneX(c.lane), y1 = rowY(r), x2 = laneX(p.lane), y2 = rowY(pr);
      const color = LANE_COLORS[Math.max(c.lane, p.lane)];
      let d: string;
      if (c.lane === p.lane) d = `M${x1},${y1} L${x2},${y2}`;
      else if (pi > 0) {
        // 합침: 자식 바로 아래에서 부모 레인으로 휘어 들어감
        d = `M${x1},${y1} C${x1},${y1 + ROW * 0.7} ${x2},${y1 + ROW * 0.3} ${x2},${y1 + ROW} L${x2},${y2}`;
      } else {
        // 갈라짐: 자식 레인으로 내려오다 부모 바로 위에서 휘어 들어감
        d = `M${x1},${y1} L${x1},${y2 - ROW} C${x1},${y2 - ROW * 0.3} ${x2},${y2 - ROW * 0.7} ${x2},${y2}`;
      }
      edges.push({ d, color, dashed: c.kind === "wip" });
    });
  });

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-base">
      <div className="flex h-8 shrink-0 items-center border-b border-line bg-panel text-[11px] text-dim">
        <span className="px-3" style={{ width: LABEL_W }}>갈래</span>
        <span style={{ width: GRAPH_W }} className="flex items-center gap-1.5">
          그래프 <GitChip term="graph" />
        </span>
        <span className="flex-1 px-3">저장 내용</span>
        <span className="w-24 px-3">해시</span>
        <span className="w-24 px-3">시간</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative" style={{ height: rows.length * ROW }}>
          {/* 행 배경 */}
          {rows.map((c, r) => {
            const selected = picking && s.selectedId === c.id;
            const pickable = picking && c.kind !== "wip" && c.kind !== "backup";
            return (
              <div
                key={c.id}
                onClick={() => pickable && s.pick(c.id)}
                className={`absolute inset-x-0 flex items-center ${pickable ? "cursor-pointer hover:bg-hover/60" : ""} ${
                  selected ? "bg-teal/10" : ""
                }`}
                style={{ top: r * ROW, height: ROW }}
              >
                {selected && <span className="absolute inset-y-0 left-0 w-0.5 bg-teal" />}
                {/* 라벨 */}
                <span className="flex items-center justify-end gap-1 pr-2" style={{ width: LABEL_W }}>
                  {labels[c.id]?.map((l) => (
                    <span
                      key={l.text}
                      title={l.remote ? "온라인(GitHub)에 올라가 있는 마지막 저장 지점" : undefined}
                      className={`flex max-w-full items-center gap-1 truncate rounded-[3px] px-1.5 py-[3px] text-[11px] font-medium ${
                        l.remote ? "border border-line text-muted" : "text-white"
                      }`}
                      style={l.remote ? undefined : { background: `color-mix(in srgb, ${LANE_COLORS[l.lane]} 55%, #1a1d21)` }}
                    >
                      {l.remote ? <Cloud size={11} /> : l.head ? <Check size={11} /> : l.lane === 2 ? <LifeBuoy size={11} /> : <GitBranch size={11} />}
                      {l.remote && labels[c.id].length > 1 ? "" : l.text}
                    </span>
                  ))}
                </span>
                <span style={{ width: GRAPH_W }} />
                {/* 메시지 띠 */}
                <span
                  className={`relative flex h-[26px] flex-1 items-center truncate px-3 ${
                    c.kind === "wip" ? "italic" : ""
                  } ${c.broken ? "text-red" : c.kind === "wip" ? "text-muted" : "text-fg"}`}
                >
                  <span
                    className="absolute inset-y-0 left-0 w-full opacity-[0.07]"
                    style={{ background: c.broken ? "var(--color-red)" : LANE_COLORS[c.lane] }}
                  />
                  <span
                    className="absolute inset-y-0 left-0 w-[3px]"
                    style={{ background: c.broken ? "var(--color-red)" : LANE_COLORS[c.lane], opacity: c.kind === "wip" ? 0.4 : 0.9 }}
                  />
                  <span className="relative truncate">{c.kind === "wip" ? `// ${c.msg}` : c.msg}</span>
                  {c.local && !c.pushed && (
                    <span className="relative ml-2 flex shrink-0 items-center gap-0.5 text-[10px] text-amber">
                      <ArrowUp size={10} /> 올리기 전
                    </span>
                  )}
                </span>
                <span className="w-24 px-3 font-mono text-[11px] text-dim">{c.hash}</span>
                <span className="w-24 px-3 text-[11px] text-dim">{c.when}</span>
              </div>
            );
          })}

          {/* 그래프 */}
          <svg
            className="pointer-events-none absolute top-0"
            style={{ left: LABEL_W }}
            width={GRAPH_W}
            height={rows.length * ROW}
          >
            {/* 라벨 → 노드 연결선 */}
            {rows.map((c, r) =>
              labels[c.id] ? (
                <line
                  key={`l-${c.id}`}
                  x1={-4}
                  y1={rowY(r)}
                  x2={laneX(c.lane)}
                  y2={rowY(r)}
                  stroke={LANE_COLORS[labels[c.id][0].lane]}
                  strokeOpacity={0.6}
                />
              ) : null,
            )}
            {edges.map((e, i) => (
              <path
                key={i}
                d={e.d}
                fill="none"
                stroke={e.color}
                strokeWidth={2}
                strokeDasharray={e.dashed ? "3 3" : undefined}
                strokeOpacity={e.dashed ? 0.6 : 1}
              />
            ))}
            {rows.map((c, r) => {
              const x = laneX(c.lane);
              const y = rowY(r);
              const pickable = picking && c.kind !== "wip" && c.kind !== "backup";
              return (
                <g
                  key={c.id}
                  style={{
                    transformOrigin: `${x}px ${y}px`,
                    transform: hover === c.id ? "scale(1.45)" : "scale(1)",
                    transition: "transform 120ms ease-out",
                  }}
                >
                  <Node c={c} x={x} y={y} head={c.id === s.headId} selected={picking && s.selectedId === c.id} />
                  {/* 마우스를 잡기 쉽게 점보다 넓은 투명 영역 */}
                  <circle
                    cx={x}
                    cy={y}
                    r={12}
                    fill="transparent"
                    style={{ pointerEvents: "all", cursor: "pointer" }}
                    onMouseEnter={() => setHover(c.id)}
                    onMouseLeave={() => setHover((h) => (h === c.id ? null : h))}
                    onClick={() => pickable && s.pick(c.id)}
                  />
                </g>
              );
            })}
          </svg>

          {hover && renderCard()}
        </div>
      </div>
    </section>
  );

  // 컴포넌트가 아니라 함수로 그려서, 다시 그릴 때 카드 애니메이션이 반복되지 않게 한다
  function renderCard() {
    const r = rows.findIndex((c) => c.id === hover);
    if (r < 0) return null;
    const c = rows[r];
    const col = c.broken ? "var(--color-red)" : LANE_COLORS[c.lane];
    const ins = insights.get(c.id);
    const d: CardData =
      c.kind === "wip"
        ? {
            short: "",
            subject: c.msg,
            when: "지금",
            color: col,
            events: [
              c.broken
                ? "AI 코딩 도구가 바꾼 뒤 사이트에 오류가 생겼어요. 잘 되던 저장 지점으로 되돌릴 수 있어요"
                : "아직 저장하지 않은 변경이에요. 오른쪽에서 골라 커밋할 수 있어요",
            ],
            fileNames: s.phase === "save" ? s.pending : BROKEN.files,
          }
        : {
            short: c.hash,
            subject: c.msg,
            author: c.id === "mate" ? DEMO_TEAMMATE.author : "나",
            when: c.when,
            color: col,
            events: [
              ...(ins?.events ?? []),
              ...(c.kind === "backup" ? ["되돌리기 전에 망가진 상태를 따로 보관해 둔 곳이에요"] : []),
              ...(c.preview === "after" && !c.broken ? ["이 시점에는 사이트가 잘 동작했어요"] : []),
            ],
            position: ins?.position,
            unpushed: !!c.local && !c.pushed,
            stats: DEMO_STATS[c.id] ?? (c.files ? demoStatsFor(c.files) : []),
          };
    const above = r > 3 && r > rows.length - 7;
    return <CommitCard d={d} x={LABEL_W + laneX(c.lane) + 18} y={rowY(r) + (above ? 14 : -14)} above={above} />;
  }
}

function Node({ c, x, y, head, selected }: { c: Commit; x: number; y: number; head: boolean; selected: boolean }) {
  const color = c.broken ? "var(--color-red)" : LANE_COLORS[c.lane];
  if (c.kind === "wip") {
    return <circle cx={x} cy={y} r={6} fill="#121417" stroke={color} strokeWidth={1.5} strokeDasharray="2.5 2" />;
  }
  if (c.parents.length > 1) {
    return <circle cx={x} cy={y} r={4} fill={color} />;
  }
  return (
    <g>
      {(head || selected) && <circle cx={x} cy={y} r={11} fill={color} opacity={0.18} />}
      <circle cx={x} cy={y} r={7} fill="#121417" stroke={color} strokeWidth={2} />
      <circle cx={x} cy={y} r={2.6} fill={color} />
    </g>
  );
}
