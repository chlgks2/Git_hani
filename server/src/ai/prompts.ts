// Claude 에게 보낼 지시문과 입력 만들기
import type { CommitMessageRequest, ExplainConflictRequest, FilePatch } from './ai.schemas.js';
import { redact } from './redact.js';

/** 모든 기능이 같이 쓰는 지시문 — 바뀌지 않아서 앞부분이 캐시된다 */
export const SYSTEM = `당신은 AI 코딩 도구로 프로그램을 만들지만 Git 은 잘 모르는 사람을 돕습니다.
- 한국어로, 개발 용어 대신 쉬운 말로 씁니다. Git 용어가 꼭 필요하면 쉬운 말을 먼저 쓰고 괄호에 용어를 붙입니다. 예: 저장 지점(커밋)
- 코드가 "어떻게" 바뀌었는지보다 사용자가 보기에 "무엇이" 달라지는지를 설명합니다. 예: "메뉴에 바닐라라떼가 추가돼요"
- 변경 내용에 없는 일을 지어내지 않습니다. 확실하지 않으면 그렇다고 말합니다.
- [가려짐] 은 보안상 가린 값입니다. 그 값을 추측하지 않습니다.`;

/** 한 번에 보낼 변경 내용의 최대 글자 수. 넘치면 파일마다 뒷부분을 줄이고 그 사실을 알린다 */
export const MAX_PATCH_CHARS = 60_000;

const STATUS_WORD: Record<FilePatch['status'], string> = {
  A: '새 파일',
  M: '수정',
  D: '삭제',
  R: '이름 바뀜',
  U: '충돌',
};

/**
 * 파일별 변경 내용을 하나의 글로 만든다.
 * 전체가 너무 길면 파일마다 같은 몫만큼만 남기고 "(이하 N줄 생략)"을 붙인다 — 몰래 자르지 않는다.
 */
export function formatPatches(files: FilePatch[]): { text: string; truncated: boolean } {
  const total = files.reduce((n, f) => n + f.patch.length, 0);
  const share = total > MAX_PATCH_CHARS ? Math.floor(MAX_PATCH_CHARS / files.length) : Infinity;
  let truncated = false;

  const parts = files.map((f) => {
    let patch = f.patch;
    if (patch.length > share) {
      const kept = patch.slice(0, share);
      const omitted = patch.slice(share).split('\n').length;
      patch = `${kept}\n(이하 ${omitted}줄 생략)`;
      truncated = true;
    }
    const body = patch.trim() ? redact(patch) : '(바이너리이거나 내용 없음)';
    return `<file path="${f.path}" change="${STATUS_WORD[f.status]}">\n${body}\n</file>`;
  });
  return { text: parts.join('\n\n'), truncated };
}

export function summarizePrompt(changes: string, truncated: boolean) {
  return `아래는 마지막 저장 이후 바뀐 파일들입니다. 줄 앞의 + 는 추가, - 는 삭제입니다.
${truncated ? '변경이 많아 일부는 생략됐습니다. 생략된 부분은 추측하지 마세요.\n' : ''}
${changes}

전체 변경을 한두 문장으로, 그리고 파일마다 무엇이 달라졌는지 한 문장으로 요약해 주세요.`;
}

export function commitMessagePrompt(req: CommitMessageRequest, changes: string, truncated: boolean) {
  const style = req.recentSubjects.length
    ? `이 프로젝트의 최근 저장 메시지입니다. 말투·언어·형식(예: "feat:" 같은 머리말 사용 여부)을 맞춰 주세요.\n${req.recentSubjects
        .map((s) => `- ${s}`)
        .join('\n')}\n`
    : '최근 저장 메시지가 없으니, 무엇을 바꿨는지 한국어로 짧게 적어 주세요.\n';
  return `${style}
아래 변경을 하나의 저장 지점(커밋)으로 기록할 메시지를 만들어 주세요.
${truncated ? '변경이 많아 일부는 생략됐습니다.\n' : ''}
${changes}`;
}

export function explainConflictPrompt(req: ExplainConflictRequest) {
  const block = (s: string) => (s.trim() ? redact(s) : '(이 부분을 지웠음)');
  return `파일 ${req.path} 에서 충돌이 났습니다. 나("${req.oursLabel}")와 온라인("${req.theirsLabel}")이 같은 부분을 서로 다르게 고쳤습니다.

<before>
${redact(req.before)}
</before>
<ours label="${req.oursLabel}">
${block(req.ours)}
</ours>
<theirs label="${req.theirsLabel}">
${block(req.theirs)}
</theirs>
${req.base != null ? `<original>\n${block(req.base)}\n</original>\n` : ''}<after>
${redact(req.after)}
</after>

두 쪽이 각각 무엇을 하는지 쉬운 말로 설명하고, 어떤 선택이 좋을지 추천해 주세요.
선택지: ours(내 것), theirs(온라인 것), oursFirst(둘 다, 내 것 먼저), theirsFirst(둘 다, 온라인 것 먼저), manual(직접 고쳐야 함).
둘 다 남기면 같은 변수를 두 번 선언하는 등 코드가 깨지는 경우에는 둘 다를 추천하지 마세요.`;
}
