import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

/** 이 서버를 부를 수 있는 화면 주소들 (데스크톱 앱, 개발 중인 웹 화면) */
const DEFAULT_ORIGINS = ['http://tauri.localhost', 'tauri://localhost', 'http://localhost:5173'];

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // 변경 내용(diff)을 보내므로 기본(100KB)보다 크게 받는다
  app.useBodyParser('json', { limit: '2mb' });
  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',').map((s) => s.trim()) ?? DEFAULT_ORIGINS,
  });
  await app.listen(process.env.PORT ?? 4000);
}
await bootstrap();
