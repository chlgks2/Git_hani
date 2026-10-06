import { HttpException } from '@nestjs/common';
import { parseBody } from './ai.controller.js';
import { SummarizeRequestSchema } from './ai.schemas.js';
import { AiService } from './ai.service.js';
import { formatPatches, MAX_PATCH_CHARS } from './prompts.js';
import { redact, REDACTED } from './redact.js';

describe('redact', () => {
  it('비밀로 보이는 값을 가린다', () => {
    const src = [
      'const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz";',
      'aws = AKIAABCDEFGHIJKLMNOP',
      'password: hunter22secret',
      'const menu = ["아메리카노"];',
    ].join('\n');
    const out = redact(src);
    expect(out).not.toContain('sk-ant-api03');
    expect(out).not.toContain('AKIAABCDEFGHIJKLMNOP');
    expect(out).not.toContain('hunter22secret');
    expect(out).toContain('password: ' + REDACTED);
    expect(out).toContain('const menu = ["아메리카노"];'); // 평범한 코드는 그대로
  });
});

describe('formatPatches', () => {
  it('짧으면 그대로, 바이너리는 표시', () => {
    const { text, truncated } = formatPatches([
      { path: 'a.js', status: 'M', patch: '+새 줄\n-옛 줄' },
      { path: 'logo.png', status: 'A', patch: '' },
    ]);
    expect(truncated).toBe(false);
    expect(text).toContain('<file path="a.js" change="수정">');
    expect(text).toContain('(바이너리이거나 내용 없음)');
  });

  it('너무 길면 줄이고, 줄였다는 사실을 남긴다', () => {
    const big = Array.from({ length: 20_000 }, (_, i) => `+줄 ${i}`).join('\n');
    const { text, truncated } = formatPatches([
      { path: 'a.js', status: 'M', patch: big },
      { path: 'b.js', status: 'M', patch: big },
    ]);
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThan(MAX_PATCH_CHARS + 1_000);
    expect(text).toMatch(/\(이하 \d+줄 생략\)/);
  });
});

describe('parseBody', () => {
  it('틀린 본문은 어느 칸이 왜 틀렸는지 알려준다', () => {
    expect(() => parseBody(SummarizeRequestSchema, { files: [] })).toThrow();
    try {
      parseBody(SummarizeRequestSchema, { files: [{ path: 'a', status: 'X', patch: '' }] });
    } catch (e) {
      expect(JSON.stringify((e as HttpException).getResponse())).toContain('files.0.status');
    }
  });
});

describe('AiService', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('API 키가 없으면 503 으로 설정 방법을 알려준다', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    const ai = new AiService();
    await expect(ai.summarize({ files: [{ path: 'a', status: 'M', patch: '+1' }] })).rejects.toMatchObject({
      status: 503,
    });
  });

  it('Claude 에게 구조화된 요청을 보내고 결과를 돌려준다', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const ai = new AiService();
    const parse = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { title: '메뉴에 바닐라라떼 추가', body: '' },
    });
    // 실제 네트워크 대신 가짜 클라이언트
    (ai as unknown as { client: unknown }).client = { beta: { messages: { parse } } };

    const out = await ai.commitMessage({
      files: [{ path: 'menu.js', status: 'M', patch: '+ "바닐라라떼"' }],
      recentSubjects: ['영업시간 수정'],
    });
    expect(out).toEqual({ title: '메뉴에 바닐라라떼 추가', body: '', truncated: false });

    const req = parse.mock.calls[0][0];
    expect(req.model).toBe('claude-opus-5-5');
    expect(req.fallbacks).toBe('default');
    expect(req.betas).toContain('server-side-fallback-2026-07-01');
    expect(req.output_config.effort).toBe('low');
    expect(req.messages[0].content).toContain('영업시간 수정'); // 최근 메시지로 말투를 맞춘다
  });

  it('거절(refusal)은 422 로 알린다', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const ai = new AiService();
    const parse = vi.fn().mockResolvedValue({ stop_reason: 'refusal', parsed_output: null });
    (ai as unknown as { client: unknown }).client = { beta: { messages: { parse } } };
    await expect(
      ai.explainConflict({
        path: 'a.js', oursLabel: 'main', theirsLabel: 'origin/main', ours: 'a', theirs: 'b', base: null, before: '', after: '',
      }),
    ).rejects.toMatchObject({ status: 422 });
  });
});
