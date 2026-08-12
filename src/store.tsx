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
  normalizeAvailability,
  normalizeCourseColor,
  updateCourseInState,
  validateCourseName,
} from '@/lib/domain';
import { startReminderEngine, cancelRemindersByTask } from '@/lib/notify';
import { mergeScheduleBlocks } from '@/lib/scheduleRun';
import { repository } from '@/lib/repository';

export type CourseResult = { ok: true; course: Course } | { ok: false; message: string };

// ----------------------------------------------------------------- Slice types

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
  deleteCourse: (id: string) => void;
  updateAvailability: (day: Weekday, slots: AvailabilitySlot[]) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  addScheduleBlocks: (blocks: ScheduleBlock[]) => void;
  // Phase 1: full ScheduleBlock lifecycle
  addScheduleBlock: (block: ScheduleBlock) => void;
  updateScheduleBlock: (id: string, patch: Partial<ScheduleBlock>) => void;
  deleteScheduleBlock: (id: string) => void;
  moveScheduleBlock: (id: string, date: string, startTime: string, endTime: string) => void;
  resizeScheduleBlock: (id: string, endTime: string) => void;
  lockScheduleBlock: (id: string, locked: boolean) => void;
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

  // Persistence gate
  const persistGate = useRef(createPersistGate(initial));
  useEffect(() => {
    if (persistGate.current(state)) {
      saveState(state);
      // Also notify repository
      repository.saveSnapshot(state).catch(() => {});
    }
  }, [state]);

  // Reminder engine
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    return startReminderEngine(
      () => stateRef.current.tasks,
      () => stateRef.current.settings,
      () => stateRef.current.scheduleBlocks,
      () => stateRef.current.tasks.reduce((m, t) => { m.set(t.id, t); return m; }, new Map()),
    );
  }, []);

  const now = () => Date.now();

  // ---- Actions ----
  const actions = useMemo<ActionsSlice>(() => ({
    addTask: (partial) => {
      const t = createTask(partial);
      setState((s) => ({ ...s, tasks: [t, ...s.tasks] }));
      return t;
    },
    updateTask: (id, patch) =>
      setState((s) => ({
        ...s,
        tasks: s.tasks.map((t) =>
          t.id === id ? { ...t, ...patch, updatedAt: now() } : t,
        ),
      })),
    deleteTask: (id) => {
      const blockIds = stateRef.current.scheduleBlocks
        .filter((b) => b.taskId === id)
        .map((b) => b.id);
      cancelRemindersByTask(blockIds);
      setState((s) => ({
        ...s,
        tasks: s.tasks.filter((t) => t.id !== id),
        scheduleBlocks: s.scheduleBlocks.filter((b) => b.taskId !== id),
      }));
    },
    toggleDone: (id) =>
      setState((s) => ({
        ...s,
        tasks: s.tasks.map((t) =>
          t.id === id
            ? {
                ...t,
                status: t.status === 'done' ? 'todo' : 'done',
                completedAt: t.status === 'done' ? null : now(),
                updatedAt: now(),
              }
            : t,
        ),
      })),
    setStatus: (id, status) =>
      setState((s) => ({
        ...s,
        tasks: s.tasks.map((t) =>
          t.id === id
            ? { ...t, status, completedAt: status === 'done' ? now() : null, updatedAt: now() }
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
    updateAvailability: (day, slots) =>
      setState((s) => ({
        ...s,
        availability: { ...s.availability, [day]: normalizeAvailability(slots) },
      })),
    updateSettings: (patch) =>
      setState((s) => ({ ...s, settings: { ...s.settings, ...patch } })),
    addScheduleBlocks: (blocks) =>
      setState((s) => ({ ...s, scheduleBlocks: mergeScheduleBlocks(s.scheduleBlocks, blocks) })),
    // Phase 1: ScheduleBlock CRUD
    addScheduleBlock: (block) =>
      setState((s) => ({
        ...s,
        scheduleBlocks: [...s.scheduleBlocks, { ...block, createdAt: now(), updatedAt: now() }],
      })),
    updateScheduleBlock: (id, patch) =>
      setState((s) => ({
        ...s,
        scheduleBlocks: s.scheduleBlocks.map((b) =>
          b.id === id ? { ...b, ...patch, updatedAt: now() } : b,
        ),
      })),
    deleteScheduleBlock: (id) => {
      cancelRemindersByTask([id]);
      setState((s) => ({
        ...s,
        scheduleBlocks: s.scheduleBlocks.filter((b) => b.id !== id),
      }));
    },
    moveScheduleBlock: (id, date, startTime, endTime) => {
      const start = parseHHMM(startTime);
      const end = parseHHMM(endTime);
      const planned = end !== null && start !== null && end > start ? end - start : 0;
      setState((s) => ({
        ...s,
        scheduleBlocks: s.scheduleBlocks.map((b) =>
          b.id === id
            ? { ...b, date, startTime, endTime, plannedMinutes: planned, updatedAt: now() }
            : b,
        ),
      }));
    },
    resizeScheduleBlock: (id, endTime) => {
      setState((s) => {
        const block = s.scheduleBlocks.find((b) => b.id === id);
        if (!block) return s;
        const start = parseHHMM(block.startTime);
        const end = parseHHMM(endTime);
        const planned = end !== null && start !== null && end > start ? end - start : block.plannedMinutes;
        return {
          ...s,
          scheduleBlocks: s.scheduleBlocks.map((b) =>
            b.id === id ? { ...b, endTime, plannedMinutes: planned, updatedAt: now() } : b,
          ),
        };
      });
    },
    lockScheduleBlock: (id, locked) =>
      setState((s) => ({
        ...s,
        scheduleBlocks: s.scheduleBlocks.map((b) =>
          b.id === id ? { ...b, locked, updatedAt: now() } : b,
        ),
      })),
  }), []);

  // ---- Derived slices ----
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

// Helper used by ScheduleBlock CRUD
function parseHHMM(v: string): number | null {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)) return null;
  const [h, m] = v.split(':').map(Number);
  return h * 60 + m;
}