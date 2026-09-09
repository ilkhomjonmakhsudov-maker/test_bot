import { Global, Module } from '@nestjs/common';
import { StatsService } from './stats.service';

/**
 * Global — statistikani ham sessiya xizmati (yozish), ham admin paneli
 * (o'qish) ishlatadi.
 */
@Global()
@Module({
  providers: [StatsService],
  exports: [StatsService],
})
export class StatsModule {}
