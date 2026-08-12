import React from 'react';
import type { Course, Priority, Status } from '@/types';
import {
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  STATUS_LABELS,
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

// ---------------------------------------------------------------------------
// UI Primitives — Phase 1
// ---------------------------------------------------------------------------

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

export function Button({ variant = 'primary', size = 'md', className = '', children, ...rest }: ButtonProps) {
  const base = 'inline-flex items-center justify-center gap-1.5 font-semibold transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-40';
  const variants: Record<string, string> = {
    primary: 'bg-brand-500 text-white shadow-md shadow-brand-300/40 hover:bg-brand-600 rounded-2xl',
    secondary: 'bg-brand-50 text-brand-600 hover:bg-brand-100 rounded-2xl',
    ghost: 'text-ink-500 hover:bg-brand-50 rounded-xl',
    danger: 'bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-2xl',
  };
  const sizes: Record<string, string> = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-2.5 text-base',
  };
  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', id, ...rest }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-xs font-semibold text-ink-500">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`rounded-xl border bg-sand-50 px-3.5 py-2.5 text-sm outline-none transition focus:bg-white focus:ring-2 ${
            error
              ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-200'
              : 'border-brand-100 focus:border-brand-400 focus:ring-brand-200'
          } ${className}`}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : undefined}
          {...rest}
        />
        {error && (
          <p id={`${inputId}-error`} className="text-[11px] text-rose-500" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  },
);
Input.displayName = 'Input';

// Simple focus-trap hook for dialogs
function useFocusTrap(open: boolean) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open || !ref.current) return;
    const prev = document.activeElement as HTMLElement | null;
    // Focus the first focusable element inside the dialog
    const focusable = ref.current.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !ref.current) return;
      const els = ref.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (els.length === 0) return;
      const first = els[0]!;
      const last = els[els.length - 1]!;
      if (e.shiftKey) {
        if (document.activeElement === first) { last.focus(); e.preventDefault(); }
      } else {
        if (document.activeElement === last) { first.focus(); e.preventDefault(); }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      // Focus return: restore focus to the trigger element
      prev?.focus();
    };
  }, [open]);
  return ref;
}

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function Dialog({ open, onClose, title, children }: DialogProps) {
  const trapRef = useFocusTrap(open);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/30 backdrop-blur-sm sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-pop-in w-full max-w-lg overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-brand-50 px-6 py-4">
          <h2 className="text-base font-bold text-ink-900">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-400 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            aria-label="关闭"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
