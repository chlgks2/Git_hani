import { ChevronDown, ChevronRight, CloudDownload, CloudUpload, FolderOpen, GitBranch, Minus, Redo2, Save, Square, Undo2, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { REPO } from "../data";
import type { Scenario } from "../store";
import { isDesktop } from "../git";
import type { RealRepo } from "./RealRepo";

export default function TitleBar({ s, r }: { s: Scenario; r: RealRepo }) {
  const real = r.repo;
  const canCommit = !real && s.canCommit;
  const canPush = !real && s.unpushed.length > 0 && !s.pushing;
  const canRevert = !real && s.phase === "restore" && s.restoreStep === "broken";
  // 실제 저장소 모드에서는 아직 연결 안 된 버튼이 데모 동작을 하지 않게 막는다
  const demo = (fn: () => void) => (real ? undefined : fn);

  return (
    <div className="flex h-14 shrink-0 items-stretch border-b border-line bg-panel select-none">
      <button
        onClick={r.open}
        disabled={!isDesktop()}
        title={isDesktop() ? "저장소 폴더 열기" : "데스크톱 앱에서만 실제 폴더를 열 수 있어요"}
        className="flex w-12 items-center justify-center border-r border-line text-muted hover:bg-hover hover:text-teal disabled:cursor-not-allowed disabled:opacity-40"
      >
        <FolderOpen size={17} />
      </button>

      <Crumb label={real ? "저장소" : "저장소 · 데모"} value={real ? real.name : REPO} onClick={isDesktop() ? r.open : undefined} />
      <div className="flex items-center text-dim">
        <ChevronRight size={16} />
      </div>
      <Crumb label="갈래" value={real ? (real.branch ?? "(갈래 없음)") : "main"} icon />

      <div className="ml-auto flex items-stretch">
        <Tool icon={Undo2} label="되돌리기" git="undo" onClick={demo(() => s.openPick())} active={canRevert} />
        <Tool icon={Redo2} label="다시하기" git="redo" />
        <Tool
          icon={CloudDownload}
          label="받아오기"
          git="pull"
          onClick={real ? () => r.pull() : undefined}
          active={!!real && r.incoming.length > 0 && !r.pulling}
          badge={(real && r.incoming.length) || undefined}
        />
        <Tool icon={CloudUpload} label="올리기" git="push" onClick={real ? () => r.push() : () => s.push()}
          active={real ? r.unpushed.length > 0 && !r.pushing : canPush}
          badge={(real ? r.unpushed.length : s.unpushed.length) || undefined} />
        <Tool icon={GitBranch} label="갈래" git="branch" />
        <Tool icon={Save} label="저장" git="commit" onClick={demo(() => s.commit())} active={canCommit} />
        {/* 브라우저 데모에서만 보이는 창 버튼 장식. 데스크톱 앱은 Windows 기본 창 버튼을 쓴다 */}
        {!isDesktop() && (
        <div className="ml-2 flex items-start border-l border-line text-dim">
          <span className="flex h-8 w-11 items-center justify-center hover:bg-hover"><Minus size={14} /></span>
          <span className="flex h-8 w-11 items-center justify-center hover:bg-hover"><Square size={11} /></span>
          <span className="flex h-8 w-11 items-center justify-center hover:bg-red-600 hover:text-white"><X size={15} /></span>
        </div>
        )}
      </div>
    </div>
  );
}

function Crumb({ label, value, icon, onClick }: { label: string; value: string; icon?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col justify-center px-4 text-left hover:bg-hover">
      <span className="text-[10px] text-dim">{label}</span>
      <span className="flex items-center gap-1 text-[15px] font-medium text-fg">
        {icon && <GitBranch size={13} className="text-teal" />}
        {value}
        <ChevronDown size={13} className="text-dim" />
      </span>
    </button>
  );
}

function Tool({
  icon: Icon,
  label,
  git,
  onClick,
  active,
  badge,
}: {
  icon: LucideIcon;
  label: string;
  git: string;
  onClick?: () => void;
  active?: boolean;
  badge?: number;
}) {
  return (
    <div className="relative flex">
      <button
        onClick={onClick}
        className={`flex w-16 flex-col items-center justify-center gap-0.5 hover:bg-hover ${active ? "text-teal" : "text-muted"}`}
      >
        <Icon size={16} strokeWidth={1.75} />
        <span className="text-[11px] leading-tight">{label}</span>
        <span className="font-mono text-[9px] leading-none text-dim">{git}</span>
      </button>
      {badge ? (
        <span className="absolute top-1.5 right-2.5 rounded-full bg-amber px-1 font-mono text-[9px] leading-[14px] font-bold text-[#2a1a00]">
          {badge}
        </span>
      ) : (
        active && <span className="absolute top-2 right-3 h-1.5 w-1.5 rounded-full bg-teal" />
      )}
    </div>
  );
}
