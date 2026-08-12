import { lazy, Suspense, useState, useEffect, useCallback } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { TaskModal } from '@/components/TaskModal';
import { FlowProvider, useActions } from '@/store';
import type { PageId } from '@/nav';
import type { Task } from '@/types';
import { createSubtask } from '@/lib/storage';

// Lazy-loaded pages
const Dashboard = lazy(() => import('@/pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const TasksPage = lazy(() => import('@/pages/TasksPage').then((m) => ({ default: m.TasksPage })));
const KanbanPage = lazy(() => import('@/pages/KanbanPage').then((m) => ({ default: m.KanbanPage })));
const TimelinePage = lazy(() => import('@/pages/TimelinePage').then((m) => ({ default: m.TimelinePage })));
const CalendarPage = lazy(() => import('@/pages/CalendarPage').then((m) => ({ default: m.CalendarPage })));
const AvailabilityPage = lazy(() => import('@/pages/AvailabilityPage').then((m) => ({ default: m.AvailabilityPage })));
const AIPage = lazy(() => import('@/pages/AIPage').then((m) => ({ default: m.AIPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));

// Simple hash-based router
function parseHash(): { page: PageId; params: Record<string, string> } {
  const hash = window.location.hash.replace(/^#\//, '') || 'dashboard';
  const parts = hash.split('?');
  const page = parts[0] as PageId;
  const params: Record<string, string> = {};
  if (parts[1]) {
    for (const pair of parts[1].split('&')) {
      const [k, v] = pair.split('=');
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
    }
  }
  return { page, params };
}

// Route config: maps pageId → URL path
const PAGE_ROUTES: Record<PageId, string> = {
  dashboard: 'dashboard',
  tasks: 'tasks',
  kanban: 'kanban',
  timeline: 'timeline',
  calendar: 'calendar',
  availability: 'availability',
  ai: 'ai',
  settings: 'settings',
};

function navigateTo(page: PageId, params?: Record<string, string>) {
  const base = PAGE_ROUTES[page] || 'dashboard';
  let hash = base;
  if (params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    if (qs) hash += `?${qs}`;
  }
  window.location.hash = `/${hash}`;
}

function Router() {
  const [route, setRoute] = useState(() => parseHash());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modalTask, setModalTask] = useState<Task | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [defaultDate, setDefaultDate] = useState<string | undefined>(undefined);
  const { updateTask } = useActions();

  // Listen for hash changes
  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((p: PageId) => {
    navigateTo(p);
    setSidebarOpen(false);
  }, []);

  const openAdd = (date?: string) => {
    setModalTask(null);
    setDefaultDate(date);
    setModalOpen(true);
  };
  const openEdit = (t: Task) => {
    setModalTask(t);
    setDefaultDate(undefined);
    setModalOpen(true);
  };

  const applySubtasks = (task: Task, subs: string[]) => {
    const newSubs = subs.map((s) => createSubtask(s));
    updateTask(task.id, { subtasks: [...task.subtasks, ...newSubs] });
  };

  const page = route.page;
  const pageParams = route.params;

  const renderPage = () => {
    switch (page) {
      case 'dashboard':
        return <Dashboard onOpenTask={openEdit} onAddTask={() => openAdd()} onNavigate={(p) => navigateTo(p as PageId)} />;
      case 'tasks':
        return <TasksPage onOpenTask={openEdit} />;
      case 'kanban':
        return <KanbanPage onOpenTask={openEdit} />;
      case 'timeline':
        return <TimelinePage onOpenTask={openEdit} onAddTaskOnDate={(d) => openAdd(d)} />;
      case 'calendar':
        return <CalendarPage
          onOpenTask={openEdit}
          onAddTaskOnDate={(d) => openAdd(d)}
          initialView={pageParams.view}
          initialDate={pageParams.date}
        />;
      case 'availability':
        return <AvailabilityPage />;
      case 'ai':
        return <AIPage onApplySubtasks={applySubtasks} />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <Dashboard onOpenTask={openEdit} onAddTask={() => openAdd()} onNavigate={(p) => navigateTo(p as PageId)} />;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gradient-to-br from-brand-50 via-white to-brand-100/40">
      <Sidebar page={page} onNavigate={navigate} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar page={page} onMenuClick={() => setSidebarOpen(true)} onAddTask={() => openAdd()} />
        <main className="flex-1 overflow-y-auto px-4 py-5 md:px-8">
          <Suspense fallback={<div className="flex items-center justify-center py-20 text-sm text-ink-400">加载中...</div>}>
            {renderPage()}
          </Suspense>
        </main>
      </div>
      {modalOpen && <TaskModal task={modalTask} defaultDate={defaultDate} onClose={() => setModalOpen(false)} />}
    </div>
  );
}

export default function App() {
  return (
    <FlowProvider>
      <Router />
    </FlowProvider>
  );
}
