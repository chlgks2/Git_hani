import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from './ai/ai.module.js';

@Module({
  // .env 파일의 값(ANTHROPIC_API_KEY 등)을 process.env 로 읽어 온다
  imports: [ConfigModule.forRoot({ isGlobal: true }), AiModule],
})
export class AppModule {}
