-- Phase 3: Supabase canonical v3 tables + RLS + triggers
-- Run on a PostgreSQL database (Supabase) as a migration

-- ===== helper: updated_at trigger =====
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = COALESCE(now() at time zone 'utc', CURRENT_TIMESTAMP);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===== profiles =====
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  timezone text,
  locale text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ===== courses =====
CREATE TABLE IF NOT EXISTS courses (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_courses_user_id ON courses(user_id);

-- ===== tasks =====
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id uuid REFERENCES courses(id),
  title text NOT NULL,
  description text,
  due_date date,
  priority int,
  status text,
  estimated_minutes int,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_course_id ON tasks(course_id);

-- ===== subtasks =====
CREATE TABLE IF NOT EXISTS subtasks (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title text NOT NULL,
  done boolean DEFAULT false,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_subtasks_task_id ON subtasks(task_id);

-- ===== schedule_blocks =====
CREATE TABLE IF NOT EXISTS schedule_blocks (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id),
  date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  planned_minutes int NOT NULL,
  source text,
  locked boolean DEFAULT false,
  status text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_scheduleblocks_user_date ON schedule_blocks(user_id, date);

-- ===== availability_rules =====n
CREATE TABLE IF NOT EXISTS availability_rules (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  weekday int NOT NULL,
  start_minute int NOT NULL,
  end_minute int NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_avail_user ON availability_rules(user_id);

-- ===== user_settings =====
CREATE TABLE IF NOT EXISTS user_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  timezone text,
  week_starts_on int,
  daily_study_limit_minutes int,
  min_block_minutes int,
  max_block_minutes int,
  break_minutes int,
  preferences jsonb,
  updated_at timestamptz DEFAULT now()
);

-- ===== Triggers to maintain updated_at =====
CREATE TRIGGER trg_set_updated_at_profiles BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_set_updated_at_courses BEFORE UPDATE ON courses FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_set_updated_at_tasks BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_set_updated_at_subtasks BEFORE UPDATE ON subtasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_set_updated_at_schedule_blocks BEFORE UPDATE ON schedule_blocks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_set_updated_at_availability_rules BEFORE UPDATE ON availability_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_set_updated_at_user_settings BEFORE UPDATE ON user_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===== RLS policies (minimal, auth.uid() = user_id) =====
-- Enable RLS on all user data tables
ALTER TABLE IF EXISTS courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS subtasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS schedule_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS availability_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_settings ENABLE ROW LEVEL SECURITY;

-- profiles: allow users to select/insert/update their own profile
CREATE POLICY profiles_select_for_user ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY profiles_insert_for_user ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY profiles_update_for_user ON profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- courses
CREATE POLICY courses_crud_for_user ON courses FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- tasks
CREATE POLICY tasks_crud_for_user ON tasks FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- subtasks
CREATE POLICY subtasks_crud_for_user ON subtasks FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- schedule_blocks
CREATE POLICY schedule_blocks_crud_for_user ON schedule_blocks FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- availability_rules
CREATE POLICY availability_rules_crud_for_user ON availability_rules FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- user_settings (one row per user)
CREATE POLICY user_settings_for_user ON user_settings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ===== Safety checks: prevent client-side insertion of forged user_id via trigger =====
-- Note: RLS WITH CHECK should prevent this, but ensure created rows have correct user_id
CREATE OR REPLACE FUNCTION enforce_user_id_column() RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    IF (NEW.user_id IS NOT NULL AND NEW.user_id <> auth.uid()) THEN
      RAISE EXCEPTION 'user_id must equal auth.uid()';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach to tables that have user_id
CREATE TRIGGER trg_enforce_user_id_courses BEFORE INSERT OR UPDATE ON courses FOR EACH ROW EXECUTE FUNCTION enforce_user_id_column();
CREATE TRIGGER trg_enforce_user_id_tasks BEFORE INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION enforce_user_id_column();
CREATE TRIGGER trg_enforce_user_id_subtasks BEFORE INSERT OR UPDATE ON subtasks FOR EACH ROW EXECUTE FUNCTION enforce_user_id_column();
CREATE TRIGGER trg_enforce_user_id_schedule_blocks BEFORE INSERT OR UPDATE ON schedule_blocks FOR EACH ROW EXECUTE FUNCTION enforce_user_id_column();
CREATE TRIGGER trg_enforce_user_id_availability_rules BEFORE INSERT OR UPDATE ON availability_rules FOR EACH ROW EXECUTE FUNCTION enforce_user_id_column();

-- ===== Notes =====
-- 1) Clients should use anon/public key and must NOT include a user_id override. RLS prevents cross-user access.
-- 2) db-side functions (RPC) like planner_apply_mutation, planner_get_snapshot, planner_replace_snapshot,
--    planner_server_time are useful server-side helpers. Below are minimal stubs useful for development;
--    they should be hardened for production.
-- 3) Tombstones (deleted_at) are used for soft-delete and must be respected by client sync logic.

-- Minimal RPC: return server time
CREATE OR REPLACE FUNCTION planner_server_time()
RETURNS TABLE(now timestamptz) AS $$
BEGIN
  RETURN QUERY SELECT now()::timestamptz;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Minimal RPC: echo mutation (development helper). REAL implementation should apply mutations within a transaction
CREATE OR REPLACE FUNCTION planner_apply_mutation(mutation jsonb)
RETURNS jsonb AS $$
DECLARE
  out jsonb;
BEGIN
  out = json_build_object('ok', true, 'received', mutation, 'server_time', now())::jsonb;
  RETURN out;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- planner_get_snapshot stub (development)
CREATE OR REPLACE FUNCTION planner_get_snapshot()
RETURNS jsonb AS $$
DECLARE
  snapshot jsonb;
BEGIN
  -- For development, return null; production should assemble full appstate JSON
  snapshot = json_build_object('ok', false, 'message', 'planner_get_snapshot not implemented')::jsonb;
  RETURN snapshot;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
