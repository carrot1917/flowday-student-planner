import { useMemo, useState } from 'react';
import { Calendar, CircleAlert, Clock, Plus, Trash2 } from 'lucide-react';
import { useAvailability, useSettings, useActions } from '@/store';
import {
  WEEKDAY_LABELS,
  formatEstimate,
  parseHHMM,
  totalAvailableMinutes,
  validateAvailabilitySlot,
  weekdaysOrdered,
} from '@/lib/domain';
import { minutesToHHMM } from '@/lib/date';
import type { AvailabilitySlot, Weekday } from '@/types';

// Phase 4A — Weekly Availability editor.
//
// Availability = WHEN THE USER CAN STUDY. It is deliberately NOT a schedule:
// no task is referenced here. Phase 4B reads this plus the task list and emits
// `ScheduleBlock[]`; Phase 4C adds conflict rules (overlap / daily caps).

const DAY_END = 23 * 60 + 59;
const DEFAULT_SLOT: AvailabilitySlot = { startTime: '09:00', endTime: '10:00' };

/** A sensible new row: right after the previous one, else the 09:00 default. */
function nextSlot(slots: AvailabilitySlot[]): AvailabilitySlot {
  const last = slots[slots.length - 1];
  const lastEnd = last ? parseHHMM(last.endTime) : null;
  if (lastEnd === null || lastEnd >= DAY_END - 30) return { ...DEFAULT_SLOT };
  return {
    startTime: minutesToHHMM(lastEnd),
    endTime: minutesToHHMM(Math.min(lastEnd + 60, DAY_END)),
  };
}

export function AvailabilityPage() {
  const { availability } = useAvailability();
  const { settings } = useSettings();
  const { updateAvailability } = useActions();

  const days = useMemo(() => weekdaysOrdered(settings.startOfWeek), [settings.startOfWeek]);
  const weekMinutes = useMemo(
    () => days.reduce((sum, d) => sum + totalAvailableMinutes(availability[d]), 0),
    [days, availability],
  );

  return (
    <div className="animate-fade-in mx-auto max-w-2xl space-y-5">
      {/* Hero */}
      <div className="rounded-[24px] border border-brand-100 bg-white/70 p-5">
        <div className="flex items-center gap-3">
          <Calendar className="h-6 w-6 text-brand-500" />
          <div className="flex-1">
            <p className="text-sm font-bold text-ink-900">每周可用时间</p>
            <p className="text-xs text-ink-500">
              设定每天可以学习的时段，用于后续自动排期。这里只描述「有空」，不绑定任务。
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between rounded-2xl bg-sand-50 px-4 py-3">
          <span className="text-xs text-ink-500">本周可用总时长</span>
          <span className="text-sm font-bold text-brand-600">
            {weekMinutes > 0 ? formatEstimate(weekMinutes) : '未设置'}
          </span>
        </div>
      </div>

      {days.map((day) => (
        <DayEditor
          key={day}
          day={day}
          slots={availability[day] ?? []}
          onChange={(slots) => updateAvailability(day, slots)}
        />
      ))}

      <p className="px-2 text-center text-xs text-ink-400">
        可用时间保存在本地，后续排期会优先把任务安排进这些时段
      </p>
    </div>
  );
}

interface DayEditorProps {
  day: Weekday;
  slots: AvailabilitySlot[];
  onChange: (slots: AvailabilitySlot[]) => void;
}

function DayEditor({ day, slots, onChange }: DayEditorProps) {
  // Local draft, so a half-typed / invalid row never reaches the store — the
  // Phase 4B scheduler must only ever read validated slots.
  const [draft, setDraft] = useState<AvailabilitySlot[]>(slots);
  const [synced, setSynced] = useState(slots);
  if (synced !== slots) {
    setSynced(slots);
    setDraft(slots);
  }

  const results = draft.map((s) => validateAvailabilitySlot(s.startTime, s.endTime));
  const dayMinutes = totalAvailableMinutes(draft);

  // Commit only when EVERY row of THIS day is valid. Other days are unaffected
  // because the store writes one weekday at a time.
  const commit = (next: AvailabilitySlot[]) => {
    setDraft(next);
    if (next.every((s) => validateAvailabilitySlot(s.startTime, s.endTime).ok)) {
      onChange(next);
    }
  };

  const patch = (i: number, p: Partial<AvailabilitySlot>) =>
    commit(draft.map((s, idx) => (idx === i ? { ...s, ...p } : s)));
  const remove = (i: number) => commit(draft.filter((_, idx) => idx !== i));
  const add = () => commit([...draft, nextSlot(draft)]);

  return (
    <div className="rounded-[24px] border border-brand-100 bg-white/70 p-5">
      <div className="flex items-center gap-2">
        <Clock className="h-5 w-5 text-brand-500" />
        <p className="text-sm font-bold text-ink-900">{WEEKDAY_LABELS[day]}</p>
        {dayMinutes > 0 && (
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-600">
            {formatEstimate(dayMinutes)}
          </span>
        )}
      </div>

      <div className="mt-4 space-y-2">
        {draft.length === 0 ? (
          <p className="rounded-2xl bg-sand-50 px-4 py-6 text-center text-xs text-ink-400">
            这天还没有可用时间，添加一个时段吧
          </p>
        ) : (
          draft.map((slot, i) => {
            const res = results[i];
            return (
              <div
                key={i}
                className={`rounded-2xl border px-3.5 py-3 ${
                  res.ok ? 'border-brand-50 bg-white' : 'border-rose-200 bg-rose-50/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    aria-label={`${WEEKDAY_LABELS[day]} 第 ${i + 1} 段开始时间`}
                    value={slot.startTime}
                    onChange={(e) => patch(i, { startTime: e.target.value })}
                    className="min-w-0 flex-1 rounded-xl border border-brand-100 bg-sand-50 px-3 py-2 text-sm outline-none transition focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-200"
                  />
                  <span className="flex-shrink-0 text-xs text-ink-400">至</span>
                  <input
                    type="time"
                    aria-label={`${WEEKDAY_LABELS[day]} 第 ${i + 1} 段结束时间`}
                    value={slot.endTime}
                    onChange={(e) => patch(i, { endTime: e.target.value })}
                    className="min-w-0 flex-1 rounded-xl border border-brand-100 bg-sand-50 px-3 py-2 text-sm outline-none transition focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-200"
                  />
                  <button
                    onClick={() => remove(i)}
                    aria-label={`删除 ${WEEKDAY_LABELS[day]} 第 ${i + 1} 段`}
                    className="flex-shrink-0 rounded-lg p-1.5 text-ink-400 transition hover:bg-rose-50 hover:text-rose-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {!res.ok && (
                  <p className="mt-2 flex items-center gap-1 text-[11px] text-rose-500">
                    <CircleAlert className="h-3 w-3" /> {res.message}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>

      <button
        onClick={add}
        className="mt-3 flex items-center gap-1.5 rounded-2xl bg-brand-50 px-3.5 py-2 text-sm font-semibold text-brand-600 transition hover:bg-brand-100"
      >
        <Plus className="h-4 w-4" /> 添加时间段
      </button>
    </div>
  );
}
