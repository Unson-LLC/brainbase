#!/usr/bin/env python3
"""
NocoDBカラムメタデータ確認
SingleSelectの選択肢設定形式を調査
"""

import os
from dotenv import load_dotenv
from nocodb_client import NocoDBClient

load_dotenv('/Users/ksato/workspace/.env')

client = NocoDBClient(os.getenv('NOCODB_URL'), os.getenv('NOCODB_TOKEN'))

project_id = 'p0ou2p3r9guq3zf'

# テーブル一覧を取得
tables = client.list_tables(project_id)

print("=== BAAOプロジェクトのテーブルとカラム ===\n")

for table in tables:
    table_id = table['id']
    table_name = table['title']

    print(f"テーブル: {table_name} (ID: {table_id})")

    # テーブル詳細からカラム情報を取得
    table_detail = client._request('GET', f'/db/meta/tables/{table_id}').json()
    columns = table_detail.get('columns', [])

    for col in columns:
        col_name = col.get('title', col.get('column_name'))
        col_type = col.get('uidt')

        if col_type in ['SingleSelect', 'MultiSelect']:
            print(f"  フィールド: {col_name}")
            print(f"    タイプ: {col_type}")
            print(f"    dtxp: {col.get('dtxp')}")
            print(f"    dtxs: {col.get('dtxs')}")

            # colOptionsも確認
            if 'colOptions' in col:
                print(f"    colOptions: {col['colOptions']}")

            print()

    print()
