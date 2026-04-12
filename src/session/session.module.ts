import { Module } from '@nestjs/common';
import { TestSessionService } from './session.service';

@Module({
  providers: [TestSessionService],
  exports: [TestSessionService],
})
export class SessionModule {}
