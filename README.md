# FlowDay Student Planner 🚀

FlowDay is an intelligent student planning application designed to help students organize tasks, manage schedules, and improve learning efficiency.

## 🌟 Overview

FlowDay provides students with a simple and efficient way to plan their daily study activities, track progress, and build better learning habits.

## ✨ Features

- ✅ Daily task management
- 📅 Study schedule planning (Phase 2 smart scheduler with previewable / undoable proposals)
- 📊 Progress tracking
- 🗂 Kanban board management
- ⏱ Timeline planning
- 🤖 Rule-based study organization (智能拆解 / 智能规划 / 智能总结 — runs fully offline, no API key)
- 🎯 Productivity improvement suggestions
- 🔔 Browser notifications for study-block reminders
- ☁️ Optional Supabase cloud sync (local-first; works without Supabase)

## 🖥 Live Demo

Visit the online version:

https://flowday-student-planner.vercel.app

## 📸 Preview

<img width="3813" height="1969" alt="image" src="https://github.com/user-attachments/assets/bda0f42f-234e-4ac0-bbf1-cac0d0e588ad" />


## 🛠 Technology Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Supabase (optional — auth + cloud sync)
- Vercel (deployment)

## 📁 Project Structure

```text
flowday-student-planner/
├── src/
│   ├── components/      # React components (TopBar, Sidebar, MigrationModal, ...)
│   ├── pages/           # Route pages (Dashboard, TasksPage, AIPage, ...)
│   ├── lib/             # Pure logic + adapters (storage, repository, scheduler, ...)
│   ├── store.tsx        # React Context store (sliced contexts)
│   ├── App.tsx          # Hash-based router + provider tree
│   └── main.tsx         # Entry point
├── db/migrations/       # Supabase SQL migrations (RLS + RPC stubs)
├── index.html
├── package.json
├── vite.config.ts
├── vitest.config.ts
├── vercel.json
├── .env.example
└── README.md
```

## 🚀 Local Development

```bash
npm ci
npm run dev      # start Vite dev server
npm test         # run vitest
npm run build    # tsc -b && vite build -> dist/
npm run preview  # preview the production build locally
```

## ☁️ Vercel Deployment

The project ships with a [`vercel.json`](./vercel.json) that locks in:

| Setting           | Value            |
| ----------------- | ---------------- |
| Framework Preset  | Vite             |
| Build Command     | `npm run build`  |
| Output Directory  | `dist`           |
| Install Command   | `npm ci`         |

You can also configure these in the Vercel dashboard — the settings are identical.

### Deploy steps

1. Push the repository to GitHub.
2. In Vercel, **New Project → Import** the repository.
3. (Optional) Add the environment variables listed below.
4. **Deploy**. Vercel runs `npm ci` then `npm run build` and serves `dist/`.

The app uses a hash-based router (`#/dashboard`, `#/tasks`, …) so no
server-side rewrites are required for client routes. The `vercel.json`
rewrite to `index.html` is included only as a safety net for direct hits.

### Required Vercel environment variables

Both are **public** values safe for the browser — they ship in the bundle.
Get them from your Supabase project: *Project Settings → API*.

| Variable                    | Purpose                                  |
| --------------------------- | ---------------------------------------- |
| `VITE_SUPABASE_URL`         | Public Supabase project URL              |
| `VITE_SUPABASE_ANON_KEY`    | Public anon key (RLS must be enabled)    |

If these are not set, the app boots in **local-only mode** — it does NOT
white-screen. Cloud login / sync are simply unavailable.

> ⚠️ **Never** put the Supabase `service_role` key in a `VITE_*` variable.
> It bypasses RLS and would be visible to every browser. If you later add a
> real LLM, its API key must also live server-side (Vercel Function or
> Supabase Edge Function), not in `VITE_*`.

## 🗄 Supabase Setup

1. Create a new Supabase project at https://supabase.com.
2. Open the SQL editor and run
   [`db/migrations/20260814_phase3_create_tables.sql`](./db/migrations/20260814_phase3_create_tables.sql).
   This creates the `courses`, `tasks`, `subtasks`, `schedule_blocks`,
   `availability_rules`, `user_settings`, and `profiles` tables, plus:
   - RLS policies restricting every row to `auth.uid() = user_id`.
   - `updated_at` triggers.
   - `enforce_user_id_column()` trigger that rejects forged `user_id`.
   - Minimal RPC stubs (`planner_server_time`, `planner_apply_mutation`,
     `planner_get_snapshot`) — production should harden these.
3. In **Authentication → URL Configuration**, set:
   - **Site URL**: `https://your-project.vercel.app`
   - **Redirect URLs**: `https://your-project.vercel.app/**`
4. In **Authentication → Providers**, enable **Email**.
5. Copy the project URL and anon key into Vercel env vars (see above).

### RLS

Every user-data table has RLS enabled with `USING (auth.uid() = user_id)`
and `WITH CHECK (auth.uid() = user_id)`. Clients use the anon key only —
no service role key ever reaches the browser.

## 🔁 Sync Lifecycle

- **Unauthenticated**: data lives in `localStorage` only.
- **Login**: if local data exists and cloud is empty, a migration modal
  offers *merge local → cloud* or *replace cloud with local*. If both
  sides are empty, sync starts silently. The modal does **not** reappear
  on every refresh.
- **Authenticated**: writes go through `SyncRepository`, which persists
  locally first, then debounces + coalesces a snapshot mutation into a
  pending queue flushed via the `planner_apply_mutation` RPC.
- **Offline**: queue is retained in `localStorage`; status flips to
  `offline`; flushes resume on the next save / reconnect.
- **Logout**: the pending queue is dropped and realtime subscriptions
  are torn down so a different account never inherits the previous
  user's writes. The app returns to local-only mode.

## 🧪 Testing

```bash
npm test
```

Covers: storage migration / persistence gate, domain validation, conflict
detection, the Phase 2 proposal scheduler (68 tests), transactions,
reminder timer lifecycle, notification graceful degradation, and the sync
queue (coalescing + logout cleanup).

## 📝 License

MIT
