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
import { createPersistGate, createTask, loadState } from '@/lib/storage';
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
import { startReminderEngine, cancelRemindersByTask, cancelReminder, scheduleReminder } from '@/lib/notify';
import { mergeScheduleBlocks, runProposal } from '@/lib/scheduleRun';
import { repository } from '@/lib/repository';
import {
  generateProposal,
  type ReplanScope,
  type ScheduleProposal,
  type SchedulerV2Settings,
} from '@/lib/proposal';
import { applyProposal, undoTransaction, type ConfirmTransaction } from '@/lib/transaction';

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
interface ProposalSlice {
  /** The current preview proposal — NOT persisted, NOT written to scheduleBlocks. */
  proposal: ScheduleProposal | null;
  /** The most recent confirm transaction (one-level undo). */
  lastTransaction: ConfirmTransaction | null;
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
  // Phase 2: proposal workflow
  /** Compute a proposal from current state. Does NOT touch scheduleBlocks. */
  generateProposal: (
    settings: SchedulerV2Settings,
    from: string,
    opts?: { excludedTaskIds?: string[]; replanScope?: ReplanScope },
  ) => ScheduleProposal;
  /** Confirm the current proposal: write blocks via a transaction (undoable). */
  confirmProposal: () => void;
  /** Undo the most recent proposal confirm. */
  undoLastConfirm: () => void;
  /** Drop the current preview without confirming. */
  dismissProposal: () => void;
  /** Remove a proposed block from the preview. */
  removeProposedBlock: (id: string) => void;
  /** Edit a proposed block's time (date/startTime/endTime). */
  updateProposedBlock: (id: string, patch: { date?: string; startTime?: string; endTime?: string }) => void;
  /** Toggle the user-lock on a proposed block (locked blocks survive replan). */
  toggleProposedBlockLock: (id: string) => void;
  /** Regenerate a single task's proposed blocks inside the current preview. */
  regenerateTaskInProposal: (taskId: string) => void;
}

// ----------------------------------------------------------------- Contexts

const TasksContext = createContext<TasksSlice | null>(null);
const CoursesContext = createContext<CoursesSlice | null>(null);
const ScheduleBlocksContext = createContext<ScheduleBlocksSlice | null>(null);
const AvailabilityContext = createContext<AvailabilitySlice | null>(null);
const SettingsContext = createContext<SettingsSlice | null>(null);
const ProposalContext = createContext<ProposalSlice | null>(null);
const ActionsContext = createContext<ActionsSlice | null>(null);

export function FlowProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(loadState);
  const [state, setState] = useState<AppState>(initial.state);

  // Persistence gate
  const persistGate = useRef(createPersistGate(initial));
  useEffect(() => {
    if (persistGate.current(state)) {
      // Repository is the single persistence entry point. The default
      // LocalStorageRepository writes to localStorage via saveState internally;
      // SyncRepository writes locally + enqueues a remote mutation. The store
      // must NOT call saveState directly — that would double-write the same
      // payload to localStorage on every state change.
      repository.saveSnapshot(state).catch((e) => {
        // Surface unexpected persistence errors; never silently wipe data.
        console.warn('[FlowDay] saveSnapshot failed; data remains in memory.', e);
      });
    }
  }, [state]);

  // Reminder engine
  const stateRef = useRef(state);
  stateRef.current = state;

  // Phase 2: proposal preview + undo transaction (ephemeral, never persisted).
  const [proposal, setProposal] = useState<ScheduleProposal | null>(null);
  const [lastTransaction, setLastTransaction] = useState<ConfirmTransaction | null>(null);
  const proposalRef = useRef(proposal);
  proposalRef.current = proposal;
  const lastTransactionRef = useRef(lastTransaction);
  lastTransactionRef.current = lastTransaction;

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
    addScheduleBlock: (block) => {
      const created: ScheduleBlock = { ...block, createdAt: now(), updatedAt: now() };
      // Schedule reminder immediately for future blocks — do not wait for a
      // page reload (Phase 1 requirement).
      const task = stateRef.current.tasks.find((t) => t.id === created.taskId);
      if (task) scheduleReminder(created, task.title);
      setState((s) => ({
        ...s,
        scheduleBlocks: [...s.scheduleBlocks, created],
      }));
    },
    updateScheduleBlock: (id, patch) => {
      // Refresh reminder timer so a moved/edited future block keeps its
      // notification aligned to the new time.
      const existing = stateRef.current.scheduleBlocks.find((b) => b.id === id);
      if (existing) {
        const next = { ...existing, ...patch };
        const task = stateRef.current.tasks.find((t) => t.id === next.taskId);
        if (task) scheduleReminder(next, task.title);
        else cancelReminder(id);
      }
      setState((s) => ({
        ...s,
        scheduleBlocks: s.scheduleBlocks.map((b) =>
          b.id === id ? { ...b, ...patch, updatedAt: now() } : b,
        ),
      }));
    },
    deleteScheduleBlock: (id) => {
      cancelReminder(id);
      setState((s) => ({
        ...s,
        scheduleBlocks: s.scheduleBlocks.filter((b) => b.id !== id),
      }));
    },
    moveScheduleBlock: (id, date, startTime, endTime) => {
      const start = parseHHMM(startTime);
      const end = parseHHMM(endTime);
      const planned = end !== null && start !== null && end > start ? end - start : 0;
      // Cancel old timer and schedule a new one for the moved time.
      const existing = stateRef.current.scheduleBlocks.find((b) => b.id === id);
      if (existing) {
        const moved: ScheduleBlock = { ...existing, date, startTime, endTime, plannedMinutes: planned };
        const task = stateRef.current.tasks.find((t) => t.id === moved.taskId);
        if (task) scheduleReminder(moved, task.title);
        else cancelReminder(id);
      }
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
      const existing = stateRef.current.scheduleBlocks.find((b) => b.id === id);
      if (existing) {
        const start = parseHHMM(existing.startTime);
        const end = parseHHMM(endTime);
        const planned = end !== null && start !== null && end > start ? end - start : existing.plannedMinutes;
        const resized: ScheduleBlock = { ...existing, endTime, plannedMinutes: planned };
        const task = stateRef.current.tasks.find((t) => t.id === resized.taskId);
        if (task) scheduleReminder(resized, task.title);
        else cancelReminder(id);
      }
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
    // ---- Phase 2: proposal workflow ----
    generateProposal: (settings, from, opts) => {
      const s = stateRef.current;
      const p = runProposal({
        tasks: s.tasks,
        availability: s.availability,
        existingBlocks: s.scheduleBlocks,
        from,
        generatedAt: now(),
        settings,
        excludedTaskIds: opts?.excludedTaskIds,
        replanScope: opts?.replanScope,
      });
      setProposal(p);
      return p;
    },
    confirmProposal: () => {
      const p = proposalRef.current;
      if (!p) return;
      const s = stateRef.current;
      const { blocks, transaction } = applyProposal(s.scheduleBlocks, p, now());
      setState((prev) => ({ ...prev, scheduleBlocks: blocks }));
      setLastTransaction(transaction);
      setProposal(null);
    },
    undoLastConfirm: () => {
      const tx = lastTransactionRef.current;
      if (!tx) return;
      setState((prev) => ({ ...prev, scheduleBlocks: undoTransaction(prev.scheduleBlocks, tx) }));
      setLastTransaction(null);
    },
    dismissProposal: () => setProposal(null),
    removeProposedBlock: (id) => {
      const p = proposalRef.current;
      if (!p) return;
      setProposal({ ...p, blocks: p.blocks.filter((b) => b.block.id !== id) });
    },
    updateProposedBlock: (id, patch) => {
      const p = proposalRef.current;
      if (!p) return;
      setProposal({
        ...p,
        blocks: p.blocks.map((pb) => {
          if (pb.block.id !== id) return pb;
          const next = { ...pb.block, ...patch };
          // Recompute plannedMinutes from the (possibly new) times.
          const st = parseHHMM(next.startTime);
          const en = parseHHMM(next.endTime);
          if (st !== null && en !== null && en > st) next.plannedMinutes = en - st;
          return { ...pb, block: next };
        }),
      });
    },
    toggleProposedBlockLock: (id) => {
      const p = proposalRef.current;
      if (!p) return;
      setProposal({
        ...p,
        blocks: p.blocks.map((pb) =>
          pb.block.id === id ? { ...pb, lockedByUser: !pb.lockedByUser } : pb,
        ),
      });
    },
    regenerateTaskInProposal: (taskId) => {
      const p = proposalRef.current;
      if (!p) return;
      const s = stateRef.current;
      // Treat the other proposed blocks as busy so the regenerated task avoids
      // clashing with the rest of the preview.
      const otherProposed = p.blocks
        .filter((pb) => pb.block.taskId !== taskId)
        .map((pb) => ({ ...pb.block, source: 'scheduler' as const }));
      const regen = generateProposal({
        tasks: s.tasks,
        availability: s.availability,
        existingBlocks: [...s.scheduleBlocks, ...otherProposed],
        from: p.from,
        generatedAt: p.generatedAt,
        settings: p.settingsSnapshot,
        replanScope: { type: 'task', taskId },
      });
      setProposal({
        ...p,
        blocks: [
          ...p.blocks.filter((pb) => pb.block.taskId !== taskId),
          ...regen.blocks,
        ].sort((a, b) =>
          a.block.date !== b.block.date
            ? a.block.date < b.block.date
              ? -1
              : 1
            : a.block.startTime.localeCompare(b.block.startTime),
        ),
        unscheduled: [
          ...p.unscheduled.filter((u) => u.taskId !== taskId),
          ...regen.unscheduled,
        ],
      });
    },
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

  const proposalSlice = useMemo<ProposalSlice>(
    () => ({ proposal, lastTransaction }),
    [proposal, lastTransaction],
  );

  return (
    <TasksContext.Provider value={tasksSlice}>
      <CoursesContext.Provider value={coursesSlice}>
        <ScheduleBlocksContext.Provider value={scheduleBlocksSlice}>
          <AvailabilityContext.Provider value={availabilitySlice}>
            <SettingsContext.Provider value={settingsSlice}>
              <ProposalContext.Provider value={proposalSlice}>
                <ActionsContext.Provider value={actions}>
                  {children}
                </ActionsContext.Provider>
              </ProposalContext.Provider>
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

export function useProposal(): ProposalSlice {
  const ctx = useContext(ProposalContext);
  if (!ctx) throw new Error('useProposal must be used within FlowProvider');
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