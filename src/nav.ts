import {
  LayoutDashboard,
  ListTodo,
  KanbanSquare,
  Timeline,
  Calendar,
  Clock,
  Sparkles,
  Bell,
  Droplets,
} from 'lucide-react';
import type { ComponentType } from 'react';

export type PageId =
  | 'dashboard'
  | 'tasks'
  | 'kanban'
  | 'timeline'
  | 'calendar'
  | 'availability'
  | 'ai'
  | 'settings';

export interface NavItem {
  id: PageId;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: '今日概览', icon: LayoutDashboard },
  { id: 'tasks', label: '任务管理', icon: ListTodo },
  { id: 'kanban', label: '看板', icon: KanbanSquare },
  { id: 'timeline', label: '时间线', icon: Timeline },
  { id: 'calendar', label: '日历', icon: Calendar },
  { id: 'availability', label: '可用时间', icon: Clock },
  { id: 'ai', label: 'AI 助手', icon: Sparkles },
  { id: 'settings', label: '设置', icon: Bell },
];
