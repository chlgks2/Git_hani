// 시간 기록: 스냅샷 목록. 커밋하지 않은 상태도 그 시점으로 돌아갈 수 있다.
import { useEffect, useState } from "react";
import { Camera, Clock, CloudOff, RotateCcw, Trash2 } from "lucide-react";
import { clockTime, timeAgo } from "../git";
import type { RealRepo } from "./RealRepo";

export default function Timeline({ r }: { r: RealRepo }) {
  const repo = r.repo!;
  const [confirmAll, setConfirmAll] = useState(false);

  // 탭을 열 때 목록을 읽는다 (스냅샷마다 계산이 필요해서 화면을 새로 그릴 때마다 읽지는 않는다)
  useEffect(() => {
    void r.loadSnapshots();
  }, [repo.root]); // r 은 매번 새 객체라 넣지 않는다 (저장소가 바뀔 때만 다시 읽기)

  const list = r.snapshots;

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-base">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-panel px-4 py-2.5">
        <button
          onClick={r.takeSnapshot}
          disabled={r.snapBusy || repo.noCommits || repo.merging}
          title={repo.noCommits ? "첫 저장 지점(커밋)을 만든 뒤에 찍을 수 있어요" : undefined}
          className="flex items-center gap-1.5 rounded-[3px] bg-teal px-3 py-1.5 text-[12px] font-semibold text-[#0b2626] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <Camera size={13} /> {r.snapBusy ? "찍는 중…" : "지금 스냅샷 찍기"}
        </button>
        <span className="flex items-center gap-1 text-[11px] text-dim">
          <CloudOff size={11} /> 스냅샷은 내 컴퓨터에만 저장돼요 · 저장 기록과 GitHub 에는 나타나지 않아요
        </span>
        {list.length > 0 && (
          <span className="ml-auto flex items-center gap-2 text-[11px]">
            <span className="text-dim">스냅샷 {list.length}개</span>
            {confirmAll ? (
              <>
                <button onClick={() => r.deleteSnapshots([]).then(() => setConfirmAll(false))} className="text-red hover:underline">
                  정말 모두 지우기
                </button>
                <button onClick={() => setConfirmAll(false)} className="text-dim hover:text-muted">
                  취소
                </button>
              </>
            ) : (
              <button onClick={() => setConfirmAll(true)} className="text-dim hover:text-red">
                모두 지우기
              </button>
            )}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {repo.files.length > 0 && (
          <div className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5 text-[12px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-dashed border-muted" />
            <span className="text-fg">지금</span>
            <span className="text-dim">저장 안 된 변경 {repo.files.length}개 — 찍어 두면 이 상태로 언제든 돌아올 수 있어요</span>
          </div>
        )}

        {list.length === 0 ? (
          <div className="mx-auto max-w-md space-y-2 px-6 py-12 text-center">
            <Clock size={22} className="mx-auto text-dim" />
            <div className="text-[13px] text-muted">아직 스냅샷이 없어요</div>
            <p className="text-[12px] leading-relaxed text-dim">
              AI 에게 큰 수정을 맡기기 전처럼 "지금 상태를 남겨 두고 싶을 때" 스냅샷을 찍어 두세요. 커밋하지 않아도, 나중에 이 시간
              기록에서 그 순간으로 돌아올 수 있어요.
            </p>
          </div>
        ) : (
          <ol className="relative">
            {list.map((s, i) => (
              <li key={s.id} className="group relative flex gap-3 border-b border-line-soft px-4 py-3 hover:bg-hover/40">
                {/* 세로 줄 + 점 */}
                <span className="relative flex w-3 shrink-0 justify-center">
                  {i < list.length - 1 && <span className="absolute top-4 -bottom-3 w-px bg-line" />}
                  <span className={`mt-1 h-2.5 w-2.5 rounded-full ${s.kind === "auto" ? "bg-dim" : "bg-teal"}`} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[13px] font-medium text-fg">{clockTime(s.time)}</span>
                    <span className="text-[11px] text-dim">{timeAgo(s.time)}</span>
                    <span
                      className={`rounded-[2px] px-1.5 text-[10px] ${s.kind === "auto" ? "bg-hover text-muted" : "bg-teal/15 text-teal"}`}
                    >
                      {s.kind === "auto" ? "자동" : "직접 찍음"}
                    </span>
                  </div>
                  <div className="mt-1 text-[12px] text-muted">
                    {s.fileCount > 0 ? (
                      <>
                        파일 {s.fileCount}개 바뀜 ·{" "}
                        <span className="font-mono text-[11px] text-fg/80">
                          {s.files.slice(0, 4).join(", ")}
                          {s.fileCount > 4 && ` 외 ${s.fileCount - 4}개`}
                        </span>
                      </>
                    ) : (
                      "바뀐 파일 없음"
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-dim">저장 지점 “{s.headSubject}” 이후</div>
                  {s.skippedLarge.length > 0 && (
                    <div className="mt-0.5 text-[11px] text-amber/80">너무 커서 빼고 찍은 파일: {s.skippedLarge.join(", ")}</div>
                  )}
                </div>
                <div className="flex shrink-0 items-start gap-1.5 opacity-80 group-hover:opacity-100">
                  <button
                    onClick={() => r.askRestore(s.hash, null, s.time)}
                    disabled={repo.merging}
                    className="flex items-center gap-1 rounded-[3px] border border-teal/50 px-2 py-1 text-[11px] text-teal hover:bg-teal/10 disabled:opacity-30"
                  >
                    <RotateCcw size={11} /> 이 때로 돌아가기
                  </button>
                  <button onClick={() => r.deleteSnapshots([s.id])} className="rounded-[3px] p-1 text-dim hover:text-red" title="이 스냅샷 지우기">
                    <Trash2 size={12} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
