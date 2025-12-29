#!/usr/bin/env python3
"""
NocoDB移行スクリプト v2
段階的なテーブル作成でメタデータ問題を回避
"""

import os
import sys
import logging
from dotenv import load_dotenv
from nocodb_client import NocoDBClient
from pyairtable import Api
from tqdm import tqdm
import colorlog

# ロギング設定
handler = colorlog.StreamHandler()
handler.setFormatter(colorlog.ColoredFormatter(
    '%(log_color)s%(levelname)-8s%(reset)s %(message)s',
    log_colors={
        'DEBUG': 'cyan',
        'INFO': 'green',
        'WARNING': 'yellow',
        'ERROR': 'red',
        'CRITICAL': 'red,bg_white',
    }
))
logger = colorlog.getLogger(__name__)
logger.addHandler(handler)
logger.setLevel(logging.INFO)

load_dotenv('/Users/ksato/workspace/.env')

def main():
    # 接続情報
    airtable_token = os.getenv('AIRTABLE_TOKEN')
    nocodb_url = os.getenv('NOCODB_URL')
    nocodb_token = os.getenv('NOCODB_TOKEN')
    
    airtable_api = Api(airtable_token)
    nocodb_client = NocoDBClient(nocodb_url, nocodb_token)
    
    # BAAOベース
    base_id = 'appCysQGZowfOd58i'
    
    logger.info("Step 1: NocoDBプロジェクト作成")
    project = nocodb_client.create_project('BAAO', 'BAAO移行テスト')
    project_id = project['id']
    logger.info(f"✓ プロジェクト作成完了: {project_id}")
    
    logger.info("\nStep 2: Airtableテーブル一覧取得")
    base = airtable_api.base(base_id)
    base_schema = base.schema()
    
    tables_to_migrate = ['マイルストーン', 'スプリント', 'タスク']
    
    for table_name in tables_to_migrate:
        logger.info(f"\n=== テーブル移行: {table_name} ===")
        
        # Airtableテーブル取得
        airtable_table = base.table(table_name)
        table_schema = airtable_table.schema()
        
        logger.info(f"フィールド数: {len(table_schema.fields)}")
        
        # NocoDBに最小限のテーブルを作成（IDのみ）
        logger.info("Step 2.1: 最小限のテーブル作成")
        minimal_columns = [
            {
                'column_name': 'id',
                'title': 'ID',
                'uidt': 'ID',
                'pk': True,
                'ai': True,
                'rqd': True
            }
        ]
        
        try:
            nocodb_table = nocodb_client.create_table(
                project_id=project_id,
                title=table_name,
                columns=minimal_columns
            )
            logger.info(f"✓ テーブル作成完了: {nocodb_table['id']}")
        except Exception as e:
            logger.error(f"✗ テーブル作成失敗: {e}")
            continue
        
        # カラムを一つずつ追加
        logger.info("Step 2.2: カラム追加")
        for field in tqdm(table_schema.fields, desc="カラム追加"):
            field_name = field.name
            field_type = field.type
            
            # システムフィールドとLinkedRecordsをスキップ
            if field_name in ['ID', 'Title'] or field_type == 'multipleRecordLinks':
                continue
            
            # 簡易マッピング
            uidt_mapping = {
                'singleLineText': 'SingleLineText',
                'multilineText': 'LongText',
                'singleSelect': 'SingleSelect',
                'multipleSelects': 'MultiSelect',
                'date': 'Date',
                'number': 'Number',
                'checkbox': 'Checkbox',
                'url': 'URL',
                'email': 'Email'
            }
            
            uidt = uidt_mapping.get(field_type, 'SingleLineText')
            
            column_data = {
                'column_name': field_name,
                'title': field_name,
                'uidt': uidt,
                'rqd': False
            }

            # SingleSelect/MultiSelectの選択肢
            if field_type in ['singleSelect', 'multipleSelects'] and hasattr(field.options, 'choices'):
                choices = [c.name for c in field.options.choices]
                column_data['colOptions'] = {
                    'options': [
                        {'title': choice, 'color': '#808080'}
                        for choice in choices
                    ]
                }
            
            try:
                nocodb_client.create_column(nocodb_table['id'], column_data)
            except Exception as e:
                logger.warning(f"カラム追加失敗 ({field_name}): {e}")
        
        logger.info(f"✓ テーブル '{table_name}' の構築完了")
    
    logger.info("\n✓ すべてのテーブル作成完了")
    logger.info(f"\nNocoDB URL: {nocodb_url}/nc/{project_id}")

if __name__ == '__main__':
    main()
