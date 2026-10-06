// 경계선을 드래그해서 패널 크기를 바꾸는 손잡이.
// dir="x" 는 좌우(폭), dir="y" 는 위아래(높이) 조절. onDrag 에는 시작점부터 움직인 거리(px)가 들어온다.
import { useState } from "react";

export function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export default function Splitter({
  dir,
  onStart,
  onDrag,
  className = "",
}: {
  dir: "x" | "y";
  onStart?: () => void;
  onDrag: (delta: number) => void;
  className?: string;
}) {
  const [active, setActive] = useState(false);

  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const start = dir === "x" ? e.clientX : e.clientY;
    onStart?.();
    setActive(true);
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = dir === "x" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";

    const move = (ev: PointerEvent) => onDrag((dir === "x" ? ev.clientX : ev.clientY) - start);
    const up = () => {
      setActive(false);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      onPointerDown={down}
      role="separator"
      aria-orientation={dir === "x" ? "vertical" : "horizontal"}
      className={`group relative z-20 shrink-0 ${dir === "x" ? "w-px cursor-col-resize" : "h-px cursor-row-resize"} bg-line ${className}`}
    >
      {/* 잡기 쉬운 넓은 투명 영역 + 마우스를 올리면 보이는 선 */}
      <span className={`absolute ${dir === "x" ? "inset-y-0 -left-[3px] w-[7px]" : "inset-x-0 -top-[3px] h-[7px]"}`} />
      <span
        className={`pointer-events-none absolute transition-colors ${
          dir === "x" ? "inset-y-0 -left-px w-[3px]" : "inset-x-0 -top-px h-[3px]"
        } ${active ? "bg-teal" : "bg-transparent group-hover:bg-teal/60"}`}
      />
    </div>
  );
}
