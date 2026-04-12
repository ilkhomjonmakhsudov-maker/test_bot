import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { BotController } from './bot.controller';
import { UserSessionService } from './user-session.service';
import { TeacherModule } from '../teacher/teacher.module';
import { SessionModule } from '../session/session.module';
import { ExcelModule } from '../excel/excel.module';

@Module({
  imports: [TeacherModule, SessionModule, ExcelModule],
  controllers: [BotController],
  providers: [BotService, UserSessionService],
  exports: [BotService],
})
export class BotModule {}
