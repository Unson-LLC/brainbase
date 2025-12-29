#!/usr/bin/env python3
"""
テーブル構造の詳細をデバッグ
"""

import os
import sys
import json
from dotenv import load_dotenv
from nocodb_client import NocoDBClient

load_dotenv('/Users/ksato/workspace/.env')

def main():
    nocodb_url = os.getenv('NOCODB_URL')
    nocodb_token = os.getenv('NOCODB_TOKEN')
    
    client = NocoDBClient(nocodb_url, nocodb_token)
    
    # スプリントテーブルの詳細取得
    table_id = 'mwdfzfqsdm088vt'  # スプリント
    
    print("=== Table Detail ===")
    table = client.get_table(table_id)
    
    # JSON整形して出力
    print(json.dumps(table, indent=2, ensure_ascii=False))
    
    print("\n=== Column Details ===")
    for col in table.get('columns', []):
        print(f"\nColumn: {col.get('title')}")
        print(f"  column_name: {col.get('column_name')}")
        print(f"  uidt: {col.get('uidt')}")
        print(f"  dt: {col.get('dt')}")
        print(f"  dtxp: {col.get('dtxp')}")
        print(f"  rqd: {col.get('rqd')}")
        print(f"  pk: {col.get('pk')}")
        print(f"  ai: {col.get('ai')}")
        print(f"  unique: {col.get('un')}")
        print(f"  system: {col.get('system')}")

if __name__ == '__main__':
    main()
