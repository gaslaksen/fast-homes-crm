import type { ActionItem } from '../actions.types';
import { ACTION_PRIORITIES } from './priorities';
import { LeadForRules, formatAge, snapshotOf } from './types';

/**
 * FOLLOW_UP_DUE: a manually-scheduled Task has reached its due date and is
 * not yet completed. Overdue items bump priority.
 */
export function evaluateFollowUpDue(
  leads: LeadForRules[],
  now: Date,
): ActionItem[] {
  const out: ActionItem[] = [];
  const nowMs = now.getTime();

  for (const lead of leads) {
    for (const task of lead.tasks) {
      if (task.completed || !task.dueDate) continue;
      const dueMs = new Date(task.dueDate).getTime();
      if (dueMs > nowMs) continue;

      const overdueMs = nowMs - dueMs;
      const isOverdue = overdueMs >= 24 * 60 * 60 * 1000;
      const priority = isOverdue
        ? ACTION_PRIORITIES.FOLLOW_UP_DUE +
          ACTION_PRIORITIES.FOLLOW_UP_OVERDUE_BUMP
        : ACTION_PRIORITIES.FOLLOW_UP_DUE;

      const subtitle = isOverdue
        ? `Overdue by ${formatAge(overdueMs)} — ${lead.propertyAddress}`
        : `Due now — ${lead.propertyAddress}`;

      out.push({
        actionKey: `FOLLOW_UP_DUE:${task.id}`,
        type: 'FOLLOW_UP_DUE',
        priority,
        leadId: lead.id,
        lead: snapshotOf(lead),
        title: task.title || 'Follow up',
        subtitle,
        suggestedAction: { verb: 'Complete' },
        createdAt: new Date(task.dueDate).toISOString(),
      });
    }
  }

  return out;
}
