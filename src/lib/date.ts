// Date helpers — all pure, no side effects.

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Strict ISO (YYYY-MM-DD) parse with a round-trip guard, so overflow dates such
 * as 2026-13-40 / 2026-02-30 and loosely padded ones like 2026-8-1 are rejected
 * instead of silently rolling over. Returns null for anything unparseable.
 *
 * Shared by every layer that must not trust a stored date string
 * (deadline bucketing, the scheduler horizon, weekday lookup).
 */
export function safeFromISO(s: string | undefined | null): Date | null {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = fromISO(s);
  if (Number.isNaN(d.getTime())) return null;
  return toISO(d) === s ? d : null;
}

export function todayISO(): string {
  return toISO(new Date());
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

export function startOfWeek(d: Date, weekStartsOn: 0 | 1 = 1): Date {
  const r = new Date(d);
  const day = r.getDay();
  const diff = (day - weekStartsOn + 7) % 7;
  r.setDate(r.getDate() - diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isSameISO(a: string, b: string): boolean {
  return a === b;
}

export function diffDays(a: Date, b: Date): number {
  const ms = 1000 * 60 * 60 * 24;
  const aMid = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const bMid = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((aMid.getTime() - bMid.getTime()) / ms);
}

export function formatLong(d: Date): string {
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
}

export function formatShort(s: string): string {
  const d = fromISO(s);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function relativeDue(s: string | undefined | null): { label: string; tone: 'overdue' | 'today' | 'soon' | 'later' } {
  if (!s) return { label: '无截止日期', tone: 'later' };
  const today = new Date();
  const due = safeFromISO(s);
  if (!due) return { label: '日期无效', tone: 'later' };
  const diff = diffDays(due, today);
  if (diff < 0) return { label: `逾期 ${-diff} 天`, tone: 'overdue' };
  if (diff === 0) return { label: '今天', tone: 'today' };
  if (diff === 1) return { label: '明天', tone: 'soon' };
  if (diff <= 3) return { label: `${diff} 天后`, tone: 'soon' };
  return { label: formatShort(s), tone: 'later' };
}

export function minutesToHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function hhmmToMinutes(s: string): number {
  if (!s) return 0;
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}
