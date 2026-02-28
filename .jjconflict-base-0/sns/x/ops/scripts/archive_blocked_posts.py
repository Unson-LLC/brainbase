#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from typing import Any

import requests
from dotenv import load_dotenv

load_dotenv("/Users/ksato/workspace/.env")

NOCODB_URL = os.getenv("NOCODB_URL", "https://noco.unson.jp")
NOCODB_TOKEN = os.getenv("NOCODB_TOKEN")
BASE_ID = os.getenv("BRAINBASE_NOCODB_BASE_ID", "pva7l2qlu6fdfip")
TABLE_ID = os.getenv("BRAINBASE_NOCODB_CONTENT_TABLE_ID", "mug1xcdhqhi7kjr")

HEADERS = {
    "xc-token": NOCODB_TOKEN or "",
    "Content-Type": "application/json",
}

BLOCK_TOPIC_GUIDE = (
    "あなたは出荷ブロッカー。\n"
    "判定対象が「SNS自動化・SNS運用自動化・SNS投稿自動化・X自動化・自動投稿・投稿スケジューラ・\n"
    "返信/分析/予約の自動化ツール・SNS運用の自動最適化」に該当する場合は blocked = true。\n"
    "SNSとは無関係な自動化や、SNS運用以外の話題は blocked = false。\n"
    "迷ったら blocked = true を返す。"
)

CLAUDE_TOKEN_URL = os.environ.get("CLAUDE_TOKEN_URL", "https://console.anthropic.com/v1/oauth/token")
CLAUDE_CLIENT_ID = os.environ.get("CLAUDE_CLIENT_ID", "9d1c250a-e61b-44d9-88ed-5944d1962f5e")
_TOKEN_REFRESHED = False

PREFILTER_KEYWORDS = [
    "SNS",
    "X",
    "エックス",
    "Twitter",
    "ツイッター",
    "自動",
    "自動化",
    "スケジュール",
    "スケジューラ",
]

SNS_WORDS = ["SNS", "X", "エックス", "Twitter", "ツイッター"]
AUTO_WORDS = [
    "自動",
    "自動化",
    "自動投稿",
    "自動運用",
    "自動返信",
    "自動分析",
    "スケジュール",
    "スケジューラ",
    "仕組み",
    "工場",
    "ライン",
    "ワークフロー",
    "テンプレ",
    "WIP",
    "レビュー",
    "出荷",
    "生成",
    "並行",
]


class SyncError(RuntimeError):
    pass


def run_claude(prompt: str, system_prompt: str, timeout: int = 60) -> str:
    ensure_claude_oauth_token()
    claude_bin = os.environ.get("CLAUDE_CODE_BIN", "claude")
    model = os.environ.get("CLAUDE_CODE_MODEL")
    agents = {
        "block_guard": {
            "description": "block_guard",
            "prompt": system_prompt.strip(),
        }
    }
    cmd = [
        claude_bin,
        "-p",
        "--agent",
        "block_guard",
        "--agents",
        json.dumps(agents, ensure_ascii=False),
        "--output-format",
        "text",
    ]
    if model:
        cmd.extend(["--model", model])
    cmd.append(prompt)
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise SyncError(result.stderr.strip() or result.stdout.strip() or "claude failed")
    return result.stdout.strip()


def extract_json(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```\w*\n?", "", cleaned)
        cleaned = re.sub(r"\n?```$", "", cleaned)
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise SyncError("No JSON in response")
    return json.loads(cleaned[start : end + 1])


def ensure_claude_oauth_token() -> None:
    global _TOKEN_REFRESHED
    if os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        return
    if _TOKEN_REFRESHED:
        return
    refresh_token = os.environ.get("CLAUDE_REFRESH_TOKEN")
    if not refresh_token:
        raise SyncError("CLAUDE_REFRESH_TOKEN is missing. Set it in /Users/ksato/workspace/.env")
    payload = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": CLAUDE_CLIENT_ID,
    }
    resp = requests.post(CLAUDE_TOKEN_URL, json=payload, timeout=10)
    if resp.status_code != 200:
        raise SyncError(f"Claude token refresh failed: {resp.status_code} {resp.text[:200]}")
    data = resp.json()
    access_token = data.get("access_token")
    if not access_token:
        raise SyncError("Claude token refresh did not return access_token")
    os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = access_token
    _TOKEN_REFRESHED = True


def get_primary_key(table_id: str) -> str:
    url = f"{NOCODB_URL}/api/v2/meta/tables/{table_id}"
    resp = requests.get(url, headers=HEADERS)
    if resp.status_code != 200:
        raise SyncError(f"Failed to fetch table metadata: {resp.status_code} {resp.text[:200]}")
    for col in resp.json().get("columns", []):
        if col.get("pk"):
            return col.get("title")
    return "Id"


def list_records(table_id: str) -> list[dict[str, Any]]:
    url = f"{NOCODB_URL}/api/v2/tables/{table_id}/records"
    limit = 200
    offset = 0
    records: list[dict[str, Any]] = []
    while True:
        resp = requests.get(url, headers=HEADERS, params={"limit": limit, "offset": offset})
        if resp.status_code != 200:
            raise SyncError(f"Failed to list records: {resp.status_code} {resp.text[:200]}")
        data = resp.json()
        batch = data.get("list") if isinstance(data, dict) else data
        if not batch:
            break
        records.extend(batch)
        if len(batch) < limit:
            break
        offset += limit
    return records


def normalize_text(record: dict[str, Any]) -> str:
    parts = []
    for key in ["hook", "body", "notes", "cta", "target_icp", "source_path"]:
        value = record.get(key)
        if value:
            parts.append(str(value))
    return "\n".join(parts)


def should_prefilter(text: str) -> bool:
    return any(keyword in text for keyword in PREFILTER_KEYWORDS)


def keyword_block(text: str) -> tuple[bool, str]:
    has_sns = any(word in text for word in SNS_WORDS)
    has_ops = any(word in text for word in AUTO_WORDS) or ("wip" in text.lower())
    return bool(has_sns and has_ops), "keyword_ops_block"


def classify_block(text: str, mode: str) -> tuple[bool, str]:
    if mode == "keywords":
        return keyword_block(text)
    prompt = (
        f"対象:\n{text}\n\n"
        "JSONで返す: {\"blocked\": true/false, \"reason\": \"...\"}"
    )
    raw = run_claude(prompt, BLOCK_TOPIC_GUIDE, timeout=30)
    data = extract_json(raw)
    return bool(data.get("blocked", False)), str(data.get("reason", "")).strip()


def update_records(table_id: str, primary_key: str, rows: list[dict[str, Any]], dry_run: bool) -> None:
    if not rows:
        return
    if dry_run:
        print(f"Dry-run: archive {len(rows)} records")
        return
    url = f"{NOCODB_URL}/api/v2/tables/{table_id}/records"
    batch_size = 50
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        resp = requests.patch(url, headers=HEADERS, json=batch)
        if resp.status_code not in (200, 201):
            raise SyncError(f"Update failed: {resp.status_code} {resp.text[:200]}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max", type=int, default=0, help="limit number of archives")
    parser.add_argument("--mode", choices=["llm", "keywords"], default="llm")
    parser.add_argument("--max-candidates", type=int, default=0, help="limit number of candidates to scan")
    args = parser.parse_args()

    if not NOCODB_TOKEN:
        raise SyncError("NOCODB_TOKEN is missing")

    primary_key = get_primary_key(TABLE_ID)
    records = list_records(TABLE_ID)

    candidates = []
    for record in records:
        status = record.get("status")
        if status in {"published", "archived"}:
            continue
        text = normalize_text(record)
        if not text:
            continue
        if not should_prefilter(text):
            continue
        candidates.append(record)

    updates = []
    scanned = 0
    for record in candidates:
        scanned += 1
        text = normalize_text(record)
        blocked, reason = classify_block(text, args.mode)
        if not blocked:
            if args.max_candidates and scanned >= args.max_candidates:
                break
            continue
        pk_value = record.get(primary_key) or record.get("Id") or record.get("id")
        if pk_value is None:
            continue
        updates.append({primary_key: pk_value, "status": "archived"})
        print(f"archive: {record.get('source_path') or record.get('hook') or pk_value} ({reason})")
        if args.max and len(updates) >= args.max:
            break
        if args.max_candidates and scanned >= args.max_candidates:
            break

    update_records(TABLE_ID, primary_key, updates, args.dry_run)
    print(f"Done. archived={len(updates)} scanned={scanned} total_candidates={len(candidates)}")


if __name__ == "__main__":
    try:
        main()
    except SyncError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
