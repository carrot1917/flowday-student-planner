import type { Course, Priority, Status, Tag } from '@/types';
import {
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TAG_COLORS,
  TAG_LABELS,
  UNCATEGORIZED_COLOR,
  UNCATEGORIZED_LABEL,
} from '@/types';

export function PriorityDot({ priority }: { priority: Priority }) {
  return (
    <span className={`inline-block h-2.5 w-2.5 rounded-full ${PRIORITY_COLORS[priority]}`} title={`优先级: ${PRIORITY_LABELS[priority]}`} />
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${PRIORITY_COLORS[priority]} text-white`}>
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

/** @deprecated Phase 2 replaced this with <CourseBadge>. Kept until `Task.tag` is removed in Phase 3. */
export function TagBadge({ tag }: { tag: Tag }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${TAG_COLORS[tag]}`}>
      {TAG_LABELS[tag]}
    </span>
  );
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Renders a Course chip. `course` may be undefined — that happens for tasks with
 * no course AND for tasks whose course was deleted (we never cascade-delete
 * tasks), so this component must never assume a course exists.
 */
export function CourseBadge({ course }: { course?: Course }) {
  const name = course?.name ?? UNCATEGORIZED_LABEL;
  const hex = course && HEX_RE.test(course.color) ? course.color : UNCATEGORIZED_COLOR;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{
        backgroundColor: `${hex}1f`,
        color: hex,
        boxShadow: `inset 0 0 0 1px ${hex}3d`,
      }}
      title={course ? `课程: ${name}` : '未归属任何课程'}
    >
      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: hex }} />
      <span className="max-w-[9rem] truncate">{name}</span>
    </span>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  const styles: Record<Status, string> = {
    todo: 'bg-slate-100 text-slate-500 ring-slate-200',
    doing: 'bg-brand-100 text-brand-600 ring-brand-200',
    done: 'bg-emerald-100 text-emerald-600 ring-emerald-200',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${styles[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

interface CheckboxProps {
  checked: boolean;
  onChange: () => void;
  size?: 'sm' | 'md' | 'lg';
}

export function Checkbox({ checked, onChange, size = 'md' }: CheckboxProps) {
  const dim = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-6 w-6' : 'h-5 w-5';
  return (
    <button
      onClick={onChange}
      className={`flex ${dim} flex-shrink-0 items-center justify-center rounded-lg border-2 transition-all ${
        checked
          ? 'border-brand-500 bg-brand-500 text-white'
          : 'border-brand-200 bg-white hover:border-brand-400'
      }`}
      aria-checked={checked}
      role="checkbox"
    >
      {checked && (
        <svg viewBox="0 0 24 24" fill="none" className="h-3/5 w-3/5 tick-anim">
          <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

export function EmptyState({ icon: Icon, title, hint }: { icon: React.ComponentType<{ className?: string }>; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-brand-50 to-brand-100 text-brand-300">
        <Icon className="h-8 w-8" />
      </div>
      <p className="mt-4 text-sm font-semibold text-ink-700">{title}</p>
      {hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
    </div>
  );
}
