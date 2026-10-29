/** Small date helpers shared by the follow-up pickers. */

/** A Date as the value a datetime-local input wants, in local time. */
export function toDatetimeLocal(dt: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

/**
 * Today as a date input wants it ("2026-09-17"), in local time. Not
 * `toISOString().slice(0, 10)`, which is the UTC day and turns into tomorrow
 * after 8pm Eastern.
 */
export function todayLocal(): string {
  return toDatetimeLocal(new Date()).slice(0, 10);
}

/**
 * The quick follow-up picks. The same four everywhere a follow-up is set (the
 * call summary, the surplus panel, the follow-up modal) so the team learns one
 * set of buttons.
 */
export function quickDueDates(): { label: string; value: string }[] {
  const at = (days: number, hour: number) => {
    const t = new Date();
    t.setDate(t.getDate() + days);
    t.setHours(hour, 0, 0, 0);
    return toDatetimeLocal(t);
  };
  return [
    { label: 'In 1 hour', value: toDatetimeLocal(new Date(Date.now() + 3600_000)) },
    { label: 'Tomorrow 9am', value: at(1, 9) },
    { label: 'In 3 days', value: at(3, 9) },
    { label: 'Next week', value: at(7, 9) },
  ];
}

/** "3d overdue", "due today", "due in 5d", or "no date". */
export function dueLabel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'no date';
  // Calendar days, not hours rounded to days: rounding called 9am tomorrow
  // "due today" whenever it was read after 9pm.
  const due = new Date(iso);
  const today = new Date(now);
  const dayOf = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((dayOf(due) - dayOf(today)) / 86_400_000);
  if (days < 0) return `${-days}d overdue`;
  if (days === 0) return due.getTime() < now ? 'overdue today' : 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days}d`;
}

export function isOverdue(iso: string | null | undefined, now = Date.now()): boolean {
  return !!iso && new Date(iso).getTime() < now;
}
