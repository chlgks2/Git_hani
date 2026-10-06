// 쉬운 말 옆에 Git 용어를 작게 같이 보여주고, 마우스를 올리면 뜻을 설명한다.

export const GLOSSARY: Record<string, string> = {
  commit: "지금 파일 상태를 하나의 ‘저장 지점’으로 기록해요. 나중에 이 시점으로 돌아올 수 있어요.",
  changes: "마지막 저장 이후에 바뀐 파일들이에요.",
  diff: "파일에서 어떤 줄이 추가(+)되고 지워졌는지(-) 보여줘요.",
  graph: "저장 지점들이 어떤 순서로, 어떤 갈래로 쌓였는지 보여주는 지도예요.",
  revert: "예전 저장 지점의 상태로 파일을 되돌려요.",
  branch: "원본을 건드리지 않고 따로 실험하는 갈래예요. 실험이 끝나면 합칠(merge) 수 있어요.",
  ".gitignore": "저장·공유할 때 항상 빼둘 파일 목록이에요. 비밀번호나 키가 든 파일을 여기에 넣어요.",
  push: "내 컴퓨터의 저장 지점을 온라인(GitHub)에 올려요.",
  pull: "온라인에 있는 최신 저장 지점을 내 컴퓨터로 받아와요.",
  undo: "방금 한 작업을 취소해요.",
};

export function GitChip({ term, className = "" }: { term: string; className?: string }) {
  const tip = GLOSSARY[term.toLowerCase()];
  return (
    <span className={`group relative inline-flex ${className}`}>
      <span className="cursor-help font-mono text-[10px] leading-none text-dim decoration-dotted underline-offset-2 group-hover:text-muted group-hover:underline">
        {term}
      </span>
      {tip && (
        <span className="pointer-events-none absolute top-full left-0 z-50 mt-1.5 w-56 border border-line bg-raised px-2.5 py-2 text-left text-[11px] leading-relaxed font-normal whitespace-normal text-fg opacity-0 shadow-lg shadow-black/40 transition-opacity delay-150 group-hover:opacity-100">
          <span className="mb-0.5 block font-mono text-[10px] text-teal">git {term}</span>
          {tip}
        </span>
      )}
    </span>
  );
}
