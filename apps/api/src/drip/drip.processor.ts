import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, Job } from 'bullmq';
import { DripService } from './drip.service';
import { DRIP_QUEUE_NAME } from './drip.constants';

@Injectable()
export class DripProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DripProcessor.name);
  private worker: Worker;

  constructor(
    private dripService: DripService,
    private config: ConfigService,
  ) {}

  onModuleInit() {
    const redisHost = this.config.get<string>('REDIS_HOST', '');
    if (!redisHost) {
      this.logger.warn('⚠️  REDIS_HOST not set — drip worker disabled (BullMQ requires Redis). Drip sequences will use fallback setTimeout.');
      return;
    }

    const connection = {
      host: redisHost,
      port: this.config.get<number>('REDIS_PORT', 6379),
      maxRetriesPerRequest: null,
    };

    try {
      this.worker = new Worker(
        DRIP_QUEUE_NAME,
        async (job: Job) => {
          const { leadId, sequenceId } = job.data;

          switch (job.name) {
            case 'send-drip':
              this.logger.log(`Processing send-drip for lead ${leadId}`);
              await this.dripService.sendNextMessage(leadId, sequenceId);
              break;

            case 'drip-timeout':
              this.logger.log(`Processing drip-timeout for lead ${leadId}`);
              await this.dripService.handleTimeout(leadId, sequenceId);
              break;

            default:
              this.logger.warn(`Unknown job name: ${job.name}`);
          }
        },
        { connection, concurrency: 5 },
      );

      this.worker.on('failed', (job, err) => {
        this.logger.error(`Drip job ${job?.id} failed: ${err.message}`);
      });

      this.logger.log('Drip worker started');
    } catch (err) {
      this.logger.warn(`⚠️  Drip worker failed to start: ${err.message}`);
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
