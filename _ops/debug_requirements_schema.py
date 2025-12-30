#!/usr/bin/env python3
import os
from dotenv import load_dotenv
from pyairtable import Api as AirtableApi

load_dotenv()

AIRTABLE_TOKEN = os.getenv('AIRTABLE_API_KEY_READONLY', os.getenv('AIRTABLE_TOKEN'))

airtable = AirtableApi(AIRTABLE_TOKEN)
base = airtable.base('appLXuHKJGitc6CGd')  # DialogAI

# Get schema
schema = base.schema()
table_schema = schema.table('要件')

print("要件 table fields:")
print("=" * 60)

for field in table_schema.fields:
    print(f"\nField: {field.name}")
    print(f"  Type: {field.type}")
    if hasattr(field, 'options'):
        print(f"  Options: {field.options}")

# Get a sample record to see actual data
table = base.table('要件')
records = list(table.all())

if records:
    print("\n" + "=" * 60)
    print("Sample record fields:")
    print("=" * 60)
    sample = records[0]['fields']
    for key, value in sample.items():
        print(f"\n{key}: {repr(value)} (type: {type(value).__name__})")
