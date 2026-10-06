// AI 기능 주소들. 요청 본문은 zod 스키마로 검사한다.
import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import type { z } from 'zod';
import {
  CommitMessageRequestSchema,
  ExplainConflictRequestSchema,
  SummarizeRequestSchema,
} from './ai.schemas.js';
import { AiService } from './ai.service.js';

/** 요청 본문을 스키마로 검사하고, 틀리면 어느 칸이 왜 틀렸는지 400 으로 알려준다 */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException(
      result.error.issues.map((i) => `${i.path.join('.') || '(본문)'}: ${i.message}`),
    );
  }
  return result.data;
}

@Controller()
export class AiController {
  // @Inject 를 직접 적어 두면 타입 메타데이터 없이도(테스트 도구 등) 주입이 동작한다
  constructor(@Inject(AiService) private readonly ai: AiService) {}

  /** 서버가 살아 있는지, AI 를 쓸 수 있는지 */
  @Get('health')
  health() {
    return { ok: true, ai: this.ai.hasCredentials(), model: this.ai.model };
  }

  @Post('ai/summarize')
  @HttpCode(200)
  summarize(@Body() body: unknown) {
    return this.ai.summarize(parseBody(SummarizeRequestSchema, body));
  }

  @Post('ai/commit-message')
  @HttpCode(200)
  commitMessage(@Body() body: unknown) {
    return this.ai.commitMessage(parseBody(CommitMessageRequestSchema, body));
  }

  @Post('ai/explain-conflict')
  @HttpCode(200)
  explainConflict(@Body() body: unknown) {
    return this.ai.explainConflict(parseBody(ExplainConflictRequestSchema, body));
  }
}
