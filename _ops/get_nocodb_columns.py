#!/usr/bin/env python3
"""Check which columns exist in NocoDB table"""
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

    print("NocoDB columns for 要件 table:")
    print("=" * 60)
    for col in columns:
        print(f"{col['title']:30s} {col['uidt']:20s}")
else:
    print(f"ERROR: {response.status_code}")
    print(response.text)
