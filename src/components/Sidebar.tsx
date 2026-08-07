import { Droplets, X } from 'lucide-react';
import { NAV_ITEMS, type PageId } from '@/nav';

interface SidebarProps {
  page: PageId;
  onNavigate: (p: PageId) => void;
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ page, onNavigate, open, onClose }: SidebarProps) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-ink-900/20 backdrop-blur-sm md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed z-40 flex h-full w-64 flex-col border-r border-brand-100/60 bg-white/70 backdrop-blur-xl transition-transform duration-300 md:static md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-5 pt-6 pb-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-sm shadow-brand-300/50">
              <Droplets className="h-5 w-5" />
            </div>
            <div>
              <p className="text-lg font-bold tracking-tight text-ink-900">FlowDay</p>
              <p className="text-[11px] text-ink-400 -mt-0.5">让计划自然流动</p>
            </div>
          </div>
          <button
            className="rounded-lg p-1.5 text-ink-400 hover:bg-brand-50 md:hidden"
            onClick={onClose}
            aria-label="关闭菜单"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = page === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-all ${
                  active
                    ? 'bg-gradient-to-r from-brand-500 to-brand-400 text-white shadow-lg shadow-brand-300/40'
                    : 'text-ink-500 hover:bg-brand-50 hover:text-brand-600'
                }`}
              >
                <Icon className={`h-[18px] w-[18px] ${active ? 'text-white' : 'text-ink-400 group-hover:text-brand-500'}`} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="px-4 py-5">
          <div className="rounded-3xl bg-gradient-to-br from-brand-50 to-brand-100/60 p-4">
            <p className="text-xs font-semibold text-brand-700">学习小贴士</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-500">
              专注 25 分钟，休息 5 分钟。番茄工作法能让你的学习效率翻倍。
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}
