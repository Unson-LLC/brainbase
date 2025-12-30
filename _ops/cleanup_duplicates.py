#!/usr/bin/env python3
"""Clean up duplicate records and re-insert clean data"""

import os
import time
import requests
from typing import List, Dict
from dotenv import load_dotenv
from pyairtable import Api as AirtableApi

load_dotenv()

NOCODB_URL = os.getenv('NOCODB_URL')
NOCODB_TOKEN = os.getenv('NOCODB_TOKEN')
AIRTABLE_TOKEN = os.getenv('AIRTABLE_API_KEY_READONLY', os.getenv('AIRTABLE_TOKEN'))

HEADERS = {
    "xc-token": NOCODB_TOKEN,
    "Content-Type": "application/json"
}

# Only cleanup 要求 table (has duplicates)
TABLE_TO_CLEAN = [
    ('appLXuHKJGitc6CGd', 'ptykrgx40t36l9y', '要求', 'mahr6g6o4xf3plq'),
]

def delete_all_records(table_id: str, table_name: str):
    """Delete all records from a table"""
    # Get all record IDs
    url = f"{NOCODB_URL}/api/v2/tables/{table_id}/records"
    response = requests.get(url, headers=HEADERS, params={'limit': 1000})
    response.raise_for_status()

    records = response.json().get('list', [])
    print(f"  Found {len(records)} records to delete")

    if not records:
        return 0

    # Delete in batches
    batch_size = 50
    deleted_count = 0

    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        # Try both 'id' and 'Id' (NocoDB sometimes uses different case)
        record_ids = [r.get('id') or r.get('Id') for r in batch]

        # Delete batch
        delete_url = f"{NOCODB_URL}/api/v2/tables/{table_id}/records"
        response = requests.delete(delete_url, headers=HEADERS, json=record_ids)

        if response.status_code == 200:
            deleted_count += len(batch)
            print(f"    Deleted {len(batch)} records ({deleted_count}/{len(records)})")
        else:
            print(f"    ERROR: {response.status_code} - {response.text[:100]}")

        time.sleep(0.5)

    return deleted_count


print("=" * 80)
print("Cleanup Duplicates and Re-insert")
print("=" * 80)

for airtable_base_id, nocodb_base_id, table_name, table_id in TABLE_TO_CLEAN:
    print(f"\n{'=' * 60}")
    print(f"Processing: {table_name}")
    print(f"{'=' * 60}")

    # Delete all records
    print("  Deleting all records...")
    deleted = delete_all_records(table_id, table_name)
    print(f"  ✓ Deleted {deleted} records")

print("\n" + "=" * 80)
print("Done! Now run insert_missing_records.py to re-insert clean data")
print("=" * 80)
