#!/usr/bin/env python3
"""
members.ymlからPostgreSQLにユーザー情報をインポート

Usage:
    export INFO_SSOT_DATABASE_URL="postgresql://user:password@localhost:5432/brainbase_ssot"
    python3 scripts/import_members_to_db.py
"""

import yaml
import psycopg2
import os
from pathlib import Path

def import_members():
    # members.yml読み込み
    codex_path = os.getenv('CODEX_PATH')
    if not codex_path:
        raise ValueError("CODEX_PATH environment variable must be set")

    members_path = Path(codex_path) / 'common' / 'meta' / 'slack' / 'members.yml'

    if not members_path.exists():
        raise FileNotFoundError(f"members.yml not found at {members_path}")

    with open(members_path, 'r', encoding='utf-8') as f:
        data = yaml.safe_load(f)

    # DB接続
    db_url = os.getenv('INFO_SSOT_DATABASE_URL') or os.getenv('TEST_PERMISSION_DB_URL')
    if not db_url:
        raise ValueError("INFO_SSOT_DATABASE_URL or TEST_PERMISSION_DB_URL must be set")

    conn = psycopg2.connect(db_url)
    cur = conn.cursor()

    # ========================================
    # 1. peopleテーブルにperson_idを登録（重複排除）
    # ========================================
    people_map = {}
    for member in data['members']:
        person_id = member['person_id']
        if person_id not in people_map:
            people_map[person_id] = {
                'name': member['brainbase_name'],
                'email': member.get('email')
            }

    for person_id, info in people_map.items():
        cur.execute("""
            INSERT INTO people (id, name)
            VALUES (%s, %s)
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name
        """, (person_id, info['name']))

    print(f"✅ Imported {len(people_map)} people")

    # ========================================
    # 2. usersテーブルにSlackアカウント登録
    # ========================================
    imported_count = 0

    for member in data['members']:
        # statusフィールドのチェック（デフォルト: active）
        status = member.get('status', 'active')
        note = member.get('note')

        # usersテーブルに挿入（UPSERT）
        cur.execute("""
            INSERT INTO users (slack_user_id, person_id, workspace_id, name, email, access_level, employment_type, role, status, note)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (slack_user_id) DO UPDATE SET
              person_id = EXCLUDED.person_id,
              workspace_id = EXCLUDED.workspace_id,
              name = EXCLUDED.name,
              email = EXCLUDED.email,
              access_level = EXCLUDED.access_level,
              employment_type = EXCLUDED.employment_type,
              role = EXCLUDED.role,
              status = EXCLUDED.status,
              note = EXCLUDED.note,
              updated_at = NOW()
        """, (
            member['slack_id'],           # slack_user_id (PK)
            member['person_id'],          # person_id (FK)
            member['workspace'],          # workspace_id (FK to organizations)
            member['brainbase_name'],     # name
            member.get('email'),          # email
            member['access_level'],       # access_level
            member['employment_type'],    # employment_type
            member.get('role'),           # role
            status,                       # status
            note                          # note
        ))

        # ========================================
        # 3. user_organizations インサート
        # ========================================
        # プロジェクト配列を抽出
        if 'projects' in member:
            projects = [p['name'] if isinstance(p, dict) else p for p in member['projects']]
        else:
            projects = []

        # 部門配列を抽出
        departments = member.get('departments', [])

        # user_organizationsに挿入（UPSERT）
        cur.execute("""
            INSERT INTO user_organizations (slack_user_id, organization_id, projects, departments)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (slack_user_id, organization_id) DO UPDATE SET
              projects = EXCLUDED.projects,
              departments = EXCLUDED.departments
        """, (
            member['slack_id'],           # slack_user_id (FK)
            member['workspace'],          # organization_id (FK)
            projects,
            departments
        ))

        imported_count += 1

    conn.commit()
    print(f"✅ Imported {imported_count} Slack accounts")

    # 統計情報を表示
    cur.execute("SELECT COUNT(*) FROM users WHERE status = 'active'")
    active_count = cur.fetchone()[0]
    print(f"   Active accounts: {active_count}")

    cur.execute("SELECT COUNT(*) FROM users WHERE status = 'inactive'")
    inactive_count = cur.fetchone()[0]
    print(f"   Inactive accounts: {inactive_count}")

    # 人物別アカウント数
    cur.execute("""
        SELECT person_id, COUNT(*) as account_count
        FROM users
        GROUP BY person_id
        HAVING COUNT(*) > 1
        ORDER BY account_count DESC
        LIMIT 10
    """)
    multi_accounts = cur.fetchall()
    if multi_accounts:
        print(f"\n   People with multiple Slack accounts:")
        for person_id, count in multi_accounts:
            print(f"     - {person_id}: {count} accounts")

    conn.close()

if __name__ == '__main__':
    import_members()
