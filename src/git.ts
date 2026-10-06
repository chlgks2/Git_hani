// Rust(Tauri) 쪽 Git 명령을 부르는 함수들. 브라우저에서 열면 데모 모드로만 동작한다.
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface FileChange {
  path: string;
  status: "A" | "M" | "D" | "R" | "U";
  code: string;
  staged: boolean;
}

export interface RepoStatus {
  root: string;
  name: string;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  noCommits: boolean;
  files: FileChange[];
}

export const isDesktop = () => "__TAURI_INTERNALS__" in window;

export function gitStatus(path: string) {
  return invoke<RepoStatus>("git_status", { path });
}

/** 폴더 선택 창을 띄운다. 취소하면 null */
export async function pickFolder(): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false, title: "Git 저장소 폴더 선택" });
  return typeof picked === "string" ? picked : null;
}

export const STATUS_LABEL: Record<FileChange["status"], string> = {
  A: "새 파일",
  M: "수정됨",
  D: "삭제됨",
  R: "이름 바뀜",
  U: "충돌",
};

export const STATUS_TONE: Record<FileChange["status"], string> = {
  A: "text-green",
  M: "text-amber",
  D: "text-red",
  R: "text-blue",
  U: "text-red",
};
