import { useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { TaskModal } from '@/components/TaskModal';
import { Dashboard } from '@/pages/Dashboard';
import { TasksPage } from '@/pages/TasksPage';
import { KanbanPage } from '@/pages/KanbanPage';
import { TimelinePage } from '@/pages/TimelinePage';
import { CalendarPage } from '@/pages/CalendarPage';
import { AvailabilityPage } from '@/pages/AvailabilityPage';
import { AIPage } from '@/pages/AIPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { FlowProvider, useFlow } from '@/store';
import type { PageId } from '@/nav';
import type { Task } from '@/types';
import { createSubtask } from '@/lib/storage';

function Shell() {
  const [page, setPage] = useState<PageId>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modalTask, setModalTask] = useState<Task | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [defaultDate, setDefaultDate] = useState<string | undefined>(undefined);
  const { updateTask } = useFlow();

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

  return (
    <div className="flex h-screen overflow-hidden bg-gradient-to-br from-brand-50 via-white to-brand-100/40">
      <Sidebar page={page} onNavigate={(p) => { setPage(p); setSidebarOpen(false); }} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar page={page} onMenuClick={() => setSidebarOpen(true)} onAddTask={() => openAdd()} />
        <main className="flex-1 overflow-y-auto px-4 py-5 md:px-8">
          {page === 'dashboard' && <Dashboard onOpenTask={openEdit} onAddTask={() => openAdd()} onNavigate={(p) => setPage(p as PageId)} />}
          {page === 'tasks' && <TasksPage onOpenTask={openEdit} />}
          {page === 'kanban' && <KanbanPage onOpenTask={openEdit} />}
          {page === 'timeline' && <TimelinePage onOpenTask={openEdit} onAddTaskOnDate={(d) => openAdd(d)} />}
          {page === 'calendar' && <CalendarPage onOpenTask={openEdit} onAddTaskOnDate={(d) => openAdd(d)} />}
          {page === 'availability' && <AvailabilityPage />}
          {page === 'ai' && <AIPage onApplySubtasks={applySubtasks} />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>
      {modalOpen && <TaskModal task={modalTask} defaultDate={defaultDate} onClose={() => setModalOpen(false)} />}
    </div>
  );
}

export default function App() {
  return (
    <FlowProvider>
      <Shell />
    </FlowProvider>
  );
}
