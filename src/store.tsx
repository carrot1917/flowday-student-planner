import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  AppState,
  AvailabilitySlot,
  Course,
  ScheduleBlock,
  Settings,
  Task,
  Weekday,
  WeeklyAvailability,
} from '@/types';
import { createPersistGate, createTask, loadState, saveState } from '@/lib/storage';
import {
  addCourseToState,
  courseMap,
  createCourse,
  deleteCourseFromState,
  normalizeCourseColor,
  updateCourseInState,
  validateCourseName,
} from '@/lib/domain';
import { startReminderEngine } from '@/lib/notify';
import { mergeScheduleBlocks } from '@/lib/scheduleRun';

export type CourseResult = { ok: true; course: Course } | { ok: false; message: string };

interface FlowContextValue {
  tasks: Task[];
  courses: Course[];
  courseById: Map<string, Course>;
  scheduleBlocks: ScheduleBlock[];
  taskById: Map<string, Task>;
  /** When the user CAN study (Phase 4A). Input for the Phase 4B scheduler. */
  availability: WeeklyAvailability;
  settings: Settings;
  addTask: (partial?: Partial<Task>) => Task;
  updateTask: (id: string, patch: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  toggleDone: (id: string) => void;
  setStatus: (id: string, status: Task['status']) => void;
  addCourse: (name: string, color: string) => CourseResult;
  updateCourse: (id: string, patch: { name?: string; color?: string }) => CourseResult;
  /** Deletes the course only. Its tasks stay and become '未分类'. */
  deleteCourse: (id: string) => void;
  /** Replaces ONE weekday's slots. Every other weekday is left untouched. */
  updateAvailability: (day: Weekday, slots: AvailabilitySlot[]) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  /** Appends scheduler suggestions to the user's blocks (id-deduplicated). */
  addScheduleBlocks: (blocks: ScheduleBlock[]) => void;
}

const FlowContext = createContext<FlowContextValue | null>(null);

export function FlowProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(loadState);
  const [state, setState] = useState<AppState>(initial.state);

  // Persistence gate. It only suppresses the *boot* write (so a corrupt v2 is
  // never silently clobbered, including under StrictMode's double effect run).
  // Every state object produced by a user action goes straight to disk.
  const persistGate = useRef(createPersistGate(initial));
  useEffect(() => {
    if (persistGate.current(state)) saveState(state);
  }, [state]);

  // Reminder engine reads latest state via refs without re-subscribing.
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    return startReminderEngine(
      () => stateRef.current.tasks,
      () => stateRef.current.settings,
    );
  }, []);

  const value = useMemo<FlowContextValue>(() => ({
    tasks: state.tasks,
    courses: state.courses,
    courseById: courseMap(state.courses),
    scheduleBlocks: state.scheduleBlocks,
    taskById: new Map<string, Task>(state.tasks.map((t) => [t.id, t])),
    availability: state.availability,
    settings: state.settings,
    addTask: (partial) => {
      const t = createTask(partial);
      setState((s) => ({ ...s, tasks: [t, ...s.tasks] }));
      return t;
    },
    updateTask: (id, patch) =>
      setState((s) => ({
        ...s,
        tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      })),
    deleteTask: (id) =>
      setState((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== id) })),
    toggleDone: (id) =>
      setState((s) => ({
        ...s,
        tasks: s.tasks.map((t) =>
          t.id === id
            ? {
                ...t,
                status: t.status === 'done' ? 'todo' : 'done',
                completedAt: t.status === 'done' ? null : Date.now(),
              }
            : t,
        ),
      })),
    setStatus: (id, status) =>
      setState((s) => ({
        ...s,
        tasks: s.tasks.map((t) =>
          t.id === id
            ? { ...t, status, completedAt: status === 'done' ? Date.now() : null }
            : t,
        ),
      })),
    addCourse: (name, color) => {
      const check = validateCourseName(name, state.courses);
      if (!check.ok) return { ok: false, message: check.message };
      const course = createCourse(check.name, color);
      setState((s) => addCourseToState(s, course));
      return { ok: true, course };
    },
    updateCourse: (id, patch) => {
      const current = state.courses.find((c) => c.id === id);
      if (!current) return { ok: false, message: '课程不存在' };
      const next: Partial<Pick<Course, 'name' | 'color'>> = {};
      if (patch.name !== undefined) {
        const check = validateCourseName(patch.name, state.courses, id);
        if (!check.ok) return { ok: false, message: check.message };
        next.name = check.name;
      }
      if (patch.color !== undefined) next.color = normalizeCourseColor(patch.color);
      setState((s) => updateCourseInState(s, id, next));
      return { ok: true, course: { ...current, ...next } };
    },
    deleteCourse: (id) => setState((s) => deleteCourseFromState(s, id)),
    // Immutable per-day write: a fresh availability object + a fresh array for
    // the edited day. Persistence is the existing effect — storage is untouched.
    updateAvailability: (day, slots) =>
      setState((s) => ({
        ...s,
        availability: { ...s.availability, [day]: [...slots] },
      })),
    updateSettings: (patch) =>
      setState((s) => ({ ...s, settings: { ...s.settings, ...patch } })),
    // One setState: append (never overwrite / delete), id-deduplicated via the
    // pure helper. Persistence is the existing effect — storage is untouched.
    addScheduleBlocks: (blocks) =>
      setState((s) => ({ ...s, scheduleBlocks: mergeScheduleBlocks(s.scheduleBlocks, blocks) })),
  }), [state]);

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useFlow(): FlowContextValue {
  const ctx = useContext(FlowContext);
  if (!ctx) throw new Error('useFlow must be used within FlowProvider');
  return ctx;
}
