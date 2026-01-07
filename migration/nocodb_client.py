"""
NocoDB REST API Client
NocoDBのREST APIラッパー（プロジェクト、テーブル、フィールド、レコード操作）
"""

import requests
import logging
from typing import Dict, List, Optional, Any
from time import sleep

logger = logging.getLogger(__name__)


class NocoDBClient:
    """NocoDB REST API クライアント"""

    def __init__(self, base_url: str, api_token: str):
        """
        Args:
            base_url: NocoDB URL (例: http://localhost:8080)
            api_token: NocoDB API Token
        """
        self.base_url = base_url.rstrip('/')
        self.api_token = api_token
        self.headers = {
            'xc-token': api_token,
            'Content-Type': 'application/json'
        }

    def _request(self, method: str, endpoint: str, **kwargs) -> requests.Response:
        """
        HTTP リクエストを実行（リトライ機構付き）

        Args:
            method: HTTPメソッド (GET, POST, PUT, DELETE)
            endpoint: APIエンドポイント
            **kwargs: requestsライブラリに渡す引数

        Returns:
            requests.Response
        """
        url = f"{self.base_url}/api/v1{endpoint}"
        max_retries = 3
        retry_delay = 2

        for attempt in range(max_retries):
            try:
                response = requests.request(
                    method=method,
                    url=url,
                    headers=self.headers,
                    **kwargs
                )
                response.raise_for_status()
                return response
            except requests.exceptions.RequestException as e:
                logger.warning(f"Request failed (attempt {attempt + 1}/{max_retries}): {e}")
                # エラーレスポンスの詳細を出力
                if hasattr(e, 'response') and e.response is not None:
                    try:
                        error_detail = e.response.json()
                        logger.error(f"Error response: {error_detail}")
                    except:
                        logger.error(f"Error response (text): {e.response.text[:500]}")

                if attempt < max_retries - 1:
                    sleep(retry_delay * (attempt + 1))
                else:
                    raise

    # === プロジェクト操作 ===

    def create_project(self, title: str, description: str = "") -> Dict[str, Any]:
        """
        新規プロジェクト作成

        Args:
            title: プロジェクト名
            description: 説明

        Returns:
            プロジェクト情報
        """
        logger.info(f"Creating project: {title}")
        response = self._request(
            'POST',
            '/db/meta/projects',
            json={
                'title': title,
                'description': description
            }
        )
        return response.json()

    def list_projects(self) -> List[Dict[str, Any]]:
        """
        プロジェクト一覧取得

        Returns:
            プロジェクトリスト
        """
        response = self._request('GET', '/db/meta/projects')
        return response.json().get('list', [])

    def get_project(self, project_id: str) -> Dict[str, Any]:
        """
        プロジェクト詳細取得

        Args:
            project_id: プロジェクトID

        Returns:
            プロジェクト情報
        """
        response = self._request('GET', f'/db/meta/projects/{project_id}')
        return response.json()

    # === テーブル操作 ===

    def create_table(self, project_id: str, title: str, columns: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        新規テーブル作成

        Args:
            project_id: プロジェクトID
            title: テーブル名
            columns: カラム定義リスト

        Returns:
            テーブル情報
        """
        logger.info(f"Creating table: {title}")
        response = self._request(
            'POST',
            f'/db/meta/projects/{project_id}/tables',
            json={
                'table_name': title,
                'title': title,
                'columns': columns
            }
        )
        return response.json()

    def list_tables(self, project_id: str) -> List[Dict[str, Any]]:
        """
        テーブル一覧取得

        Args:
            project_id: プロジェクトID

        Returns:
            テーブルリスト
        """
        response = self._request('GET', f'/db/meta/projects/{project_id}/tables')
        return response.json().get('list', [])

    def get_table(self, table_id: str) -> Dict[str, Any]:
        """
        テーブル詳細取得

        Args:
            table_id: テーブルID

        Returns:
            テーブル情報
        """
        response = self._request('GET', f'/db/meta/tables/{table_id}')
        return response.json()

    # === カラム操作 ===

    def create_column(self, table_id: str, column: Dict[str, Any]) -> Dict[str, Any]:
        """
        新規カラム作成

        Args:
            table_id: テーブルID
            column: カラム定義

        Returns:
            カラム情報
        """
        logger.info(f"Creating column: {column.get('column_name')}")
        response = self._request(
            'POST',
            f'/db/meta/tables/{table_id}/columns',
            json=column
        )
        return response.json()

    def list_columns(self, table_id: str) -> List[Dict[str, Any]]:
        """
        カラム一覧取得

        Args:
            table_id: テーブルID

        Returns:
            カラムリスト
        """
        response = self._request('GET', f'/db/meta/tables/{table_id}/columns')
        return response.json().get('list', [])

    # === レコード操作 ===

    def create_record(self, project_id: str, table_name: str, record: Dict[str, Any]) -> Dict[str, Any]:
        """
        新規レコード作成

        Args:
            project_id: プロジェクトID
            table_name: テーブル名
            record: レコードデータ

        Returns:
            作成されたレコード
        """
        response = self._request(
            'POST',
            f'/db/data/noco/{project_id}/{table_name}',
            json=record
        )
        return response.json()

    def bulk_create_records(self, project_id: str, table_name: str, records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        一括レコード作成

        Args:
            project_id: プロジェクトID
            table_name: テーブル名
            records: レコードデータリスト

        Returns:
            作成されたレコードリスト
        """
        logger.info(f"Bulk creating {len(records)} records in {table_name}")
        response = self._request(
            'POST',
            f'/db/data/bulk/noco/{project_id}/{table_name}',
            json=records
        )
        return response.json()

    def list_records(
        self,
        project_id: str,
        table_name: str,
        limit: int = 100,
        offset: int = 0,
        where: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        レコード一覧取得

        Args:
            project_id: プロジェクトID
            table_name: テーブル名
            limit: 取得件数
            offset: オフセット
            where: フィルタ条件

        Returns:
            レコードリストとページング情報
        """
        params = {
            'limit': limit,
            'offset': offset
        }
        if where:
            params['where'] = where

        response = self._request(
            'GET',
            f'/db/data/noco/{project_id}/{table_name}',
            params=params
        )
        return response.json()

    def update_record(
        self,
        project_id: str,
        table_name: str,
        record_id: str,
        data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        レコード更新

        Args:
            project_id: プロジェクトID
            table_name: テーブル名
            record_id: レコードID
            data: 更新データ

        Returns:
            更新されたレコード
        """
        response = self._request(
            'PATCH',
            f'/db/data/noco/{project_id}/{table_name}/{record_id}',
            json=data
        )
        return response.json()

    def delete_record(self, project_id: str, table_name: str, record_id: str) -> None:
        """
        レコード削除

        Args:
            project_id: プロジェクトID
            table_name: テーブル名
            record_id: レコードID
        """
        self._request(
            'DELETE',
            f'/db/data/noco/{project_id}/{table_name}/{record_id}'
        )
