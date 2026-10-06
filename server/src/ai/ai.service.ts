// Claude 를 부르는 곳. 요청마다 구조화된 JSON 으로 답을 받는다.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';
import {
  CommitMessageSchema,
  ConflictExplanationSchema,
  SummarySchema,
  type CommitMessage,
  type CommitMessageRequest,
  type ConflictExplanation,
  type ExplainConflictRequest,
  type Summary,
  type SummarizeRequest,
} from './ai.schemas.js';
import { commitMessagePrompt, explainConflictPrompt, formatPatches, summarizePrompt, SYSTEM } from './prompts.js';

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private client: Anthropic | null = null;

  readonly model = process.env.AI_MODEL ?? 'claude-opus-5-5';
  /** 요약·메시지는 단순한 일이라 기본은 low (응답이 빠르고 비용이 적다) */
  readonly effort = (process.env.AI_EFFORT ?? 'low') as Effort;

  /** API 키가 있는지 — 없으면 AI 기능을 끈 상태로 안내한다 */
  hasCredentials() {
    return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  }

  private getClient() {
    if (!this.hasCredentials()) {
      throw new HttpException(
        'AI 서버에 Anthropic API 키가 설정되지 않았어요. server/.env 에 ANTHROPIC_API_KEY 를 넣어 주세요.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    this.client ??= new Anthropic();
    return this.client;
  }

  async summarize(req: SummarizeRequest): Promise<Summary & { truncated: boolean }> {
    const { text, truncated } = formatPatches(req.files);
    const result = await this.ask(SummarySchema, summarizePrompt(text, truncated));
    return { ...result, truncated };
  }

  async commitMessage(req: CommitMessageRequest): Promise<CommitMessage & { truncated: boolean }> {
    const { text, truncated } = formatPatches(req.files);
    const result = await this.ask(CommitMessageSchema, commitMessagePrompt(req, text, truncated));
    return { ...result, truncated };
  }

  explainConflict(req: ExplainConflictRequest): Promise<ConflictExplanation> {
    return this.ask(ConflictExplanationSchema, explainConflictPrompt(req));
  }

  /** 질문 하나를 보내고, 스키마 모양으로 검사된 답을 돌려준다 */
  protected async ask<S extends z.ZodType>(schema: S, prompt: string): Promise<z.infer<S>> {
    const client = this.getClient();
    try {
      const response = await client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        // 안전 분류기가 거절하면 서버가 같은 요청을 대체 모델로 다시 실행한다
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        output_config: { effort: this.effort, format: betaZodOutputFormat(schema) },
        messages: [{ role: 'user', content: prompt }],
      });

      if (response.stop_reason === 'refusal') {
        throw new HttpException('AI 가 이 내용에는 답하지 않았어요.', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
        throw new HttpException('AI 답이 중간에 끊겼어요. 다시 시도해 주세요.', HttpStatus.BAD_GATEWAY);
      }
      return response.parsed_output as z.infer<S>;
    } catch (e) {
      throw this.toHttp(e);
    }
  }

  /** SDK 에러를 앱에 보여줄 쉬운 메시지로 바꾼다 */
  private toHttp(e: unknown): HttpException {
    if (e instanceof HttpException) return e;
    if (e instanceof Anthropic.AuthenticationError) {
      return new HttpException('Anthropic API 키가 올바르지 않아요. server/.env 를 확인해 주세요.', HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (e instanceof Anthropic.RateLimitError) {
      return new HttpException('AI 요청이 잠시 많아요. 조금 뒤에 다시 시도해 주세요.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (e instanceof Anthropic.BadRequestError) {
      this.logger.error(`잘못된 요청: ${e.message}`);
      return new HttpException('AI 에 보낼 내용을 처리하지 못했어요.', HttpStatus.BAD_GATEWAY);
    }
    if (e instanceof Anthropic.APIConnectionError) {
      return new HttpException('AI 서비스에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.', HttpStatus.BAD_GATEWAY);
    }
    if (e instanceof Anthropic.APIError) {
      this.logger.error(`AI API 오류 ${e.status}: ${e.message}`);
      return new HttpException('AI 서비스에 문제가 생겼어요. 잠시 뒤에 다시 시도해 주세요.', HttpStatus.BAD_GATEWAY);
    }
    this.logger.error(e);
    return new HttpException('알 수 없는 문제가 생겼어요.', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
