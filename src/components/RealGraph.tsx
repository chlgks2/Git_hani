// 실제 저장소의 저장 기록 그래프 (git log)
import { useMemo, useState } from "react";
import { ArrowUp, Check, Cloud, GitBranch, Tag } from "lucide-react";
import { timeAgo, type CommitInfo, type UnpushedCommit } from "../git";
import { layoutGraph } from "../graphLayout";
import { GitChip } from "./Term";

const ROW = 30;
const LANE_W = 16;
const LABEL_W = 170;
const COLORS = ["#2ec4c4", "#d45ce0", "#e8a33d", "#5b9cf5", "#58c47c", "#ef6b6b", "#a78bfa", "#f472b6"];
const color = (lane: number) => COLORS[lane % COLORS.length];
const laneX = (l: number) => 14 + l * LANE_W;
const rowY = (r: number) => r * ROW + ROW / 2;

const WIP = "__wip__";

interface Label {
  text: string;
  kind: "head" | "local" | "remote" | "tag" | "detached";
  synced?: boolean; // 같은 이름의 온라인 갈래도 여기 있음
}

/** "HEAD -> refs/heads/main" 같은 이름들을 화면용 라벨로 바꾼다 */
function parseRefs(refs: string[]): Label[] {
  const out: Label[] = [];
  const remotes: string[] = [];
  for (const r of refs) {
    if (r === "HEAD") out.push({ text: "HEAD", kind: "detached" });
    else if (r.startsWith("HEAD -> refs/heads/")) out.push({ text: r.slice(19), kind: "head" });
    else if (r.startsWith("refs/heads/")) out.push({ text: r.slice(11), kind: "local" });
    else if (r.startsWith("tag: refs/tags/")) out.push({ text: r.slice(15), kind: "tag" });
    else if (r.startsWith("refs/remotes/") && !r.endsWith("/HEAD")) remotes.push(r.slice(13));
  }
  for (const rm of remotes) {
    // origin/main 과 main 이 같은 곳에 있으면 main 라벨에 구름 표시만 붙인다
    const local = out.find((l) => (l.kind === "head" || l.kind === "local") && rm.split("/").slice(1).join("/") === l.text);
    if (local) local.synced = true;
    else out.push({ text: rm, kind: "remote" });
  }
  return out;
}

export default function RealGraph({
  commits,
  changeCount,
  unpushed,
}: {
  commits: CommitInfo[];
  changeCount: number;
  unpushed: UnpushedCommit[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const notPushed = useMemo(() => new Set(unpushed.map((c) => c.hash)), [unpushed]);

  const { rows, layout } = useMemo(() => {
    const head = commits.find((c) => c.refs.some((r) => r === "HEAD" || r.startsWith("HEAD -> ")));
    const rows: (CommitInfo & { wip?: boolean })[] = changeCount
      ? [
          {
            hash: WIP,
            short: "",
            parents: head ? [head.hash] : [],
            author: "",
            time: Date.now() / 1000,
            refs: [],
            subject: `저장 안 된 변경 ${changeCount}개`,
            wip: true,
          },
          ...commits,
        ]
      : commits;
    return { rows, layout: layoutGraph(rows) };
  }, [commits, changeCount]);

  const graphW = Math.max(60, laneX(layout.laneCount - 1) + 22);
  const height = rows.length * ROW;

  if (!rows.length) {
    return (
      <section className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-base text-center">
        <GitBranch size={22} className="text-dim" />
        <div className="text-[13px] text-muted">아직 저장 지점이 없어요</div>
        <div className="text-[12px] text-dim">오른쪽에서 파일을 골라 첫 저장(커밋)을 해 보세요</div>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-base">
      <div className="flex h-8 shrink-0 items-center border-b border-line bg-panel text-[11px] text-dim">
        <span className="px-3" style={{ width: LABEL_W }}>갈래</span>
        <span style={{ width: graphW }} className="flex items-center gap-1.5">
          그래프 <GitChip term="graph" />
        </span>
        <span className="flex-1 px-3">저장 내용</span>
        <span className="w-28 px-3">작성자</span>
        <span className="w-20 px-3">해시</span>
        <span className="w-24 px-3">시간</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="relative" style={{ height, minWidth: LABEL_W + graphW + 400 }}>
          {rows.map((c, r) => {
            const lane = layout.lanes[r];
            const labels = parseRefs(c.refs);
            const isSel = selected === c.hash;
            return (
              <div
                key={c.hash}
                onClick={() => setSelected(isSel ? null : c.hash)}
                className={`absolute inset-x-0 flex cursor-default items-center hover:bg-hover/50 ${isSel ? "bg-teal/10" : ""}`}
                style={{ top: r * ROW, height: ROW }}
              >
                {isSel && <span className="absolute inset-y-0 left-0 w-0.5 bg-teal" />}
                <span className="flex items-center justify-end gap-1 overflow-hidden pr-2" style={{ width: LABEL_W }}>
                  {labels.slice(0, 2).map((l) => (
                    <RefChip key={l.kind + l.text} l={l} lane={lane} />
                  ))}
                  {labels.length > 2 && <span className="text-[10px] text-dim">+{labels.length - 2}</span>}
                </span>
                <span style={{ width: graphW }} className="shrink-0" />
                <span
                  className={`relative flex h-[24px] min-w-0 flex-1 items-center px-3 ${c.wip ? "text-muted italic" : "text-fg"}`}
                  title={c.subject}
                >
                  <span className="absolute inset-y-0 left-0 w-full opacity-[0.06]" style={{ background: color(lane) }} />
                  <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color(lane), opacity: c.wip ? 0.4 : 0.9 }} />
                  <span className="relative truncate">{c.wip ? `// ${c.subject}` : c.subject}</span>
                  {notPushed.has(c.hash) && (
                    <span className="relative ml-2 flex shrink-0 items-center gap-0.5 text-[10px] text-amber" title="아직 온라인에 올리지 않은 저장 지점">
                      <ArrowUp size={10} /> 올리기 전
                    </span>
                  )}
                </span>
                <span className="w-28 truncate px-3 text-[11px] text-dim">{c.author}</span>
                <span className="w-20 px-3 font-mono text-[11px] text-dim">{c.short}</span>
                <span className="w-24 px-3 text-[11px] text-dim">{c.wip ? "지금" : timeAgo(c.time)}</span>
              </div>
            );
          })}

          <svg className="pointer-events-none absolute top-0" style={{ left: LABEL_W }} width={graphW} height={height}>
            {layout.edges.map((e, i) => (
              <path
                key={i}
                d={edgePath(e.fromRow, e.toRow, e.fromLane, e.viaLane, e.toLane, height)}
                fill="none"
                stroke={color(e.viaLane)}
                strokeWidth={2}
                strokeDasharray={rows[e.fromRow].wip ? "3 3" : undefined}
                strokeOpacity={rows[e.fromRow].wip ? 0.6 : 1}
              />
            ))}
            {rows.map((c, r) => {
              const x = laneX(layout.lanes[r]);
              const y = rowY(r);
              const col = color(layout.lanes[r]);
              if (c.wip) return <circle key={c.hash} cx={x} cy={y} r={6} fill="#121417" stroke={col} strokeWidth={1.5} strokeDasharray="2.5 2" />;
              if (c.parents.length > 1) return <circle key={c.hash} cx={x} cy={y} r={4} fill={col} />;
              const isHead = c.refs.some((ref) => ref === "HEAD" || ref.startsWith("HEAD -> "));
              return (
                <g key={c.hash}>
                  {isHead && <circle cx={x} cy={y} r={10} fill={col} opacity={0.2} />}
                  <circle cx={x} cy={y} r={6} fill="#121417" stroke={col} strokeWidth={2} />
                  <circle cx={x} cy={y} r={2.3} fill={col} />
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </section>
  );
}

/** 부모로 이어지는 선: 필요하면 출발 직후 지나갈 레인으로 꺾고, 도착 직전에 부모 레인으로 꺾는다 */
function edgePath(fromRow: number, toRow: number | null, fromLane: number, via: number, toLane: number, bottom: number) {
  const xc = laneX(fromLane), yc = rowY(fromRow);
  const xe = laneX(via);
  const xp = laneX(toLane), yp = toRow == null ? bottom : rowY(toRow);
  const startBend = fromLane !== via;
  const endBend = toRow != null && toLane !== via;
  const y1 = yc + (startBend ? ROW : 0);
  const y2 = yp - (endBend ? ROW : 0);

  if (y2 < y1) {
    // 바로 아래 행으로 꺾어 들어가는 짧은 선
    const m = (yc + yp) / 2;
    return `M${xc},${yc} C${xc},${m} ${xp},${m} ${xp},${yp}`;
  }
  let d = `M${xc},${yc}`;
  if (startBend) d += ` C${xc},${(yc + y1) / 2} ${xe},${(yc + y1) / 2} ${xe},${y1}`;
  d += ` L${xe},${y2}`;
  if (endBend) d += ` C${xe},${(y2 + yp) / 2} ${xp},${(y2 + yp) / 2} ${xp},${yp}`;
  return d;
}

function RefChip({ l, lane }: { l: Label; lane: number }) {
  const base = "flex max-w-[150px] shrink-0 items-center gap-1 truncate rounded-[3px] px-1.5 py-[2px] text-[11px] font-medium";
  if (l.kind === "remote")
    return (
      <span className={`${base} border border-line text-muted`} title={`온라인 갈래 ${l.text}`}>
        <Cloud size={11} /> {l.text}
      </span>
    );
  if (l.kind === "tag")
    return (
      <span className={`${base} border border-amber/40 text-amber`}>
        <Tag size={11} /> {l.text}
      </span>
    );
  return (
    <span
      className={`${base} text-white`}
      style={{ background: `color-mix(in srgb, ${color(lane)} 55%, #1a1d21)` }}
      title={l.synced ? "온라인과 같은 위치" : undefined}
    >
      {l.kind === "head" || l.kind === "detached" ? <Check size={11} /> : <GitBranch size={11} />}
      <span className="truncate">{l.text}</span>
      {l.synced && <Cloud size={11} className="opacity-80" />}
    </span>
  );
}
