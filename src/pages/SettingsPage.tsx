import { Bell, BellOff, Clock, Check, GraduationCap, Pencil, Plus, Trash2, X, CircleAlert } from 'lucide-react';
import { useFlow } from '@/store';
import { notificationsSupported, requestPermission } from '@/lib/notify';
import { minutesToHHMM } from '@/lib/date';
import { suggestCourseColor } from '@/lib/domain';
import { COURSE_PALETTE, UNCATEGORIZED_LABEL } from '@/types';
import { useMemo, useState } from 'react';

export function SettingsPage() {
  const { settings, updateSettings } = useFlow();
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    notificationsSupported() ? Notification.permission : 'denied',
  );

  const enableNotifications = async () => {
    const perm = await requestPermission();
    setPermission(perm);
    if (perm === 'granted') {
      updateSettings({ notificationsEnabled: true });
      new Notification('FlowDay 提醒已开启', { body: '我们会在任务到期和每天学习时间提醒你。' });
    }
  };

  return (
    <div className="animate-fade-in mx-auto max-w-2xl space-y-5">
      {/* Hero status */}
      <div className={`rounded-[24px] border p-5 ${settings.notificationsEnabled && permission === 'granted' ? 'border-emerald-100 bg-emerald-50/70' : 'border-amber-100 bg-amber-50/70'}`}>
        <div className="flex items-center gap-3">
          {settings.notificationsEnabled && permission === 'granted' ? (
            <Bell className="h-6 w-6 text-emerald-500" />
          ) : (
            <BellOff className="h-6 w-6 text-amber-500" />
          )}
          <div className="flex-1">
            <p className="text-sm font-bold text-ink-900">
              {settings.notificationsEnabled && permission === 'granted' ? '提醒已开启' : '提醒未开启'}
            </p>
            <p className="text-xs text-ink-500">
              {notificationsSupported()
                ? permission === 'granted'
                  ? '浏览器通知权限已授予'
                  : '需要授权浏览器通知权限才能接收提醒'
                : '当前浏览器不支持通知功能'}
            </p>
          </div>
          {(!settings.notificationsEnabled || permission !== 'granted') && (
            <button
              onClick={enableNotifications}
              disabled={!notificationsSupported()}
              className="rounded-2xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-brand-300/40 transition hover:bg-brand-600 disabled:opacity-40"
            >
              开启提醒
            </button>
          )}
        </div>
      </div>

      <CourseManager />

      {/* Daily reminder */}
      <div className="rounded-[24px] border border-brand-100 bg-white/70 p-5">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-brand-500" />
          <p className="text-sm font-bold text-ink-900">每日学习提醒</p>
        </div>
        <p className="mt-1 text-xs text-ink-400">每天在指定时间提醒你查看今日学习任务</p>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm text-ink-600">开启每日提醒</span>
          <Toggle
            checked={settings.notificationsEnabled}
            onChange={(v) => updateSettings({ notificationsEnabled: v })}
          />
        </div>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm text-ink-600">提醒时间</span>
          <input
            type="time"
            value={minutesToHHMM(settings.reminderTime)}
            onChange={(e) => {
              const [h, m] = e.target.value.split(':').map(Number);
              updateSettings({ reminderTime: h * 60 + m });
            }}
            className="rounded-2xl border border-brand-100 bg-white/70 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
          />
        </div>
      </div>

      {/* Due reminder */}
      <div className="rounded-[24px] border border-brand-100 bg-white/70 p-5">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-brand-500" />
          <p className="text-sm font-bold text-ink-900">任务截止提醒</p>
        </div>
        <p className="mt-1 text-xs text-ink-400">任务到期当天提醒你完成</p>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm text-ink-600">开启截止提醒</span>
          <Toggle
            checked={settings.dueReminder}
            onChange={(v) => updateSettings({ dueReminder: v })}
          />
        </div>
      </div>

      {/* Test */}
      <div className="rounded-[24px] border border-brand-100 bg-white/70 p-5">
        <p className="text-sm font-bold text-ink-900">测试提醒</p>
        <p className="mt-1 text-xs text-ink-400">发送一条测试通知，确认提醒功能正常</p>
        <button
          onClick={() => {
            if (permission !== 'granted') return;
            new Notification('FlowDay 测试提醒', { body: '这是一条测试通知，提醒功能工作正常！' });
          }}
          disabled={permission !== 'granted'}
          className="mt-3 flex items-center gap-2 rounded-2xl bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-600 transition hover:bg-brand-100 disabled:opacity-40"
        >
          <Check className="h-4 w-4" /> 发送测试通知
        </button>
      </div>

      <p className="px-2 text-center text-xs text-ink-400">
        FlowDay · 数据保存在你的浏览器中，不会上传到任何服务器
      </p>
    </div>
  );
}

function CourseManager() {
  const { courses, tasks, addCourse, updateCourse, deleteCourse } = useFlow();

  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(() => suggestCourseColor(courses));
  const [addError, setAddError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const [confirmId, setConfirmId] = useState<string | null>(null);

  // How many tasks reference each course — used in the delete confirmation.
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) {
      if (t.courseId) m.set(t.courseId, (m.get(t.courseId) ?? 0) + 1);
    }
    return m;
  }, [tasks]);

  const submitNew = () => {
    const res = addCourse(newName, newColor);
    if (!res.ok) {
      setAddError(res.message);
      return;
    }
    setAddError(null);
    setNewName('');
    setNewColor(suggestCourseColor([...courses, res.course]));
  };

  const startEdit = (id: string, name: string) => {
    setEditingId(id);
    setEditName(name);
    setEditError(null);
    setConfirmId(null);
  };

  const commitEdit = (id: string) => {
    const res = updateCourse(id, { name: editName });
    if (!res.ok) {
      setEditError(res.message);
      return;
    }
    setEditingId(null);
    setEditError(null);
  };

  return (
    <div className="rounded-[24px] border border-brand-100 bg-white/70 p-5">
      <div className="flex items-center gap-2">
        <GraduationCap className="h-5 w-5 text-brand-500" />
        <p className="text-sm font-bold text-ink-900">课程管理</p>
      </div>
      <p className="mt-1 text-xs text-ink-400">
        课程用于归类任务。删除课程不会删除任务，它们会变成「{UNCATEGORIZED_LABEL}」。
      </p>

      {/* Existing courses */}
      <div className="mt-4 space-y-2">
        {courses.length === 0 ? (
          <p className="rounded-2xl bg-sand-50 px-4 py-6 text-center text-xs text-ink-400">
            还没有课程，先在下面添加一个吧
          </p>
        ) : (
          courses.map((c) => {
            const count = usage.get(c.id) ?? 0;
            const isEditing = editingId === c.id;
            const isConfirming = confirmId === c.id;
            return (
              <div key={c.id} className="rounded-2xl border border-brand-50 bg-white px-3.5 py-3">
                <div className="flex items-center gap-3">
                  <span
                    className="h-3.5 w-3.5 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: c.color }}
                  />
                  {isEditing ? (
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit(c.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="min-w-0 flex-1 rounded-lg border border-brand-200 bg-sand-50 px-2.5 py-1.5 text-sm outline-none focus:border-brand-400 focus:bg-white"
                    />
                  ) : (
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-900">{c.name}</p>
                      <p className="text-[11px] text-ink-400">{count} 个任务</p>
                    </div>
                  )}

                  {isEditing ? (
                    <div className="flex flex-shrink-0 gap-1">
                      <button
                        onClick={() => commitEdit(c.id)}
                        className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50"
                        aria-label="保存课程名称"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => { setEditingId(null); setEditError(null); }}
                        className="rounded-lg p-1.5 text-ink-400 hover:bg-brand-50"
                        aria-label="取消编辑"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-shrink-0 gap-1">
                      <button
                        onClick={() => startEdit(c.id, c.name)}
                        className="rounded-lg p-1.5 text-ink-400 hover:bg-brand-50 hover:text-brand-600"
                        aria-label="编辑课程"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => { setConfirmId(isConfirming ? null : c.id); setEditingId(null); }}
                        className="rounded-lg p-1.5 text-ink-400 hover:bg-rose-50 hover:text-rose-500"
                        aria-label="删除课程"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>

                {isEditing && editError && (
                  <p className="mt-2 flex items-center gap-1 text-[11px] text-rose-500">
                    <CircleAlert className="h-3 w-3" /> {editError}
                  </p>
                )}

                {/* Color picker */}
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {COURSE_PALETTE.map((hex) => (
                    <button
                      key={hex}
                      onClick={() => updateCourse(c.id, { color: hex })}
                      aria-label={`设置颜色 ${hex}`}
                      className={`h-5 w-5 rounded-full transition ${
                        c.color === hex ? 'ring-2 ring-offset-2 ring-ink-300' : 'hover:scale-110'
                      }`}
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </div>

                {/* Delete confirmation */}
                {isConfirming && (
                  <div className="mt-3 rounded-xl bg-rose-50 px-3.5 py-3">
                    <p className="text-xs leading-relaxed text-rose-700">
                      {count > 0
                        ? `有 ${count} 个任务正在使用「${c.name}」。删除课程不会删除这些任务，它们将变为${UNCATEGORIZED_LABEL}。`
                        : `确认删除课程「${c.name}」？`}
                    </p>
                    <div className="mt-2.5 flex justify-end gap-2">
                      <button
                        onClick={() => setConfirmId(null)}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-500 hover:bg-white"
                      >
                        取消
                      </button>
                      <button
                        onClick={() => { deleteCourse(c.id); setConfirmId(null); }}
                        className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-600"
                      >
                        确认删除
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Add new course */}
      <div className="mt-4 rounded-2xl bg-sand-50 p-3.5">
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => { setNewName(e.target.value); setAddError(null); }}
            onKeyDown={(e) => e.key === 'Enter' && submitNew()}
            placeholder="新课程名称，例如：高等数学"
            className="min-w-0 flex-1 rounded-xl border border-brand-100 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
          />
          <button
            onClick={submitNew}
            disabled={!newName.trim()}
            className="flex flex-shrink-0 items-center gap-1 rounded-xl bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" /> 添加
          </button>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-medium text-ink-400">颜色</span>
          {COURSE_PALETTE.map((hex) => (
            <button
              key={hex}
              onClick={() => setNewColor(hex)}
              aria-label={`选择颜色 ${hex}`}
              className={`h-5 w-5 rounded-full transition ${
                newColor === hex ? 'ring-2 ring-offset-2 ring-ink-300' : 'hover:scale-110'
              }`}
              style={{ backgroundColor: hex }}
            />
          ))}
        </div>
        {addError && (
          <p className="mt-2 flex items-center gap-1 text-[11px] text-rose-500">
            <CircleAlert className="h-3 w-3" /> {addError}
          </p>
        )}
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-brand-500' : 'bg-slate-200'}`}
      role="switch"
      aria-checked={checked}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`}
      />
    </button>
  );
}
