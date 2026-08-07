import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppState, Settings, Task } from '@/types';
import { createTask, loadState, saveState, seedDemoTasks } from '@/lib/storage';
import { startReminderEngine } from '@/lib/notify';

interface FlowContextValue {
  tasks: Task[];
  settings: Settings;
  addTask: (partial?: Partial<Task>) => Task;
  updateTask: (id: string, patch: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  toggleDone: (id: string) => void;
  setStatus: (id: string, status: Task['status']) => void;
  updateSettings: (patch: Partial<Settings>) => void;
}

const FlowContext = createContext<FlowContextValue | null>(null);

export function FlowProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(() => {
    const loaded = loadState();
    if (loaded.tasks.length === 0) {
      loaded.tasks = seedDemoTasks();
      saveState(loaded);
    }
    return loaded;
  });

  useEffect(() => {
    saveState(state);
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
    updateSettings: (patch) =>
      setState((s) => ({ ...s, settings: { ...s.settings, ...patch } })),
  }), [state]);

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useFlow(): FlowContextValue {
  const ctx = useContext(FlowContext);
  if (!ctx) throw new Error('useFlow must be used within FlowProvider');
  return ctx;
}
