#!/usr/bin/env python3
"""
Single Base Migration Test
1つのAirtable baseをNocoDBに移行してテスト
"""

import os
import sys
import logging
from pathlib import Path
from dotenv import load_dotenv

# 親ディレクトリをパスに追加
sys.path.insert(0, str(Path(__file__).parent))

from airtable_to_nocodb import AirtableToNocoDBMigration, setup_logging

def main():
    """1つのbaseのみ移行"""
    setup_logging()
    logger = logging.getLogger(__name__)

    config_path = Path(__file__).parent.parent / 'config.yml'

    if not config_path.exists():
        logger.error(f"Error: config.yml not found at {config_path}")
        sys.exit(1)

    try:
        migration = AirtableToNocoDBMigration(str(config_path))

        # 全base取得
        all_bases = migration.get_airtable_bases()

        # 最小のbase（BAAOまたはNCOM）を選択
        test_base = next((b for b in all_bases if b['base_name'] == 'BAAO'), all_bases[0])

        logger.info(f"\n{'=' * 80}")
        logger.info(f"Testing migration with single base: {test_base['base_name']}")
        logger.info(f"{'=' * 80}\n")

        # 単一base移行
        result = migration.migrate_base(test_base)

        # 結果レポート
        logger.info(f"\n{'=' * 80}")
        logger.info("Migration Test Result")
        logger.info(f"{'=' * 80}")
        logger.info(f"Base: {result['base_name']}")
        logger.info(f"Tables migrated: {len(result['tables'])}")
        logger.info(f"Total records: {result['total_records']}")

        if result['manual_fields']:
            logger.warning(f"\n⚠️  {len(result['manual_fields'])} fields require manual migration")
            for field in result['manual_fields'][:5]:
                logger.warning(f"  - {field}")

        if result['errors']:
            logger.error(f"\n❌ {len(result['errors'])} errors occurred:")
            for error in result['errors']:
                logger.error(f"  - {error}")
        else:
            logger.info("\n✅ Test migration completed successfully!")

    except Exception as e:
        logger.error(f"Fatal error: {str(e)}", exc_info=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
