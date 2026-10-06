// AI 서버(server/, NestJS) 호출. 서버가 꺼져 있거나 키가 없으면 그 상태를 알려준다.
import { gitFileDiff, looksSecret, type FileChange, type FileDiff } from "./git";

/** AI 서버 주소. 빌드할 때 VITE_AI_URL 로 바꿀 수 있다 */
export const AI_URL = (import.meta.env.VITE_AI_URL as string | undefined) ?? "http://localhost:4000";

export type AiState = "unknown" | "ok" | "nokey" | "offline";

export interface FilePatch {
  path: string;
  status: FileChange["status"];
  patch: string;
}

export interface Summary {
  overall: string;
  files: { path: string; summary: string }[];
  truncated: boolean;
}

export interface CommitSuggestion {
  title: string;
  body: string;
  truncated: boolean;
}

export interface ConflictExplanation {
  summary: string;
  ours: string;
  theirs: string;
  recommendation: "ours" | "theirs" | "oursFirst" | "theirsFirst" | "manual";
  reason: string;
}

export async function aiHealth(): Promise<AiState> {
  try {
    const res = await fetch(`${AI_URL}/health`, { signal: AbortSignal.timeout(3000) });
    const body = (await res.json()) as { ai?: boolean };
    return body.ai ? "ok" : "nokey";
  } catch {
    return "offline";
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${AI_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`AI 서버(${AI_URL})에 연결하지 못했어요. server 폴더에서 npm run start:dev 로 켜 주세요.`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { message?: string | string[] }).message;
    throw new Error(Array.isArray(msg) ? msg.join("\n") : (msg ?? `AI 서버 오류 (${res.status})`));
  }
  return data as T;
}

export const aiSummarize = (files: FilePatch[]) => post<Summary>("/ai/summarize", { files });
export const aiCommitMessage = (files: FilePatch[], recentSubjects: string[]) =>
  post<CommitSuggestion>("/ai/commit-message", { files, recentSubjects });
export const aiExplainConflict = (req: {
  path: string;
  oursLabel: string;
  theirsLabel: string;
  ours: string;
  theirs: string;
  base: string | null;
  before: string;
  after: string;
}) => post<ConflictExplanation>("/ai/explain-conflict", req);

/** diff 를 AI 에게 보낼 글로 (+ 추가, - 삭제, 공백 그대로) */
function diffToText(d: FileDiff) {
  if (d.binary || d.tooLarge) return "";
  return d.hunks
    .map((h) => [h.header, ...h.lines.map((l) => (l.kind === "add" ? "+" : l.kind === "del" ? "-" : " ") + l.text)].join("\n"))
    .join("\n");
}

/**
 * 고른 파일들의 변경 내용을 모은다. 비밀 정보로 보이는 파일(.env 등)은 내용을 보내지 않는다.
 * @returns 보낼 내용과, 빼고 보낸 비밀 파일 목록
 */
export async function collectPatches(root: string, files: FileChange[]) {
  const skipped = files.filter((f) => looksSecret(f.path)).map((f) => f.path);
  const send = files.filter((f) => !looksSecret(f.path));
  const patches = await Promise.all(
    send.map(async (f) => ({
      path: f.path,
      status: f.status,
      patch: await gitFileDiff(root, f.path).then(diffToText).catch(() => ""),
    })),
  );
  return { patches, skipped };
}
