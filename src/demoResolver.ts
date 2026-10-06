// 웹 데모용 충돌 해결: 실제 git 대신 미리 준비한 충돌 데이터로 같은 화면을 움직인다
import type { ResolverBackend } from "./components/ConflictResolver";
import { DEMO_CONFLICT_AI, DEMO_CONFLICT_FILE, DEMO_CONFLICT_RAW, DEMO_CONFLICT_SEGMENTS } from "./data";
import type { Scenario } from "./store";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function demoResolverBackend(s: Scenario): ResolverBackend {
  return {
    oursLabel: "main",
    theirsLabel: "origin/main",
    all: [DEMO_CONFLICT_FILE],
    remaining: s.demoResolved == null ? [DEMO_CONFLICT_FILE] : [],
    load: async () => ({
      path: DEMO_CONFLICT_FILE,
      segments: DEMO_CONFLICT_SEGMENTS,
      raw: DEMO_CONFLICT_RAW,
      oursExists: true,
      theirsExists: true,
    }),
    saveFile: async (_file, content, note) => s.demoSaveFile(content, note),
    chooseWhole: async () => {},
    explain: async (req) => {
      await wait(900); // AI 가 읽는 시간처럼
      return req.ours.includes("season") ? DEMO_CONFLICT_AI.season : DEMO_CONFLICT_AI.notice;
    },
    abort: s.demoAbort,
    finish: s.demoFinish,
    close: s.demoCloseResolver,
  };
}
