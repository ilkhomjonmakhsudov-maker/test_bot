import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { SessionModule } from '../session/session.module';
import { TeacherModule } from '../teacher/teacher.module';

@Module({
  imports: [SessionModule, TeacherModule],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
