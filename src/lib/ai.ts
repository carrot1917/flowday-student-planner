import type { Task } from '@/types';
import { createSubtask } from './storage';
import { fromISO, diffDays, todayISO } from './date';

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
export interface PlanSlot {
  date: string;
  time: string;
  taskTitle: string;
  priority: string;
}

export function aiPlan(tasks: Task[], days = 7): PlanSlot[] {
  const today = new Date();
  const pending = tasks
    .filter((t) => t.status !== 'done')
    .sort((a, b) => {
      const d = fromISO(a.dueDate).getTime() - fromISO(b.dueDate).getTime();
      if (d !== 0) return d;
      const order = { high: 0, medium: 1, low: 2 } as const;
      return order[a.priority] - order[b.priority];
    });

  const slots: PlanSlot[] = [];
  const dailySlots = ['08:00', '10:00', '14:00', '16:00', '19:30'];
  let slotIdx = 0;
  let dayOffset = 0;

  for (const t of pending) {
    const due = fromISO(t.dueDate);
    const slack = diffDays(due, today);
    const targetDay = Math.max(0, Math.min(days - 1, slack - 1 >= 0 ? Math.floor(slotIdx / dailySlots.length) : dayOffset));
    const date = new Date(today);
    date.setDate(date.getDate() + targetDay);
    const time = dailySlots[slotIdx % dailySlots.length];
    slots.push({
      date: date.toISOString().slice(0, 10),
      time,
      taskTitle: t.title,
      priority: t.priority,
    });
    slotIdx++;
    dayOffset = Math.floor(slotIdx / dailySlots.length);
  }
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
