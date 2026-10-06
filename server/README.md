# Git GUI AI 서버

데스크톱 앱의 AI 기능(변경 내용 설명, 저장 메시지 추천, 충돌 설명)을 처리하는 NestJS 서버입니다.
Anthropic API 키는 이 서버에만 두고, 앱에는 넣지 않습니다.

## 실행

```bash
cd server
npm install
cp .env.example .env      # Windows: copy .env.example .env
# .env 의 ANTHROPIC_API_KEY 에 키를 넣는다
npm run start:dev         # http://localhost:4000
```

앱 상태줄에 **AI 도우미 연결됨** 이 보이면 연결된 것입니다.
서버가 꺼져 있거나 키가 없으면 앱이 그 상태를 알려주고, AI 없이도 나머지 기능은 그대로 동작합니다.

## 주소

| 주소 | 하는 일 |
|---|---|
| `GET /health` | 서버 상태, AI 사용 가능 여부 |
| `POST /ai/summarize` | 바뀐 파일들을 쉬운 말로 설명 |
| `POST /ai/commit-message` | 저장 메시지 추천 (최근 메시지의 말투에 맞춤) |
| `POST /ai/explain-conflict` | 충돌한 두 내용 설명 + 추천 선택 |

## 설정 (`.env`)

| 이름 | 기본값 | 설명 |
|---|---|---|
| `ANTHROPIC_API_KEY` | (필수) | Anthropic API 키 |
| `PORT` | `4000` | 서버 포트 |
| `AI_MODEL` | `claude-opus-5-5` | 사용할 Claude 모델 |
| `AI_EFFORT` | `low` | 생각 깊이 (`low`/`medium`/`high`/`xhigh`/`max`). 단순 작업이라 기본은 빠른 `low` |
| `CORS_ORIGINS` | 앱·개발 화면 주소 | 이 서버를 부를 수 있는 화면 주소 (쉼표로 구분) |

## 안전장치

- 앱은 `.env` 같은 비밀 정보 파일의 내용을 보내지 않습니다.
- 서버는 코드 안의 키·비밀번호로 보이는 값을 한 번 더 가린 뒤(`[가려짐]`) AI 에 보냅니다.
- 변경이 너무 많으면 파일마다 일부만 보내고, 생략했다는 사실을 AI 와 앱 양쪽에 알립니다.
- 안전 분류기가 답을 거절하면 서버 측 대체 모델로 다시 시도합니다(`fallbacks: "default"`).

## 테스트

```bash
npm test              # 단위 테스트 (AI 는 가짜로 대신함)
npm run test:e2e      # 서버를 띄워 주소별 응답 확인
```
