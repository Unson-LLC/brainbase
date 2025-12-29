#!/usr/bin/env python3
"""Test Airtable API structure"""

from pyairtable import Api
import os
from dotenv import load_dotenv

load_dotenv('/Users/ksato/workspace/.env')

api_key = os.getenv('AIRTABLE_API_KEY')
print(f'API Key loaded: {api_key[:20] if api_key else "NOT FOUND"}...')

api = Api(api_key)
base = api.base('app8uhkD8PcnxPvVx')
schema = base.schema()

print(f'\nSchema type: {type(schema)}')
print(f'Schema attributes: {[a for a in dir(schema) if not a.startswith("_")]}')

print(f'\nTables type: {type(schema.tables)}')
print(f'Number of tables: {len(schema.tables)}')

if schema.tables:
    first_table = schema.tables[0]
    print(f'\nFirst table type: {type(first_table)}')
    print(f'Table attributes: {[a for a in dir(first_table) if not a.startswith("_")]}')
    print(f'\nTable name: {first_table.name if hasattr(first_table, "name") else "NO NAME"}')

    if hasattr(first_table, 'fields'):
        print(f'Fields: {first_table.fields}')
    elif hasattr(first_table, 'schema'):
        table_schema = first_table.schema()
        print(f'Table schema type: {type(table_schema)}')
        if hasattr(table_schema, 'fields'):
            print(f'Schema fields: {table_schema.fields[:2] if table_schema.fields else "NONE"}')
