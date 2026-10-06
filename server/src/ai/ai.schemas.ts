// 요청과 응답의 모양. 요청은 들어올 때 검사하고, 응답은 Claude 가 이 모양 그대로 돌려주도록 강제한다.
import { z } from 'zod';

/* ---------- 요청 ---------- */

export const FilePatchSchema = z.object({
  path: z.string().min(1).max(500),
  /** A 새 파일 / M 수정 / D 삭제 / R 이름 바뀜 / U 충돌 */
  status: z.enum(['A', 'M', 'D', 'R', 'U']),
  /** 바뀐 줄 (+/- 로 시작하는 unified diff 본문). 바이너리면 빈 문자열 */
  patch: z.string().max(200_000),
});
export type FilePatch = z.infer<typeof FilePatchSchema>;

export const SummarizeRequestSchema = z.object({
  files: z.array(FilePatchSchema).min(1).max(100),
});
export type SummarizeRequest = z.infer<typeof SummarizeRequestSchema>;

export const CommitMessageRequestSchema = z.object({
  files: z.array(FilePatchSchema).min(1).max(100),
  /** 이 저장소의 최근 저장 메시지들 — 말투와 형식을 맞추는 데 쓴다 */
  recentSubjects: z.array(z.string().max(300)).max(15).default([]),
});
export type CommitMessageRequest = z.infer<typeof CommitMessageRequestSchema>;

export const ExplainConflictRequestSchema = z.object({
  path: z.string().min(1).max(500),
  oursLabel: z.string().max(200),
  theirsLabel: z.string().max(200),
  ours: z.string().max(50_000),
  theirs: z.string().max(50_000),
  base: z.string().max(50_000).nullable().default(null),
  /** 충돌 부분 바로 앞뒤의 같은 줄들 — 무엇에 관한 코드인지 알려준다 */
  before: z.string().max(5_000).default(''),
  after: z.string().max(5_000).default(''),
});
export type ExplainConflictRequest = z.infer<typeof ExplainConflictRequestSchema>;

/* ---------- 응답 (Claude 가 채우는 부분) ---------- */

export const SummarySchema = z.object({
  overall: z.string().describe('전체 변경을 한두 문장으로'),
  files: z.array(
    z.object({
      path: z.string(),
      summary: z.string().describe('이 파일에서 바뀐 점을 한 문장으로'),
    }),
  ),
});
export type Summary = z.infer<typeof SummarySchema>;

export const CommitMessageSchema = z.object({
  title: z.string().describe('저장 메시지 제목 한 줄 (50자 안팎)'),
  body: z.string().describe('필요할 때만 쓰는 자세한 설명. 필요 없으면 빈 문자열'),
});
export type CommitMessage = z.infer<typeof CommitMessageSchema>;

export const ConflictExplanationSchema = z.object({
  summary: z.string().describe('두 사람이 같은 부분을 어떻게 다르게 고쳤는지 한두 문장으로'),
  ours: z.string().describe('내 쪽 내용이 결과적으로 무엇을 하는지'),
  theirs: z.string().describe('온라인 쪽 내용이 결과적으로 무엇을 하는지'),
  recommendation: z
    .enum(['ours', 'theirs', 'oursFirst', 'theirsFirst', 'manual'])
    .describe('추천 선택. 둘을 합치면 코드가 깨지면 oursFirst/theirsFirst 를 고르지 말 것. 판단이 어려우면 manual'),
  reason: z.string().describe('추천한 이유를 한두 문장으로'),
});
export type ConflictExplanation = z.infer<typeof ConflictExplanationSchema>;
