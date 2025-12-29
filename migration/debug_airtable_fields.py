#!/usr/bin/env python3
import os
from dotenv import load_dotenv
from pyairtable import Api

load_dotenv('/Users/ksato/workspace/.env')

api = Api(os.getenv('AIRTABLE_TOKEN'))
base = api.base('appCysQGZowfOd58i')
table = base.table('マイルストーン')
schema = table.schema()

print("=== マイルストーン フィールド詳細 ===\n")
for field in schema.fields:
    print(f"フィールド名: {field.name}")
    print(f"  タイプ: {field.type}")
    if hasattr(field, 'options') and field.options:
        print(f"  Options: {field.options}")
        if hasattr(field.options, 'choices'):
            print(f"  Choices:")
            for choice in field.options.choices:
                print(f"    - {choice.name}")
    print()
