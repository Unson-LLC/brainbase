#!/usr/bin/env python3
"""Check migration status for all 3 bases"""

import os
import subprocess
from dotenv import load_dotenv
from pyairtable import Api as AirtableApi

load_dotenv()

AIRTABLE_TOKEN = os.getenv('AIRTABLE_API_KEY_READONLY', os.getenv('AIRTABLE_TOKEN'))

# Base mappings
BASES = [
    ('appLXuHKJGitc6CGd', 'ptykrgx40t36l9y', 'DialogAI', ['要求', '要件', 'バグ', 'アンケート']),
    ('appvZv4ybVDsBXtvC', 'pfai4c5n8nb7fk1', 'Aitle', ['要求', '要件', 'バグ']),
    ('app8uhkD8PcnxPvVx', 'pqot58neiu3o1xo', 'SalesTailor', ['要求', '要件', 'バグ']),
]

airtable = AirtableApi(AIRTABLE_TOKEN)

print("=" * 100)
print("Migration Status Summary")
print("=" * 100)

for airtable_base_id, nocodb_base_id, base_name, tables in BASES:
    print(f"\n{base_name}:")
    print("-" * 100)

    base = airtable.base(airtable_base_id)

    for table_name in tables:
        # Get Airtable count
        try:
            table = base.table(table_name)
            airtable_count = len(list(table.all()))
        except Exception as e:
            airtable_count = f"ERROR: {str(e)}"

        # Get NocoDB count
        try:
            result = subprocess.run(
                [
                    'ssh', '-i', '~/.ssh/lightsail-brainbase.pem', '-T', 'ubuntu@176.34.20.239',
                    f'docker exec postgres psql -U nocodb -d nocodb -t -c "SELECT count(*) FROM {nocodb_base_id}.{table_name};"'
                ],
                capture_output=True,
                text=True,
                timeout=10
            )

            if result.returncode == 0:
                nocodb_count = int(result.stdout.strip())
            else:
                nocodb_count = f"ERROR: {result.stderr[:50]}"
        except Exception as e:
            nocodb_count = f"ERROR: {str(e)}"

        # Status
        if isinstance(airtable_count, int) and isinstance(nocodb_count, int):
            if airtable_count == nocodb_count:
                status = "✓ OK"
            else:
                status = f"⚠️  MISMATCH (Airtable: {airtable_count}, NocoDB: {nocodb_count})"
        else:
            status = "✗ ERROR"

        print(f"  {table_name:15s}  Airtable: {str(airtable_count):>6s}  NocoDB: {str(nocodb_count):>6s}  {status}")

print("\n" + "=" * 100)
