#!/usr/bin/env python3
import os
from dotenv import load_dotenv
from pyairtable import Api as AirtableApi

load_dotenv()

AIRTABLE_TOKEN = os.getenv('AIRTABLE_API_KEY_READONLY', os.getenv('AIRTABLE_TOKEN'))

CHECKS = [
    ('appLXuHKJGitc6CGd', 'DialogAI', ['要求', '要件', 'バグ', 'アンケート']),
    ('appvZv4ybVDsBXtvC', 'Aitle', ['要求', '要件', 'バグ']),
    ('app8uhkD8PcnxPvVx', 'SalesTailor', ['要求', '要件', 'バグ']),
]

airtable = AirtableApi(AIRTABLE_TOKEN)

for base_id, base_name, tables in CHECKS:
    print(f"\n{base_name} ({base_id}):")
    base = airtable.base(base_id)

    for table_name in tables:
        try:
            table = base.table(table_name)
            records = list(table.all())
            print(f"  {table_name}: {len(records)} records")
        except Exception as e:
            print(f"  {table_name}: ERROR - {str(e)}")
