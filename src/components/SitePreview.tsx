// 사용자가 AI로 만든 카페 홈페이지의 가짜 미리보기. 사이트 자체는 밝은 화면 그대로 둔다.
import type { PreviewKind } from "../data";

export default function SitePreview({ state }: { state: PreviewKind }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[3px] border border-line">
      <div className="flex h-6 shrink-0 items-center gap-2 bg-raised px-2">
        <span className="flex-1 truncate font-mono text-[10px] text-dim">localhost:3000/menu</span>
        <span className={`h-1.5 w-1.5 rounded-full ${state === "broken" ? "bg-red" : "bg-green"}`} />
      </div>

      {state === "broken" ? (
        <div className="flex flex-1 flex-col bg-white">
          <div className="flex-1" />
          <div className="border-t border-red-200 bg-red-50 p-2.5 font-mono text-[10px] leading-relaxed text-red-700">
            Uncaught TypeError: Cannot read properties of undefined (reading 'map')
            <br />
            &nbsp;&nbsp;at renderList (menu.js:12)
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto bg-[#fbf8f3] p-3.5 text-[11px] text-stone-700">
          <div className="mb-3 flex items-center justify-between border-b border-stone-200 pb-2">
            <span className="font-bold tracking-tight text-stone-900">우리동네 카페</span>
            <span className="space-x-2 text-[10px] text-stone-400">
              <span>홈</span>
              <span className="font-semibold text-stone-800">메뉴</span>
              <span>오시는 길</span>
            </span>
          </div>
          <div className="mb-1 text-[10px] font-semibold tracking-widest text-stone-400">COFFEE</div>
          <MenuRow name="아메리카노" price="4,000" />
          <MenuRow name="카페라떼" price="4,500" />
          {state === "after" && (
            <div className="rise mt-3">
              <div className="mb-1 text-[10px] font-semibold tracking-widest text-orange-600">가을 시즌 음료</div>
              <MenuRow name="밤 라떼" price="5,500" />
              <MenuRow name="고구마 라떼" price="5,500" />
              <MenuRow name="애플 시나몬티" price="5,000" />
            </div>
          )}
          <div className="mt-4 text-[9px] text-stone-400">평일 8:00–21:00 · 주말 10:00–21:00</div>
        </div>
      )}
    </div>
  );
}

function MenuRow({ name, price }: { name: string; price: string }) {
  return (
    <div className="flex justify-between border-b border-dotted border-stone-200 py-1">
      <span>{name}</span>
      <span className="text-stone-500">{price}</span>
    </div>
  );
}
