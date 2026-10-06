// 목업용 시나리오 데이터. 실제 Git/AI 호출 없이 이 값으로 화면을 진행한다.

export const REPO = "cafe-homepage";
export const REPO_PATH = "D:\\projects\\cafe-homepage";
export const PROJECT_LABEL = "우리동네 카페 홈페이지";

/* ---------- 변경 파일 ---------- */

export type DiffLine = { type: "add" | "del" | "ctx"; text: string };

export interface ChangedFile {
  path: string;
  status: "A" | "M";
  plain: string; // 비개발자용 한 줄 설명
  short: string; // AI 커밋 메시지 추천에 쓰는 짧은 요약
  sensitive?: boolean;
  diff: DiffLine[];
}

export const CHANGED_FILES: ChangedFile[] = [
  {
    path: "menu.html",
    status: "M",
    plain: "메뉴 페이지에 '가을 시즌 음료' 칸이 새로 생겼어요",
    short: "가을 시즌 음료 메뉴 추가",
    diff: [
      { type: "ctx", text: '<section class="menu">' },
      { type: "ctx", text: "  <h2>커피</h2>" },
      { type: "add", text: '  <h2 class="season">가을 시즌 음료</h2>' },
      { type: "add", text: '  <ul id="season-list"></ul>' },
      { type: "ctx", text: "</section>" },
    ],
  },
  {
    path: "menu.js",
    status: "M",
    plain: "시즌 음료 3종(밤 라떼, 고구마 라떼, 애플 시나몬티)을 보여주도록 바뀌었어요",
    short: "가을 시즌 음료 메뉴 추가",
    diff: [
      { type: "ctx", text: 'const menu = ["아메리카노", "카페라떼"];' },
      { type: "add", text: 'const season = ["밤 라떼", "고구마 라떼", "애플 시나몬티"];' },
      { type: "ctx", text: "renderList('menu-list', menu);" },
      { type: "add", text: "renderList('season-list', season);" },
    ],
  },
  {
    path: "style.css",
    status: "M",
    plain: "시즌 음료 제목이 주황색으로 보이도록 꾸몄어요",
    short: "시즌 음료 제목 색상 변경",
    diff: [
      { type: "add", text: ".season {" },
      { type: "add", text: "  color: #ea580c;" },
      { type: "add", text: "}" },
    ],
  },
  {
    path: ".env",
    status: "A",
    plain: "지도 서비스 API 키가 들어 있는 설정 파일이에요",
    short: "지도 API 설정 추가",
    sensitive: true,
    diff: [{ type: "add", text: "MAP_API_KEY=sk-live-8f3a••••••••••••2c91" }],
  },
];

// 선택한 파일로 AI 커밋 메시지 추천
export function suggestMessage(paths: string[]): string {
  const parts = [...new Set(CHANGED_FILES.filter((f) => paths.includes(f.path)).map((f) => f.short))];
  return parts.join(", ");
}

export const BROKEN = {
  files: ["menu.js", "data.json"],
  error: "TypeError: Cannot read properties of undefined (reading 'map')",
  plain:
    "AI가 menu.js를 고치면서 메뉴 목록을 읽는 부분을 지웠어요. 그래서 메뉴 페이지가 하얗게 보여요.",
};

/* ---------- 폴더 구조 ---------- */

export interface TreeNode {
  name: string;
  path: string;
  dir?: boolean;
  children?: TreeNode[];
  hidden?: boolean; // .git 같은 시스템 폴더
}

export const TREE: TreeNode = {
  name: REPO,
  path: "",
  dir: true,
  children: [
    { name: ".git", path: ".git", dir: true, hidden: true, children: [] },
    {
      name: "assets",
      path: "assets",
      dir: true,
      children: [
        { name: "logo.png", path: "assets/logo.png" },
        { name: "store-1.jpg", path: "assets/store-1.jpg" },
        { name: "store-2.jpg", path: "assets/store-2.jpg" },
        { name: "store-3.jpg", path: "assets/store-3.jpg" },
      ],
    },
    { name: ".env", path: ".env" },
    { name: ".gitignore", path: ".gitignore" },
    { name: "data.json", path: "data.json" },
    { name: "index.html", path: "index.html" },
    { name: "menu.html", path: "menu.html" },
    { name: "menu.js", path: "menu.js" },
    { name: "README.md", path: "README.md" },
    { name: "style.css", path: "style.css" },
  ],
};

/* ---------- 커밋 그래프 ---------- */

export type PreviewKind = "before" | "after" | "broken";

export interface Commit {
  id: string;
  hash: string;
  msg: string;
  when: string;
  lane: number;
  parents: string[];
  preview: PreviewKind;
  kind?: "wip" | "backup";
  broken?: boolean;
  files?: string[]; // 이 저장 지점에 담긴 파일
  pushed?: boolean; // 온라인(origin)에 올라갔는지
  local?: boolean; // 이번 테스트 중에 새로 만든 저장 지점
}

export const LANE_COLORS = ["var(--color-teal)", "var(--color-magenta)", "var(--color-amber)"];

/** 데모 저장 지점마다 바뀐 파일과 줄 수 (그래프 점에 마우스를 올리면 보여줌) */
export const DEMO_STATS: Record<string, { path: string; added: number | null; deleted: number | null }[]> = {
  c5: [{ path: "index.html", added: 2, deleted: 2 }],
  m1: [
    { path: "gallery.html", added: 48, deleted: 0 },
    { path: "assets/store-1.jpg", added: null, deleted: null },
    { path: "assets/store-2.jpg", added: null, deleted: null },
    { path: "assets/store-3.jpg", added: null, deleted: null },
    { path: "index.html", added: 3, deleted: 0 },
  ],
  g2: [
    { path: "gallery.html", added: 18, deleted: 2 },
    { path: "assets/store-1.jpg", added: null, deleted: null },
    { path: "assets/store-2.jpg", added: null, deleted: null },
    { path: "assets/store-3.jpg", added: null, deleted: null },
  ],
  g1: [
    { path: "gallery.html", added: 32, deleted: 0 },
    { path: "index.html", added: 3, deleted: 0 },
  ],
  c2: [
    { path: "index.html", added: 14, deleted: 1 },
    { path: "style.css", added: 6, deleted: 0 },
  ],
  c1: [
    { path: "index.html", added: 62, deleted: 0 },
    { path: "menu.html", added: 41, deleted: 0 },
    { path: "menu.js", added: 12, deleted: 0 },
    { path: "style.css", added: 88, deleted: 0 },
    { path: "data.json", added: 9, deleted: 0 },
    { path: "README.md", added: 4, deleted: 0 },
    { path: "assets/logo.png", added: null, deleted: null },
  ],
  revert: [
    { path: "menu.js", added: 4, deleted: 2 },
    { path: "data.json", added: 1, deleted: 1 },
  ],
  backup: [
    { path: "menu.js", added: 2, deleted: 4 },
    { path: "data.json", added: 1, deleted: 1 },
  ],
};

/** 새로 만든 데모 저장 지점의 줄 수: 파일별 diff 의 +/- 줄을 센다 */
export function demoStatsFor(files: string[]) {
  return CHANGED_FILES.filter((f) => files.includes(f.path)).map((f) => ({
    path: f.path,
    added: f.diff.filter((l) => l.type === "add").length,
    deleted: f.diff.filter((l) => l.type === "del").length,
  }));
}

// 오래된 순서가 아래 (배열은 최신이 위)
export const BASE_COMMITS: Commit[] = [
  { id: "c5", hash: "a41f9e2", msg: "영업시간 안내 수정", when: "어제 18:40", lane: 0, parents: ["m1"], preview: "before" },
  { id: "m1", hash: "7d03b1c", msg: "갤러리 실험 합치기", when: "3일 전", lane: 0, parents: ["c2", "g2"], preview: "before" },
  { id: "g2", hash: "e9a2c40", msg: "매장 사진 6장 배치", when: "3일 전", lane: 1, parents: ["g1"], preview: "before" },
  { id: "g1", hash: "51bb7d8", msg: "갤러리 페이지 초안", when: "4일 전", lane: 1, parents: ["c2"], preview: "before" },
  { id: "c2", hash: "0c6e3fa", msg: "오시는 길 지도 추가", when: "5일 전", lane: 0, parents: ["c1"], preview: "before" },
  { id: "c1", hash: "f2d8a17", msg: "홈페이지 처음 만들기", when: "1주 전", lane: 0, parents: [], preview: "before" },
];

// 새로 만드는 커밋에 차례로 붙일 해시
export const NEW_HASHES = ["3be71d5", "8c2f0a9", "d61e4b7", "5a90c3e", "b17d2f6", "e4c8a01", "71fd93b"];
