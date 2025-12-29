#!/usr/bin/env python3
"""
BAAOデータインポート
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

def convert_record(airtable_record: dict) -> dict:
    """
    Airtableレコードを NocoDBレコードに変換
    LinkedRecordsフィールドを除外
    """
    nocodb_record = {}
    for field_name, field_value in airtable_record['fields'].items():
        # 配列フィールドでかつ全要素が "rec" で始まる場合はLinkedRecords
        if isinstance(field_value, list) and field_value and all(
            isinstance(v, str) and v.startswith('rec') for v in field_value
        ):
            # LinkedRecordsは後で移行するため、除外
            continue
        nocodb_record[field_name] = field_value
    return nocodb_record

def main():
    # 接続情報
    airtable_token = os.getenv('AIRTABLE_TOKEN')
    nocodb_url = os.getenv('NOCODB_URL')
    nocodb_token = os.getenv('NOCODB_TOKEN')
    
    airtable_api = Api(airtable_token)
    nocodb_client = NocoDBClient(nocodb_url, nocodb_token)
    
    # プロジェクトID
    project_id = 'pqj22ze3jh0mkms'
    base_id = 'appCysQGZowfOd58i'

    # テーブルマッピング
    tables_mapping = {
        'マイルストーン': 'mm6b4dlz6w2wnnj',
        'スプリント': 'mp4slbwqfxutpii',
        'タスク': 'mxsy93mwfdvhug1'
    }
    
    base = airtable_api.base(base_id)
    
    for table_name, nocodb_table_id in tables_mapping.items():
        logger.info(f"\n=== データインポート: {table_name} ===")
        
        # Airtableからレコード取得
        airtable_table = base.table(table_name)
        records = airtable_table.all()
        
        logger.info(f"レコード数: {len(records)}")
        
        # NocoDBにインポート
        imported_count = 0
        failed_count = 0
        
        for record in tqdm(records, desc=f"{table_name}"):
            try:
                # レコード変換
                nocodb_record = convert_record(record)
                
                # NocoDBに挿入
                nocodb_client.create_record(
                    project_id=project_id,
                    table_name=table_name,
                    record=nocodb_record
                )
                imported_count += 1
            except Exception as e:
                logger.warning(f"レコードインポート失敗: {e}")
                failed_count += 1
        
        logger.info(f"✓ {table_name}: 成功 {imported_count}, 失敗 {failed_count}")
    
    logger.info("\n✓ データインポート完了")
    logger.info(f"\nNocoDB URL: {nocodb_url}/")

if __name__ == '__main__':
    main()
