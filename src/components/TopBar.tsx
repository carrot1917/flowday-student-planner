import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { PageId } from '@/nav';
import { NAV_ITEMS } from '@/nav';
import { useAuth } from '@/lib/auth';

interface TopBarProps {
  page: PageId;
  onMenuClick: () => void;
  onAddTask: () => void;
}

function AuthButtons() {
  try {
    const auth = useAuth();
    if (!auth) return null;
    const { user, signIn, signOut, loading } = auth;
    if (user) {
      return (
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-600">{user?.email}</span>
          <button
            onClick={() => signOut()}
            className="rounded-md border px-2 py-1 text-sm hover:bg-brand-50"
            disabled={loading}
          >登出</button>
        </div>
      );
    }
    return (
      <div>
        <button
          onClick={async () => {
            const email = window.prompt('邮箱');
            if (!email) return;
            const password = window.prompt('密码');
            if (!password) return;
            try {
              await signIn(email, password);
            } catch (e) {
              window.alert('登录失败');
            }
          }}
          className="rounded-md border px-2 py-1 text-sm hover:bg-brand-50"
          disabled={loading}
        >登录</button>
      </div>
    );
  } catch {
    return null;
  }
}

export function TopBar({ page, onMenuClick, onAddTask }: TopBarProps) {
  const item = NAV_ITEMS.find((n) => n.id === page);
  const [now] = useState(() => new Date());
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-brand-100/60 bg-white/60 px-4 py-3 backdrop-blur-xl md:px-8">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="rounded-lg p-2 text-ink-500 hover:bg-brand-50 md:hidden"
          aria-label="菜单"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
            <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <div>
          <h1 className="text-lg font-bold text-ink-900 md:text-xl">{item?.label}</h1>
          <p className="hidden text-xs text-ink-400 sm:block">{dateStr}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={onAddTask}
          className="flex items-center gap-1.5 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-400 px-3.5 py-2 text-sm font-semibold text-white shadow-lg shadow-brand-300/40 transition hover:shadow-xl active:scale-95"
        >
          <Plus className="h-4 w-4" /> <span className="hidden sm:inline">添加任务</span><span className="sm:hidden">添加</span>
        </button>
        <AuthButtons />
      </div>
    </header>
  );
}
