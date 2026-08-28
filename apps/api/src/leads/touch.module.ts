import { Module } from '@nestjs/common';
import { TouchService } from './touch.service';

/**
 * Deliberately tiny and dependency-free, so any module that reaches out to a
 * lead can import it without pulling in LeadsModule and closing a cycle.
 */
@Module({
  providers: [TouchService],
  exports: [TouchService],
})
export class TouchModule {}
