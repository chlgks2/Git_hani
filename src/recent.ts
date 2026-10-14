// 최근에 연 저장소 목록. 이 컴퓨터(앱의 웹뷰 저장소)에만 남는다.
export interface RecentRepo {
  path: string;
  name: string;
  /** 마지막으로 연 시각 (밀리초) */
  at: number;
}

const KEY = "gitgui.recentRepos";
const MAX = 8;

export function loadRecent(): RecentRepo[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((r) => typeof r?.path === "string") : [];
  } catch {
    return []; // 저장소를 못 쓰는 환경이면 목록 없이 동작
  }
}

function save(list: RecentRepo[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 저장 실패는 무시 — 목록은 편의 기능일 뿐 */
  }
}

/** 맨 앞에 추가 (같은 경로는 하나만) */
export function addRecent(path: string, name: string) {
  save([{ path, name, at: Date.now() }, ...loadRecent().filter((r) => r.path !== path)].slice(0, MAX));
}

export function removeRecent(path: string) {
  save(loadRecent().filter((r) => r.path !== path));
}
