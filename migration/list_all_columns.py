#!/usr/bin/env python3
import os
import sys
from dotenv import load_dotenv
from nocodb_client import NocoDBClient

load_dotenv('/Users/ksato/workspace/.env')

client = NocoDBClient(os.getenv('NOCODB_URL'), os.getenv('NOCODB_TOKEN'))
table = client.get_table('mwdfzfqsdm088vt')  # スプリント

print(f"Total columns: {len(table.get('columns', []))}")
print("\nColumn List:")
for i, col in enumerate(table.get('columns', []), 1):
    system = " [SYSTEM]" if col.get('system') else ""
    print(f"{i}. {col.get('title'):30} | {col.get('uidt'):20} | {col.get('column_name')}{system}")
