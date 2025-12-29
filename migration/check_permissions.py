#!/usr/bin/env python3
"""
NocoDB権限チェックスクリプト
プロジェクトとテーブルの権限設定を確認
"""

import os
import sys
from dotenv import load_dotenv
from nocodb_client import NocoDBClient

# .envから環境変数を読み込み
load_dotenv('/Users/ksato/workspace/.env')

def main():
    # NocoDB接続情報
    nocodb_url = os.getenv('NOCODB_URL')
    nocodb_token = os.getenv('NOCODB_TOKEN')
    
    if not nocodb_url or not nocodb_token:
        print("Error: NOCODB_URL or NOCODB_TOKEN not found in .env")
        sys.exit(1)
    
    client = NocoDBClient(nocodb_url, nocodb_token)
    
    # プロジェクト一覧取得
    print("=== NocoDB Projects ===")
    projects = client.list_projects()
    
    for project in projects:
        if 'BAAO' in project.get('title', ''):
            project_id = project.get('id')
            print(f"\nProject: {project.get('title')} (ID: {project_id})")
            
            # プロジェクト詳細取得
            project_detail = client.get_project(project_id)
            print(f"  Bases: {len(project_detail.get('bases', []))}")
            
            # テーブル一覧取得
            tables = client.list_tables(project_id)
            print(f"  Tables: {len(tables)}")
            
            for table in tables:
                table_id = table.get('id')
                table_title = table.get('title')
                print(f"\n  Table: {table_title} (ID: {table_id})")
                
                # テーブル詳細取得
                table_detail = client.get_table(table_id)
                print(f"    Columns: {len(table_detail.get('columns', []))}")
                print(f"    Type: {table_detail.get('type')}")
                
                # カラム詳細表示（最初の3つのみ）
                for i, col in enumerate(table_detail.get('columns', [])[:3]):
                    print(f"      - {col.get('title')} ({col.get('uidt')})")

if __name__ == '__main__':
    main()
