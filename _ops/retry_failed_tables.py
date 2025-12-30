#!/usr/bin/env python3
"""
422エラーが発生したテーブルのみ再移行
"""

import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from airtable_to_nocodb_direct import (
    migrate_table,
    AIRTABLE_TOKEN,
    AirtableApi
)

# 失敗したテーブルのリスト
FAILED_TABLES = [
    # DialogAI
    ('appLXuHKJGitc6CGd', 'ptykrgx40t36l9y', '要求'),
    ('appLXuHKJGitc6CGd', 'ptykrgx40t36l9y', '要件'),
    ('appLXuHKJGitc6CGd', 'ptykrgx40t36l9y', 'バグ'),
    ('appLXuHKJGitc6CGd', 'ptykrgx40t36l9y', 'アンケート'),

    # Aitle
    ('appvZv4ybVDsBXtvC', 'pfai4c5n8nb7fk1', '要求'),
    ('appvZv4ybVDsBXtvC', 'pfai4c5n8nb7fk1', '要件'),
    ('appvZv4ybVDsBXtvC', 'pfai4c5n8nb7fk1', 'バグ'),

    # SalesTailor
    ('app8uhkD8PcnxPvVx', 'pqot58neiu3o1xo', '要求'),
    ('app8uhkD8PcnxPvVx', 'pqot58neiu3o1xo', '要件'),
    ('app8uhkD8PcnxPvVx', 'pqot58neiu3o1xo', 'バグ'),
]


def main():
    print("=" * 80)
    print("Retry Failed Tables Migration")
    print("=" * 80)

    airtable = AirtableApi(AIRTABLE_TOKEN)

    success_count = 0
    failed_count = 0

    for airtable_base_id, nocodb_base_id, table_name in FAILED_TABLES:
        print(f"\n{'=' * 60}")
        print(f"Retrying: {table_name}")
        print(f"{'=' * 60}")

        try:
            result = migrate_table(
                airtable,
                airtable_base_id,
                table_name,
                nocodb_base_id
            )

            if result['error']:
                print(f"  ✗ Failed: {result['error']}")
                failed_count += 1
            else:
                print(f"  ✓ Success: {result['records_migrated']} records")
                success_count += 1

        except Exception as e:
            print(f"  ✗ Exception: {str(e)}")
            failed_count += 1

    print(f"\n{'=' * 80}")
    print("Summary")
    print(f"{'=' * 80}")
    print(f"Success: {success_count}")
    print(f"Failed: {failed_count}")


if __name__ == '__main__':
    main()
