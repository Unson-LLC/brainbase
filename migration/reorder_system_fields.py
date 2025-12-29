#!/usr/bin/env python3
"""
システムフィールド（Created At, Updated At）を最後に移動
"""

import os
from dotenv import load_dotenv
from nocodb_client import NocoDBClient

load_dotenv('/Users/ksato/workspace/.env')

client = NocoDBClient(os.getenv('NOCODB_URL'), os.getenv('NOCODB_TOKEN'))

project_id = 'pqj22ze3jh0mkms'
table_ids = {
    'マイルストーン': 'mm6b4dlz6w2wnnj',
    'スプリント': 'mp4slbwqfxutpii',
    'タスク': 'mxsy93mwfdvhug1'
}

for table_name, table_id in table_ids.items():
    print(f"\n=== {table_name} ===")

    # テーブル詳細取得
    table_detail = client._request('GET', f'/db/meta/tables/{table_id}').json()
    columns = table_detail.get('columns', [])

    # システムフィールドと通常フィールドを分離
    system_fields = []
    normal_fields = []
    id_field = None

    for col in columns:
        # IDは最初に固定
        if col.get('pk'):
            id_field = col
        # システムフィールド（system=Trueのフィールド）を最後に
        elif col.get('system'):
            system_fields.append(col)
        else:
            normal_fields.append(col)

    # 順序を再設定（ID → 通常フィールド → システムフィールド）
    reordered_columns = []
    if id_field:
        reordered_columns.append(id_field)
    reordered_columns.extend(normal_fields)
    reordered_columns.extend(system_fields)

    # 各カラムのorderを更新
    for idx, col in enumerate(reordered_columns, start=1):
        col_id = col['id']
        col_name = col.get('title') or col.get('column_name') or 'Unknown'
        is_system = col.get('system', False)
        marker = "🔴" if is_system else "  "
        try:
            client._request(
                'PATCH',
                f'/db/meta/columns/{col_id}',
                json={'order': idx}
            )
            print(f"{marker}✓ {col_name}: order={idx}")
        except Exception as e:
            print(f"{marker}✗ {col_name}: {e}")

print("\n✓ フィールド順序変更完了")
