// Rust(Tauri) 쪽 Git 명령을 부르는 함수들. 브라우저에서 열면 데모 모드로만 동작한다.
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface FileChange {
  path: string;
  status: "A" | "M" | "D" | "R" | "U";
  code: string;
  staged: boolean;
  /** 이름이 바뀐 파일의 원래 이름 */
  origPath: string | null;
}

export interface CommitInfo {
  hash: string;
  short: string;
  parents: string[];
  author: string;
  /** 저장한 시각 (초) */
  time: number;
  /** 예: "HEAD -> refs/heads/main", "refs/remotes/origin/main", "tag: refs/tags/v1" */
  refs: string[];
  subject: string;
}

export interface RepoStatus {
  root: string;
  name: string;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  noCommits: boolean;
  /** 연결된 온라인 저장소 이름들 (보통 "origin") */
  remotes: string[];
  /** 합치기(merge) 진행 중 = 충돌을 해결하는 도중 */
  merging: boolean;
  files: FileChange[];
}

export const isDesktop = () => "__TAURI_INTERNALS__" in window;

/** 실행할 때 함께 준 폴더 경로 (git-hani.exe D:\프로젝트). 없으면 null */
export const startupPath = () => invoke<string | null>("startup_path");

export function gitStatus(path: string) {
  return invoke<RepoStatus>("git_status", { path });
}

export function gitLog(path: string, limit = 300) {
  return invoke<CommitInfo[]>("git_log", { path, limit });
}

export function gitCommit(path: string, files: string[], message: string, description: string) {
  return invoke<{ hash: string; short: string }>("git_commit", {
    path,
    files,
    message,
    description: description.trim() || null,
  });
}

/** 저장 지점 + 그 저장 지점에서 바뀐 파일 이름들 */
export interface CommitWithFiles extends CommitInfo {
  files: string[];
}
/** 아직 온라인에 올리지 않은 저장 지점 (최신이 앞) */
export type UnpushedCommit = CommitWithFiles;

export function gitUnpushed(path: string) {
  return invoke<UnpushedCommit[]>("git_unpushed", { path });
}

/** upTo 를 주면 그 저장 지점까지만, 없으면 지금 갈래 전체를 올린다 */
export function gitPush(path: string, upTo?: string) {
  return invoke<{ remote: string; branch: string; created: boolean }>("git_push", { path, upTo: upTo ?? null });
}

/** 온라인의 최신 기록을 내려받기만 한다. interactive 가 false 면 로그인 창을 띄우지 않는다 */
export function gitFetch(path: string, interactive: boolean) {
  return invoke<void>("git_fetch", { path, interactive });
}

/** 온라인에는 있지만 아직 받지 않은 저장 지점 (최신이 앞) */
export function gitIncoming(path: string) {
  return invoke<CommitWithFiles[]>("git_incoming", { path });
}

export interface PullResult {
  kind: "upToDate" | "fastForward" | "merged" | "conflict";
  count: number;
  conflicts: string[];
}

export function gitPull(path: string) {
  return invoke<PullResult>("git_pull", { path });
}

/* ---------- 충돌 해결 ---------- */

export type Segment =
  | { kind: "same"; text: string }
  | { kind: "conflict"; ours: string; theirs: string; base: string | null };

export interface ConflictFile {
  path: string;
  /** 줄 단위로 고를 수 없으면(이미지, 한쪽에서 삭제 등) null */
  segments: Segment[] | null;
  /** Git 이 파일에 써 넣은 그대로의 내용 (<<<<<<< 기호 포함) */
  raw: string;
  oursExists: boolean;
  theirsExists: boolean;
}

/** 충돌이 났던 합치기를 다시 시작한다. 충돌 파일 목록 (비어 있으면 충돌 없이 합쳐짐) */
export const gitStartMerge = (path: string) => invoke<string[]>("git_start_merge", { path });
export const gitConflictFile = (path: string, file: string) => invoke<ConflictFile>("git_conflict_file", { path, file });
export const gitResolveFile = (path: string, file: string, content: string) =>
  invoke<void>("git_resolve_file", { path, file, content });
export const gitResolveWhole = (path: string, file: string, side: "ours" | "theirs") =>
  invoke<void>("git_resolve_whole", { path, file, side });
export const gitFinishMerge = (path: string) => invoke<{ hash: string; short: string }>("git_finish_merge", { path });
export const gitAbortMerge = (path: string) => invoke<void>("git_abort_merge", { path });

/** 저장 지점 하나에서 바뀐 파일과 줄 수 (바이너리 파일은 null) */
export interface FileStat {
  path: string;
  added: number | null;
  deleted: number | null;
}

export function gitCommitStats(path: string, hash: string) {
  return invoke<FileStat[]>("git_commit_stats", { path, hash });
}

/** 비밀 정보가 들어 있을 가능성이 큰 파일 이름 */
const SECRET_PATTERNS = [
  /^\.env(\..+)?$/, // .env, .env.local …
  /\.(pem|key|p12|pfx|keystore|jks)$/, // 인증서·개인 키
  /^id_(rsa|ed25519|ecdsa|dsa)$/, // SSH 개인 키
  /(credentials|secrets?)\.(json|ya?ml|txt)$/,
];
const SAFE_EXAMPLE = /\.(example|sample|template)$/; // .env.example 같은 예시 파일은 괜찮다

export function looksSecret(path: string) {
  const name = path.split("/").pop()!.toLowerCase();
  return !SAFE_EXAMPLE.test(name) && SECRET_PATTERNS.some((re) => re.test(name));
}

/** 초 단위 시각을 "3분 전" 같은 말로 */
export function timeAgo(sec: number) {
  const d = Date.now() / 1000 - sec;
  if (d < 60) return "방금";
  if (d < 3600) return `${Math.floor(d / 60)}분 전`;
  if (d < 86400) return `${Math.floor(d / 3600)}시간 전`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)}일 전`;
  const t = new Date(sec * 1000);
  return `${t.getFullYear()}.${t.getMonth() + 1}.${t.getDate()}`;
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
