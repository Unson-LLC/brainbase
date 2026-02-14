-- Permission System Schema (Phase 1: Single-Tenant)
-- Story: E1-003.1: PostgreSQLベース権限管理
-- Updated: 2026-02-06 - 1人が複数Slackアカウントを持つケースに対応

-- ========================================
-- 1. organizations テーブル
-- ========================================
CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    workspace_id TEXT,
    projects TEXT[] DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMP DEFAULT NOW()
);

-- 初期データ投入
INSERT INTO organizations (id, name, workspace_id, projects) VALUES
  ('unson', 'UNSON', 'T089CNQ4D1A', ARRAY['zeims', 'dialogai', 'baao', 'brainbase', 'senrigan', 'backoffice', 'mywa']),
  ('salestailor', 'SalesTailor株式会社', 'T08FB9S7HUL', ARRAY['salestailor']),
  ('techknight', 'Tech Knight', 'T07AF0YNSDA', ARRAY['techknight'])
ON CONFLICT (id) DO NOTHING;

-- ========================================
-- 2. people テーブル（人物マスタ）
-- ========================================
CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,              -- person_id
    name TEXT NOT NULL,               -- 氏名
    email TEXT,                       -- メインメールアドレス
    created_at TIMESTAMP DEFAULT NOW()
);

-- ========================================
-- 3. users テーブル（Slackアカウント単位）
-- ========================================
CREATE TABLE IF NOT EXISTS users (
    slack_user_id TEXT PRIMARY KEY,   -- Slack User ID
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,               -- Slack表示名（brainbase_name）
    email TEXT,
    access_level INTEGER DEFAULT 1,   -- 1, 3, 4 (Level 2は存在しない)
    employment_type TEXT DEFAULT 'contractor', -- 'executive', 'manager', 'contractor', 'partner'
    role TEXT,                        -- 'CEO / CTO'
    status TEXT DEFAULT 'active',     -- 'active', 'inactive'
    note TEXT,                        -- 'メインアカウント', 'サブアカウント'等
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_users_person_id ON users(person_id);
CREATE INDEX IF NOT EXISTS idx_users_workspace_id ON users(workspace_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- ========================================
-- 4. user_organizations テーブル
-- ========================================
CREATE TABLE IF NOT EXISTS user_organizations (
    slack_user_id TEXT NOT NULL REFERENCES users(slack_user_id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    projects TEXT[] DEFAULT ARRAY[]::TEXT[],
    departments TEXT[] DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY(slack_user_id, organization_id)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_user_organizations_slack_user_id ON user_organizations(slack_user_id);
CREATE INDEX IF NOT EXISTS idx_user_organizations_organization_id ON user_organizations(organization_id);

-- ========================================
-- 5. permission_audit_log テーブル
-- ========================================
CREATE TABLE IF NOT EXISTS permission_audit_log (
    id SERIAL PRIMARY KEY,
    slack_user_id TEXT REFERENCES users(slack_user_id) ON DELETE SET NULL,
    changed_by TEXT,                  -- 変更者のslack_user_id
    field_name TEXT NOT NULL,         -- 'access_level', 'employment_type', 'status'
    old_value TEXT,
    new_value TEXT,
    changed_at TIMESTAMP DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_permission_audit_log_slack_user_id ON permission_audit_log(slack_user_id);
CREATE INDEX IF NOT EXISTS idx_permission_audit_log_changed_at ON permission_audit_log(changed_at);
