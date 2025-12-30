#!/usr/bin/env python3
"""
Insert missing records for tables that were created but have no data
"""

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

# Tables that need data insertion (base_id, nocodb_base_id, table_name)
MISSING_DATA = [
    # Aitle
    ('appvZv4ybVDsBXtvC', 'pfai4c5n8nb7fk1', '要求'),
    ('appvZv4ybVDsBXtvC', 'pfai4c5n8nb7fk1', '要件'),
    # SalesTailor
    ('app8uhkD8PcnxPvVx', 'pqot58neiu3o1xo', '要求'),
    ('app8uhkD8PcnxPvVx', 'pqot58neiu3o1xo', '要件'),
]

def get_nocodb_table_id(base_id: str, table_name: str) -> str:
    """Get NocoDB table ID from base and table name"""
    url = f"{NOCODB_URL}/api/v2/meta/bases/{base_id}/tables"
    response = requests.get(url, headers=HEADERS)
    response.raise_for_status()

    tables = response.json().get('list', [])
    for table in tables:
        if table['title'] == table_name:
            return table['id']

    raise ValueError(f"Table {table_name} not found in base {base_id}")


def get_nocodb_columns(table_id: str) -> tuple:
    """Get column info from NocoDB table"""
    url = f"{NOCODB_URL}/api/v2/meta/tables/{table_id}"
    response = requests.get(url, headers=HEADERS)
    response.raise_for_status()

    table_data = response.json()
    columns = table_data.get('columns', [])

    # Build valid columns set and bigint columns set
    valid_columns = set()
    bigint_columns = set()

    for col in columns:
        if col['uidt'] in ['CreatedTime', 'LastModifiedTime', 'CreatedBy', 'LastModifiedBy', 'Order']:
            continue

        valid_columns.add(col['title'])

        # Track bigint columns
        if col.get('dt') == 'bigint':
            bigint_columns.add(col['title'])

    return valid_columns, bigint_columns


def insert_records_batch(table_id: str, records: List[Dict], table_name: str, valid_columns: set, bigint_columns: set):
    """Insert records in batches"""
    url = f"{NOCODB_URL}/api/v2/tables/{table_id}/records"
    batch_size = 50

    total_inserted = 0

    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]

        # Clean records - only include fields that exist in NocoDB table
        cleaned_batch = []
        for record in batch:
            cleaned_record = {}
            for key, value in record['fields'].items():
                # Only include fields that exist in NocoDB table
                if key not in valid_columns:
                    continue

                # Skip LinkedRecords (array of rec* IDs)
                if isinstance(value, list) and value and all(
                    isinstance(v, str) and v.startswith('rec') for v in value
                ):
                    continue

                # Convert decimal to integer for bigint columns
                if key in bigint_columns and isinstance(value, (int, float)):
                    value = int(round(value))

                cleaned_record[key] = value
            cleaned_batch.append(cleaned_record)

        try:
            response = requests.post(url, headers=HEADERS, json=cleaned_batch)

            if response.status_code != 200:
                print(f"    ERROR: Status {response.status_code}")
                print(f"    Response: {response.text[:500]}")
                print(f"    Sample record: {str(cleaned_batch[0])[:200]}")
                continue

            total_inserted += len(batch)
            print(f"    Inserted {len(batch)} records ({total_inserted}/{len(records)})")
            time.sleep(0.5)  # Rate limit

        except Exception as e:
            print(f"    ERROR inserting batch: {str(e)}")
            continue

    return total_inserted


def main():
    print("=" * 80)
    print("Insert Missing Records")
    print("=" * 80)

    airtable = AirtableApi(AIRTABLE_TOKEN)

    for airtable_base_id, nocodb_base_id, table_name in MISSING_DATA:
        print(f"\n{'=' * 60}")
        print(f"Processing: {table_name} ({nocodb_base_id})")
        print(f"{'=' * 60}")

        try:
            # Get NocoDB table ID
            table_id = get_nocodb_table_id(nocodb_base_id, table_name)
            print(f"  Table ID: {table_id}")

            # Get valid columns and bigint columns
            valid_columns, bigint_columns = get_nocodb_columns(table_id)
            print(f"  Valid columns: {len(valid_columns)} columns")
            if bigint_columns:
                print(f"  Bigint columns: {', '.join(bigint_columns)}")

            # Fetch Airtable records
            print(f"  Fetching records from Airtable...")
            base = airtable.base(airtable_base_id)
            airtable_table = base.table(table_name)
            records = list(airtable_table.all())
            print(f"  Found {len(records)} records")

            # Insert records
            if records:
                print(f"  Inserting records...")
                inserted = insert_records_batch(table_id, records, table_name, valid_columns, bigint_columns)
                print(f"  ✓ Completed: {inserted}/{len(records)} records inserted")
            else:
                print(f"  ⚠️  No records to insert")

        except Exception as e:
            print(f"  ✗ ERROR: {str(e)}")

        time.sleep(3)  # Rate limit between tables

    print("\n" + "=" * 80)
    print("Done!")
    print("=" * 80)


if __name__ == '__main__':
    main()
