import { useState } from "react";
import { KeyRound, LifeBuoy, RotateCcw } from "lucide-react";
import type { Scenario } from "../store";
import { Primary } from "./Inspector";

function Shell({ children, accent }: { children: React.ReactNode; accent: string }) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55">
      <div className="rise w-[460px] border border-line bg-panel shadow-2xl shadow-black/60" style={{ borderTop: `2px solid ${accent}` }}>
        {children}
      </div>
    </div>
  );
}

export function SafetyModal({ s }: { s: Scenario }) {
  const [ignore, setIgnore] = useState(true);
  const sf = s.safety;
  if (!sf) return null;

  if (sf.kind === "push") {
    return (
      <Shell accent="var(--color-red)">
        <div className="p-5">
          <div className="flex items-center gap-2 text-[11px] font-medium tracking-wide text-red">
            <KeyRound size={13} /> 올리기 전 확인
          </div>
          <h3 className="mt-2 text-[16px] font-semibold text-fg">API 키가 담긴 저장 지점이 함께 올라가요</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            <span className="font-mono text-dim">{sf.secret.hash}</span> “{sf.secret.msg}” 에{" "}
            <code className="font-mono text-fg">.env</code> 파일이 들어 있어요.
          </p>
          <p className="mt-3 text-[12px] leading-relaxed text-red/90">
            GitHub에 올리면 다른 사람이 키를 볼 수 있고, 한 번 올라간 키는 지워도 기록에 남아요. 올렸다면 키를 새로
            발급받는 게 안전해요.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-line-soft p-4">
          <button onClick={() => s.push(sf.upToId, { force: true })} className="px-3 text-[12px] text-dim hover:text-red">
            그래도 올리기
          </button>
          <div className="w-28">
            <Primary onClick={s.cancelSafety}>올리지 않기</Primary>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell accent="var(--color-amber)">
      <div className="p-5">
        <div className="flex items-center gap-2 text-[11px] font-medium tracking-wide text-amber">
          <KeyRound size={13} /> 저장 전 확인
        </div>
        <h3 className="mt-2 text-[16px] font-semibold text-fg">비밀 정보가 들어 있는 파일이 있어요</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          <code className="font-mono text-fg">.env</code> 파일에 <span className="text-fg">지도 서비스 API 키</span>가
          들어 있어요. 이 키는 비밀번호 같은 거예요.
        </p>
        <pre className="mt-3 border border-line-soft bg-base px-3 py-2 font-mono text-[11px] text-dim">
          <span className="text-muted">MAP_API_KEY</span>=sk-live-8f3a••••••••••••2c91
        </pre>
        <p className="mt-3 text-[12px] leading-relaxed text-amber/90">
          나중에 온라인(GitHub)에 올리면 다른 사람이 이 키를 볼 수 있고, 내 계정으로 요금이 청구될 수 있어요.
        </p>
        <label className="mt-4 flex cursor-pointer items-start gap-2 text-[12px] text-muted">
          <input type="checkbox" checked={ignore} onChange={(e) => setIgnore(e.target.checked)} className="mt-0.5 accent-[#2ec4c4]" />
          <span>
            앞으로도 이 파일은 항상 빼고 저장하기 <span className="font-mono text-[10px] text-dim">.gitignore</span>
          </span>
        </label>
      </div>
      <div className="flex flex-col gap-1 border-t border-line-soft p-4">
        <Primary onClick={() => s.resolveCommitSafety(true, ignore)}>이 파일은 빼고 저장하기 (권장)</Primary>
        <button onClick={() => s.resolveCommitSafety(false, false)} className="py-1.5 text-[12px] text-dim hover:text-muted">
          그래도 포함해서 저장할게요
        </button>
        <button onClick={s.cancelSafety} className="py-1 text-[11px] text-dim hover:text-muted">
          취소
        </button>
      </div>
    </Shell>
  );
}

export function ConfirmRestoreModal({ s }: { s: Scenario }) {
  const sel = s.commits.find((c) => c.id === s.selectedId);
  if (!sel) return null;
  return (
    <Shell accent="var(--color-teal)">
      <div className="p-5">
        <div className="flex items-center gap-2 text-[11px] font-medium tracking-wide text-teal">
          <RotateCcw size={13} /> 되돌리기
        </div>
        <h3 className="mt-2 text-[16px] font-semibold text-fg">“{sel.msg}” 상태로 되돌릴까요?</h3>
        <p className="mt-1 text-[12px] text-muted">
          {sel.when}에 저장한 모습으로 파일이 바뀌어요. <span className="font-mono text-dim">{sel.hash}</span>
        </p>
        <div className="mt-4 flex items-start gap-2.5 border-l-2 border-green/60 pl-3 text-[12px] leading-relaxed text-muted">
          <LifeBuoy size={14} className="mt-0.5 shrink-0 text-green" />
          <span>
            <span className="text-fg">지금 상태는 지워지지 않아요.</span> ‘되돌리기 전 백업’ 갈래로 따로 보관해서, 마음이
            바뀌면 언제든 다시 돌아올 수 있어요.
          </span>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-line-soft p-4">
        <button onClick={s.cancelConfirm} className="px-4 text-[12px] text-dim hover:text-muted">
          취소
        </button>
        <div className="w-32">
          <Primary onClick={s.doRestore}>되돌리기</Primary>
        </div>
      </div>
    </Shell>
  );
}

export function DoneModal({ s }: { s: Scenario }) {
  const t = s.timers.current;
  const sec = (a: number, b: number) => (b > a ? `${Math.round((b - a) / 1000)}초` : "-");
  const pushed = s.local.filter((c) => c.pushed && c.id !== "revert").length;
  const made = s.local.filter((c) => c.id !== "revert").length;
  const rows: [string, string, string?][] = [
    ["첫 커밋까지 걸린 시간", sec(t.t1Start, t.firstCommit)],
    ["첫 올리기까지 걸린 시간", sec(t.t1Start, t.firstPush)],
    ["만든 저장 지점 / 올린 수", `${made} / ${pushed}`],
    [
      ".env 처리",
      s.envChoice === "excluded" ? "빼고 저장" : s.envChoice === "included" ? "포함해서 저장" : "직접 체크 해제",
      s.envChoice === "included" ? "text-amber" : "text-green",
    ],
    ["앞으로 자동 제외 (.gitignore)", s.envIgnored ? "예" : "아니오"],
    ["과제 2 · 되돌리기까지 걸린 시간", sec(t.t2Start, t.t2End)],
    ["과제 3 · 충돌 해결까지 걸린 시간", sec(t.t3Start, t.t3End)],
  ];
  return (
    <Shell accent="var(--color-green)">
      <div className="p-5">
        <div className="text-[11px] font-medium tracking-wide text-green">테스트 완료</div>
        <h3 className="mt-2 text-[16px] font-semibold text-fg">수고하셨습니다</h3>
        <p className="mt-1 text-[12px] text-dim">아래 기록은 진행자가 확인하는 용도예요.</p>
        <table className="mt-4 w-full font-mono text-[12px]">
          <tbody>
            {rows.map(([k, v, tone]) => (
              <tr key={k} className="border-b border-line-soft last:border-0">
                <td className="py-2 font-sans text-muted">{k}</td>
                <td className={`py-2 text-right ${tone ?? "text-fg"}`}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-line-soft p-4">
        <Primary onClick={s.reset}>처음부터 다시</Primary>
      </div>
    </Shell>
  );
}
