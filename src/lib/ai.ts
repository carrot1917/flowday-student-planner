import type { Task } from '@/types';
import { createSubtask } from './storage';
import { fromISO, diffDays, todayISO, safeFromISO, toISO, addDays } from './date';

// Rule-based "AI" helpers. They run entirely in the browser so the app
// works offline with no API key. The shapes are designed to be swapped
// for a real LLM call later without changing the UI.

interface DecomposeRule {
  match: RegExp;
  steps: string[];
}

const DECOMPOSE_RULES: DecomposeRule[] = [
  { match: /考试|测验|test|exam/i, steps: ['复习核心公式与概念', '完成课后练习题', '整理错题本', '进行一次模拟测试'] },
  { match: /作文|写作|essay|write/i, steps: ['确定主题与大纲', '完成初稿', '润色修改', '检查语法与格式'] },
  { match: /阅读|读书|read/i, steps: ['浏览目录与序言', '按章节阅读并做笔记', '摘录金句与要点', '撰写读后总结'] },
  { match: /编程|代码|作业|program|code/i, steps: ['理解题目需求', '设计实现思路', '编写核心代码', '测试并调试'] },
  { match: /背单词|单词|vocab/i, steps: ['预览新单词列表', '分组记忆 (每组 10 个)', '听写自测', '复习昨日单词'] },
  { match: /复习|review/i, steps: ['回顾课本要点', '完成配套练习', '整理错题与难点', '总结知识脉络'] },
];

const GENERIC_STEPS = ['明确目标与范围', '拆分关键步骤', '执行核心部分', '检查与复盘'];

export function aiDecompose(title: string): string[] {
  for (const rule of DECOMPOSE_RULES) {
    if (rule.match.test(title)) return rule.steps;
  }
  return GENERIC_STEPS;
}

export function aiDecomposeSubtasks(title: string) {
  return aiDecompose(title).map(createSubtask);
}

// Generate a study plan for the next N days based on workload.
//
// `from` is injected by the caller (the UI layer supplies the current date) so
// this function is pure and fully testable with a fixed `from` — it never reads
// the system clock. All date math uses local-time helpers (toISO / addDays) so
// there is no UTC off-by-one.
export interface PlanSlot {
  date: string;
  time: string;
  taskTitle: string;
  priority: string;
}

type TaskWithDueDate = Task & { dueDate: string };

function hasValidDueDate(task: Task): task is TaskWithDueDate {
  return typeof task.dueDate === 'string' && safeFromISO(task.dueDate) !== null;
}

export function aiPlan(tasks: Task[], from: string, days = 7): PlanSlot[] {
  const base = safeFromISO(from);
  if (!base) return [];

  // Only plan tasks that are pending AND have a parseable deadline.
  const pending = tasks
    .filter((t): t is TaskWithDueDate => t.status !== 'done' && hasValidDueDate(t))
    .sort((a, b) => {
      const d = fromISO(a.dueDate).getTime() - fromISO(b.dueDate).getTime();
      if (d !== 0) return d;
      const order = { high: 0, medium: 1, low: 2 } as const;
      return order[a.priority] - order[b.priority];
    });

  const dailySlots = ['08:00', '10:00', '14:00', '16:00', '19:30'];
  const maxPerDay = dailySlots.length;
  const dayCount = new Array(days).fill(0);
  const slots: PlanSlot[] = [];

  for (const t of pending) {
    const due = fromISO(t.dueDate);
    // Days from `from` until the deadline (clamped to >= 0 for overdue tasks).
    const dueOffset = Math.max(0, diffDays(due, base));
    // The latest day we can place this task on: within the horizon AND on or
    // before the deadline. If the deadline is beyond the horizon, the last
    // horizon day is the cap.
    const lastDay = Math.min(dueOffset, days - 1);

    // Greedy earliest-fit: walk from day 0 to lastDay, place on the first day
    // that still has an open slot. This respects deadlines (urgent tasks get
    // early slots) while spreading work across days.
    for (let d = 0; d <= lastDay; d++) {
      if (dayCount[d] < maxPerDay) {
        slots.push({
          date: toISO(addDays(base, d)),
          time: dailySlots[dayCount[d]],
          taskTitle: t.title,
          priority: t.priority,
        });
        dayCount[d]++;
        break;
      }
    }
    // If every day up to the deadline is full, the task is silently skipped —
    // the user can see in the plan that not everything fit.
  }

  // Sort chronologically for display.
  slots.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.time.localeCompare(b.time);
  });

  return slots;
}

export interface DailySummary {
  text: string;
  completed: number;
  pending: number;
  efficiency: 'great' | 'good' | 'ok' | 'low';
}

export function aiSummary(tasks: Task[]): DailySummary {
  const today = todayISO();
  const todayTasks = tasks.filter((t) => t.dueDate === today);
  const completed = todayTasks.filter((t) => t.status === 'done').length;
  const pending = todayTasks.length - completed;
  const total = todayTasks.length;
  const rate = total === 0 ? 0 : completed / total;

  let efficiency: DailySummary['efficiency'] = 'ok';
  if (rate >= 0.8) efficiency = 'great';
  else if (rate >= 0.5) efficiency = 'good';
  else if (rate > 0) efficiency = 'ok';
  else efficiency = 'low';

  const tone = {
    great: '学习效率出色',
    good: '学习效率良好',
    ok: '还有提升空间',
    low: '今天还没开始',
  }[efficiency];

  const next = tasks.find((t) => t.dueDate === today && t.status !== 'done' && t.priority === 'high');
  const suggestion = next
    ? `建议接下来优先完成「${next.title}」。`
    : pending > 0
      ? `还有 ${pending} 项任务待完成，保持节奏。`
      : '今日任务已全部完成，可以预习明天内容。';

  const text = `今天共安排 ${total} 项任务，已完成 ${completed} 项，${tone}。${suggestion}`;
  return { text, completed, pending, efficiency };
}
