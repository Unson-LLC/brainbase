-- Wiki Pages schema (Postgres)
-- Story: STR-WIKI-001
-- コンテンツもDBが正本（wiki/*.mdからDBに移行済み）、権限情報はDBが正本

CREATE TABLE IF NOT EXISTS wiki_pages (
  id text PRIMARY KEY,
  path text UNIQUE NOT NULL,
  title text NOT NULL,
  role_min text NOT NULL DEFAULT 'member',
  sensitivity text NOT NULL DEFAULT 'internal',
  project_id text REFERENCES projects(id),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wiki_pages_path ON wiki_pages(path);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_project_id ON wiki_pages(project_id);

-- 高感度ページはmemberロールでアクセス不可
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wiki_pages_sensitive_role') THEN
    ALTER TABLE wiki_pages
      ADD CONSTRAINT wiki_pages_sensitive_role
      CHECK (NOT (sensitivity IN ('finance', 'hr', 'contract') AND role_min = 'member'));
  END IF;
END $$;

-- Sync support columns
ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS size_bytes integer;
ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS content text;
