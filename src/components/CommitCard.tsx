// 그래프의 점에 마우스를 올리면 뜨는 요약 카드
import { ArrowDown, ArrowUp, FileText, GitMerge, MapPin, Sparkles } from "lucide-react";
import type { FileStat } from "../git";

export interface CardData {
  short: string;
  subject: string;
  author?: string;
  when: string;
  color: string;
  events: string[];
  position?: string;
  unpushed?: boolean;
  incoming?: boolean;
  /** 카드 맨 아래 작은 안내 */
  hint?: string;
  /** undefined: 표시 안 함, "loading": 불러오는 중 */
  stats?: FileStat[] | "loading";
  /** 저장 안 된 변경 줄처럼 줄 수 없이 파일 이름만 보여줄 때 */
  fileNames?: string[];
}

const MAX_FILES = 5;

export default function CommitCard({ d, x, y, above }: { d: CardData; x: number; y: number; above: boolean }) {
  const stats = Array.isArray(d.stats) ? d.stats : null;
  const add = stats?.reduce((n, f) => n + (f.added ?? 0), 0) ?? 0;
  const del = stats?.reduce((n, f) => n + (f.deleted ?? 0), 0) ?? 0;

  return (
    <div
      className="rise pointer-events-none absolute z-30 w-[300px] border border-line bg-raised text-left shadow-xl shadow-black/50"
      style={{ left: x, top: y, transform: above ? "translateY(-100%)" : undefined, borderLeft: `3px solid ${d.color}` }}
    >
      <div className="px-3 pt-2.5 pb-2">
        <div className="flex items-center gap-2 font-mono text-[10px] text-dim">
          {d.short && <span>{d.short}</span>}
          {d.author && <span className="truncate font-sans">{d.author}</span>}
          <span className="ml-auto shrink-0 font-sans">{d.when}</span>
        </div>
        <div className="mt-1 text-[13px] leading-snug font-medium text-fg">{d.subject}</div>
      </div>

      {(d.events.length > 0 || d.position || d.unpushed || d.incoming) && (
        <ul className="space-y-1 border-t border-line-soft px-3 py-2 text-[12px] leading-snug">
          {d.events.map((e) => (
            <li key={e} className="flex gap-1.5 text-fg/90">
              {e.includes("합쳤") ? (
                <GitMerge size={12} className="mt-0.5 shrink-0 text-magenta" />
              ) : (
                <Sparkles size={12} className="mt-0.5 shrink-0 text-[#b9a6f5]" />
              )}
              {e}
            </li>
          ))}
          {d.position && (
            <li className="flex gap-1.5 text-muted">
              <MapPin size={12} className="mt-0.5 shrink-0 text-dim" />
              {d.position}
            </li>
          )}
          {d.unpushed && (
            <li className="flex gap-1.5 text-amber">
              <ArrowUp size={12} className="mt-0.5 shrink-0" />
              아직 온라인에 올리지 않았어요
            </li>
          )}
          {d.incoming && (
            <li className="flex gap-1.5 text-blue">
              <ArrowDown size={12} className="mt-0.5 shrink-0" />
              온라인에만 있고 아직 받아오지 않았어요
            </li>
          )}
        </ul>
      )}

      {d.stats !== undefined && (
        <div className="border-t border-line-soft px-3 py-2">
          {d.stats === "loading" ? (
            <div className="text-[11px] text-dim">바뀐 내용 불러오는 중…</div>
          ) : (
            <>
              <div className="mb-1 flex items-center gap-2 text-[11px] text-muted">
                파일 {stats!.length}개 바뀜
                <span className="ml-auto font-mono">
                  <span className="text-green">+{add}</span> <span className="text-red">−{del}</span>
                </span>
              </div>
              <ul className="space-y-0.5 font-mono text-[11px]">
                {stats!.slice(0, MAX_FILES).map((f) => (
                  <li key={f.path} className="flex gap-2">
                    <span className="min-w-0 flex-1 truncate text-fg/80">{f.path}</span>
                    {f.added == null ? (
                      <span className="text-dim">바이너리</span>
                    ) : (
                      <span className="shrink-0">
                        <span className="text-green">+{f.added}</span> <span className="text-red">−{f.deleted}</span>
                      </span>
                    )}
                  </li>
                ))}
                {stats!.length > MAX_FILES && <li className="text-dim">… 외 {stats!.length - MAX_FILES}개</li>}
              </ul>
            </>
          )}
        </div>
      )}

      {d.hint && <div className="border-t border-line-soft px-3 py-1.5 text-[10px] text-dim">{d.hint}</div>}

      {d.fileNames && (
        <ul className="space-y-0.5 border-t border-line-soft px-3 py-2 font-mono text-[11px] text-fg/80">
          {d.fileNames.slice(0, MAX_FILES).map((f) => (
            <li key={f} className="flex items-center gap-1.5 truncate">
              <FileText size={11} className="shrink-0 text-dim" /> {f}
            </li>
          ))}
          {d.fileNames.length > MAX_FILES && <li className="text-dim">… 외 {d.fileNames.length - MAX_FILES}개</li>}
        </ul>
      )}
    </div>
  );
}
