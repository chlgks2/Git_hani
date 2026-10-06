import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

describe('AI 서버 (e2e)', () => {
  let app: INestApplication<App>;
  const key = process.env.ANTHROPIC_API_KEY;

  beforeEach(async () => {
    delete process.env.ANTHROPIC_API_KEY; // 실제 AI 를 부르지 않는다
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    if (key) process.env.ANTHROPIC_API_KEY = key;
  });

  it('GET /health', () =>
    request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res) => expect(res.body).toMatchObject({ ok: true, ai: false })));

  it('잘못된 본문은 400', () =>
    request(app.getHttpServer()).post('/ai/summarize').send({ files: [] }).expect(400));

  it('키가 없으면 503 + 안내 문구', () =>
    request(app.getHttpServer())
      .post('/ai/commit-message')
      .send({ files: [{ path: 'a.js', status: 'M', patch: '+1' }] })
      .expect(503)
      .expect((res) => expect(res.body.message).toContain('ANTHROPIC_API_KEY')));
});
