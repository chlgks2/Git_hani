import { ArrowRight, FolderOpen, GitBranch, Monitor, RotateCcw, Sparkles, X } from "lucide-react";
import { useRef, useState } from "react";
import { useScenario } from "./store";
import Splitter, { clamp } from "./components/Splitter";
import TitleBar from "./components/TitleBar";
import Explorer from "./components/Explorer";
import GitGraph from "./components/GitGraph";
import Terminal from "./components/Terminal";
import Inspector from "./components/Inspector";
import { ConfirmRestoreModal, DoneModal, SafetyModal } from "./components/Modals";
import { RealExplorer, RealInspector, RealMain, useRealRepo } from "./components/RealRepo";
import { isDesktop } from "./git";

export default function App() {
  const s = useScenario();
  const r = useRealRepo();
  const real = r.repo;
  const [termH, setTermH] = useState(340);
  const startTermH = useRef(0);
  const termSplitter = (
    <Splitter
      dir="y"
      onStart={() => (startTermH.current = termH)}
      onDrag={(d) => setTermH(clamp(startTermH.current - d, 150, window.innerHeight - 260))}
    />
  );

  return (
    <>
    <div className="narrow-note hidden h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <Monitor size={28} className="text-teal" />
      <div className="text-[15px] font-semibold text-fg">PC 화면에서 열어주세요</div>
      <p className="max-w-xs text-[13px] leading-relaxed text-muted">
        Git GUI 프로토타입은 데스크톱 앱 화면이라 가로 폭이 넓은 화면(약 1100px 이상)에서 제대로 보여요.
      </p>
      <div className="font-mono text-[11px] text-dim">Git GUI _ by 최한</div>
    </div>
    <div className="app flex h-full flex-col">
      {/* 상단 띠 */}
      <div className="flex h-8 shrink-0 items-center gap-3 border-b border-line bg-base px-4 text-[12px]">
        <span className="font-mono text-[12px] text-muted">
          Git GUI <span className="text-dim">_</span> by <span className="text-fg">최한</span>
        </span>
        {real ? (
          <>
            <span className="truncate font-mono text-[11px] text-dim">{real.root}</span>
            <button onClick={r.close} className="ml-auto flex items-center gap-1 text-[11px] text-muted hover:text-fg">
              <X size={11} /> 저장소 닫고 데모 보기
            </button>
          </>
        ) : (
          <>
        {isDesktop() && (
          <button onClick={r.open} className="flex items-center gap-1 text-[11px] text-teal/80 hover:text-teal">
            <FolderOpen size={11} /> 내 저장소 열기
          </button>
        )}
        {s.phase === "save" && (
          <button
            onClick={s.goBroken}
            disabled={!s.canNext}
            title={s.canNext ? undefined : "바뀐 파일을 모두 저장하면 넘어갈 수 있어요"}
            className="ml-auto flex items-center gap-1 rounded-[3px] border border-amber/40 px-2 py-0.5 text-[11px] text-amber hover:bg-amber/15 disabled:cursor-not-allowed disabled:opacity-35"
          >
            다음 과제 <ArrowRight size={11} />
          </button>
        )}
        <button
          onClick={s.reset}
          className={`${s.phase === "save" ? "" : "ml-auto"} flex items-center gap-1 text-[11px] text-amber/70 hover:text-amber`}
        >
          <RotateCcw size={11} /> 처음부터
        </button>
          </>
        )}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <TitleBar s={s} r={r} />
        {real ? (
          <div className="flex min-h-0 flex-1">
            <RealExplorer r={r} />
            <main className="flex min-w-0 flex-1 flex-col">
              <RealMain r={r} termH={termH} splitter={termSplitter} />
            </main>
            <RealInspector r={r} />
          </div>
        ) : (
        <div className="flex min-h-0 flex-1">
          <Explorer s={s} />
          <main className="flex min-w-0 flex-1 flex-col">
            <GitGraph s={s} />
            {termSplitter}
            <Terminal s={s} height={termH} />
          </main>
          <Inspector s={s} />
        </div>
        )}

        {/* 상태 표시줄 */}
        <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-line bg-panel px-3 font-mono text-[10px] text-dim">
          <span className="flex items-center gap-1 text-green">
            <GitBranch size={10} /> {real ? (real.branch ?? "-") : "main"}
          </span>
          {(() => {
            const n = real ? real.files.length : s.changeCount;
            return <span className={n ? "text-amber" : ""}>{n ? `● ${n} 변경` : "✓ 깨끗함"}</span>;
          })()}
          {!real && <span className="text-dim">데모</span>}
          {!real && (
            <span className="flex items-center gap-1 text-[#b9a6f5]">
              <Sparkles size={10} /> AI 도우미 연결됨
            </span>
          )}
          <span className="ml-auto font-sans">회색 영어 단어에 마우스를 올리면 개발 용어의 뜻을 알려드려요</span>
        </footer>

        {!real && s.safety && <SafetyModal s={s} />}
        {s.phase === "restore" && s.restoreStep === "confirm" && <ConfirmRestoreModal s={s} />}
        {s.phase === "done" && <DoneModal s={s} />}
      </div>
    </div>
    </>
  );
}
