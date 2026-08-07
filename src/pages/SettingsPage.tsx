import { Bell, BellOff, Clock, Check } from 'lucide-react';
import { useFlow } from '@/store';
import { notificationsSupported, requestPermission } from '@/lib/notify';
import { minutesToHHMM } from '@/lib/date';
import { useState } from 'react';

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
