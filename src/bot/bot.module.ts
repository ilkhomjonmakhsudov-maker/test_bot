import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { BotController } from './bot.controller';
import { UserSessionService } from './user-session.service';
import { TeacherModule } from '../teacher/teacher.module';
import { SessionModule } from '../session/session.module';
import { ExcelModule } from '../excel/excel.module';
import { AdminModule } from '../admin/admin.module';
import { PanelService } from './panel.service';
import { AdminController } from './admin.controller';

@Module({
  imports: [TeacherModule, SessionModule, ExcelModule, AdminModule],
  controllers: [BotController, AdminController],
  providers: [BotService, UserSessionService, PanelService],
  exports: [BotService],
})
export class BotModule {}
