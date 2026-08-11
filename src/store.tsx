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

// ----------------------------------------------------------------- Slice types
//
// The store is split into independent Contexts so a component that only reads
// `settings` doesn't re-render when `tasks` changes. The Actions slice is
// stable (useMemo deps: []) — every action uses either `setState(updater)` or
// `stateRef.current`, so it never needs to be recreated.

interface TasksSlice {
  tasks: Task[];
  taskById: Map<string, Task>;
}
interface CoursesSlice {
  courses: Course[];
  courseById: Map<string, Course>;
}
interface ScheduleBlocksSlice {
  scheduleBlocks: ScheduleBlock[];
}
interface AvailabilitySlice {
  availability: WeeklyAvailability;
}
interface SettingsSlice {
  settings: Settings;
}
interface ActionsSlice {
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

// ----------------------------------------------------------------- Contexts

const TasksContext = createContext<TasksSlice | null>(null);
const CoursesContext = createContext<CoursesSlice | null>(null);
const ScheduleBlocksContext = createContext<ScheduleBlocksSlice | null>(null);
const AvailabilityContext = createContext<AvailabilitySlice | null>(null);
const SettingsContext = createContext<SettingsSlice | null>(null);
const ActionsContext = createContext<ActionsSlice | null>(null);

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

  // ---- Actions: stable for the provider's lifetime ----
  // Every action uses `setState(updater)` or `stateRef.current`, so the set has
  // zero reactive dependencies and is created exactly once.
  const actions = useMemo<ActionsSlice>(() => ({
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
      const check = validateCourseName(name, stateRef.current.courses);
      if (!check.ok) return { ok: false, message: check.message };
      const course = createCourse(check.name, color);
      setState((s) => addCourseToState(s, course));
      return { ok: true, course };
    },
    updateCourse: (id, patch) => {
      const current = stateRef.current.courses.find((c) => c.id === id);
      if (!current) return { ok: false, message: '课程不存在' };
      const next: Partial<Pick<Course, 'name' | 'color'>> = {};
      if (patch.name !== undefined) {
        const check = validateCourseName(patch.name, stateRef.current.courses, id);
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
  }), []);

  // ---- Derived slices: each memoized on its own slice of state ----
  // A change to `tasks` recreates only `tasksSlice`; components that read only
  // `settings` or `courses` are not affected.
  const tasksSlice = useMemo<TasksSlice>(
    () => ({
      tasks: state.tasks,
      taskById: new Map(state.tasks.map((t) => [t.id, t])),
    }),
    [state.tasks],
  );

  const coursesSlice = useMemo<CoursesSlice>(
    () => ({
      courses: state.courses,
      courseById: courseMap(state.courses),
    }),
    [state.courses],
  );

  const scheduleBlocksSlice = useMemo<ScheduleBlocksSlice>(
    () => ({ scheduleBlocks: state.scheduleBlocks }),
    [state.scheduleBlocks],
  );

  const availabilitySlice = useMemo<AvailabilitySlice>(
    () => ({ availability: state.availability }),
    [state.availability],
  );

  const settingsSlice = useMemo<SettingsSlice>(
    () => ({ settings: state.settings }),
    [state.settings],
  );

  return (
    <TasksContext.Provider value={tasksSlice}>
      <CoursesContext.Provider value={coursesSlice}>
        <ScheduleBlocksContext.Provider value={scheduleBlocksSlice}>
          <AvailabilityContext.Provider value={availabilitySlice}>
            <SettingsContext.Provider value={settingsSlice}>
              <ActionsContext.Provider value={actions}>
                {children}
              </ActionsContext.Provider>
            </SettingsContext.Provider>
          </AvailabilityContext.Provider>
        </ScheduleBlocksContext.Provider>
      </CoursesContext.Provider>
    </TasksContext.Provider>
  );
}

// ----------------------------------------------------------------- Hooks
//
// Each hook subscribes to exactly one Context, so a component that calls
// `useSettings()` won't re-render when `tasks` changes — only when `settings`
// does. `useActions()` is stable for the provider's lifetime.

export function useTasks(): TasksSlice {
  const ctx = useContext(TasksContext);
  if (!ctx) throw new Error('useTasks must be used within FlowProvider');
  return ctx;
}

export function useCourses(): CoursesSlice {
  const ctx = useContext(CoursesContext);
  if (!ctx) throw new Error('useCourses must be used within FlowProvider');
  return ctx;
}

export function useScheduleBlocks(): ScheduleBlocksSlice {
  const ctx = useContext(ScheduleBlocksContext);
  if (!ctx) throw new Error('useScheduleBlocks must be used within FlowProvider');
  return ctx;
}

export function useAvailability(): AvailabilitySlice {
  const ctx = useContext(AvailabilityContext);
  if (!ctx) throw new Error('useAvailability must be used within FlowProvider');
  return ctx;
}

export function useSettings(): SettingsSlice {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within FlowProvider');
  return ctx;
}

export function useActions(): ActionsSlice {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error('useActions must be used within FlowProvider');
  return ctx;
}
