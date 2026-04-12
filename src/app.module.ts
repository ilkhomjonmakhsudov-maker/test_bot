import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import appConfig from './config/app.config';
import { BotModule } from './bot/bot.module';
import { SessionModule } from './session/session.module';
import { TeacherModule } from './teacher/teacher.module';
import { ExcelModule } from './excel/excel.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: '.env',
    }),
    TeacherModule,
    SessionModule,
    ExcelModule,
    BotModule,
  ],
})
export class AppModule {}
