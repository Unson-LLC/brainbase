#!/usr/bin/env python3
"""Check column data types in NocoDB"""
import os
import requests
from dotenv import load_dotenv

load_dotenv()

NOCODB_URL = os.getenv('NOCODB_URL')
NOCODB_TOKEN = os.getenv('NOCODB_TOKEN')

HEADERS = {
    "xc-token": NOCODB_TOKEN,
    "Content-Type": "application/json"
}

# Get table info
url = f"{NOCODB_URL}/api/v2/meta/tables/mt3xffqxn8ldxpg"  # 要件 table ID
response = requests.get(url, headers=HEADERS)

if response.status_code == 200:
    table_data = response.json()
    columns = table_data.get('columns', [])

    print("Number columns in 要件 table:")
    print("=" * 80)
    for col in columns:
        if col['uidt'] in ['Number', 'Decimal', 'Integer']:
            print(f"\nColumn: {col['title']}")
            print(f"  Type: {col['uidt']}")
            print(f"  DB Type: {col.get('dt', 'N/A')}")
            if 'colOptions' in col:
                print(f"  Options: {col['colOptions']}")
else:
    print(f"ERROR: {response.status_code}")
    print(response.text)
