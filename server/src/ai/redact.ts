// 외부(AI)로 보내기 전에 코드에서 비밀 정보로 보이는 값을 가린다.
// 앱에서 .env 같은 비밀 파일은 애초에 보내지 않지만, 코드 안에 직접 적힌 키까지 한 번 더 막는다.

const PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI·Anthropic 등 "sk-" 키
  /AKIA[0-9A-Z]{16}/g, // AWS 액세스 키
  /ghp_[A-Za-z0-9]{30,}/g, // GitHub 토큰
  /AIza[0-9A-Za-z_-]{30,}/g, // Google API 키
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, // 개인 키 블록
];

// api_key = "...", "password": "..." 처럼 이름이 비밀스러운 값
const ASSIGNMENT =
  /((?:api[_-]?key|secret|password|passwd|token|access[_-]?key|private[_-]?key)["']?\s*[:=]\s*["']?)([^\s"',;]{6,})/gi;

export const REDACTED = '[가려짐]';

export function redact(text: string): string {
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, REDACTED);
  return out.replace(ASSIGNMENT, (_m, name: string) => `${name}${REDACTED}`);
}
