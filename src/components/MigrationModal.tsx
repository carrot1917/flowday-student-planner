import React from 'react';
import { useAuth } from '@/lib/auth';

export function MigrationModal() {
  const auth = useAuth();
  if (!auth) return null;
  const { migration } = auth;
  if (!migration) return null;

  const localCount = (() => {
    try { return (migration.local?.tasks?.length || 0) + (migration.local?.courses?.length || 0); } catch { return 0; }
  })();
  const remoteCount = (() => {
    try { return (migration.remote?.tasks?.length || 0) + (migration.remote?.courses?.length || 0); } catch { return 0; }
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-w-xl rounded-xl bg-white p-6">
        <h3 className="text-lg font-bold">检测到本地数据</h3>
        <p className="mt-2 text-sm text-ink-600">我们在你的浏览器中检测到本地 canonical v3 数据。请选择如何处理这些数据：</p>
        <div className="mt-4 space-y-3">
          <div className="rounded border p-3">
            <p className="text-sm font-medium">本地数据</p>
            <p className="text-xs text-ink-500">任务/课程总数（预览）: {localCount}</p>
          </div>
          <div className="rounded border p-3">
            <p className="text-sm font-medium">云端数据</p>
            <p className="text-xs text-ink-500">任务/课程总数（预览）: {remoteCount}</p>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            className="rounded-md bg-brand-500 px-3 py-2 text-sm text-white"
            onClick={async () => {
              const res = await auth.performMigrationMergeLocalToCloud();
              if (!res.ok) alert('合并失败: ' + (res.message || '未知错误'));
            }}
          >合并本地到云端</button>
          <button
            className="rounded-md border px-3 py-2 text-sm"
            onClick={async () => {
              const ok = confirm('确定用本地数据替换云端吗？这将把云端数据标记为已删除/替换。请确认你已备份。');
              if (!ok) return;
              const res = await auth.performMigrationReplaceCloudWithLocal();
              if (!res.ok) alert('替换失败: ' + (res.message || '未知错误'));
            }}
          >用本地替换云端</button>
          <button
            className="rounded-md px-3 py-2 text-sm"
            onClick={() => auth.clearMigrationChoice()}
          >保留云端/稍后处理</button>
        </div>
        <p className="mt-3 text-xs text-ink-400">说明：迁移为幂等操作；若出现错误，本地数据不会被删除。若你不确定，请先导出备份。</p>
      </div>
    </div>
  );
}
