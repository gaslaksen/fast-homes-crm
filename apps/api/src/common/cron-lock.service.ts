import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A cross-replica lock for scheduled jobs.
 *
 * Every @Cron in this codebase guards itself with an in-PROCESS flag, which
 * stops a slow run stacking on the next one and does nothing at all about a
 * second replica. Production runs more than one: the surplus poll writes two
 * SurplusPollRun rows within twenty milliseconds of each other every morning,
 * one succeeding and one timing out against the county, and it has done so
 * every day since the poll was switched on.
 *
 * Duplicate work is merely wasteful for an idempotent ingest. It is not
 * harmless everywhere: the Daily Brief guards on the same kind of in-process
 * flag, so two replicas mean every recipient gets the email twice.
 *
 * Implemented with a Postgres session-level advisory lock, which needs no table
 * and is released automatically if the process dies mid-run. That last part is
 * why this is not a row in a locks table: a crashed replica holding a row lock
 * would silently stop the job for good, and nobody would notice until somebody
 * asked why leads had stopped arriving.
 */
@Injectable()
export class CronLockService {
  private readonly logger = new Logger(CronLockService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Run `fn` only if this replica wins the lock for `key`. Returns what `fn`
   * returned, or null if another replica already holds it.
   *
   * Failing OPEN is deliberate: if the lock cannot be taken because the query
   * itself failed, the job runs. A duplicate poll costs a little work, while a
   * silently skipped one costs a day of leads.
   */
  async run<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    const id = this.keyToId(key);
    let held = false;
    try {
      const rows = await this.prisma.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_lock(${id}::bigint) AS locked
      `;
      held = !!rows?.[0]?.locked;
      if (!held) {
        this.logger.log(`Skipping "${key}": another replica is running it`);
        return null;
      }
    } catch (e: any) {
      this.logger.warn(`Advisory lock for "${key}" unavailable (${e.message}), running anyway`);
      return fn();
    }

    try {
      return await fn();
    } finally {
      try {
        await this.prisma.$queryRaw`SELECT pg_advisory_unlock(${id}::bigint)`;
      } catch (e: any) {
        // The lock is session-scoped, so it goes when the connection does.
        this.logger.warn(`Could not release the lock for "${key}": ${e.message}`);
      }
    }
  }

  /**
   * A stable id for a lock name.
   *
   * Postgres advisory locks are keyed by a signed 64-bit integer, not by text,
   * so the name is hashed with FNV-1a and masked to 63 bits. That keeps it
   * inside the POSITIVE range of a signed bigint: an unmasked 64-bit hash would
   * land in the negative half, which Postgres accepts but which makes the value
   * in a log impossible to match against the one here.
   *
   * Carried as a BigInt end to end, so nothing is rounded on the way. Going
   * through a JS number would silently truncate above 2^53 and two job names
   * could collide into one lock, which presents as a job that mysteriously
   * never runs.
   */
  private keyToId(key: string): bigint {
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    const mask = (1n << 63n) - 1n;
    for (const ch of key) {
      hash = ((hash ^ BigInt(ch.charCodeAt(0))) * prime) & mask;
    }
    return hash;
  }
}
