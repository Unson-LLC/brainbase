#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any

import requests
import yaml

try:
    from dotenv import load_dotenv

    load_dotenv()
    load_dotenv("/Users/ksato/workspace/.env", override=False)
except Exception:
    pass

ROOT = Path("/Users/ksato/workspace/brainbase-config/_codex")
REVIEW_DIR = ROOT / "sns/x/05_posts/review"
SCHEDULED_DIR = ROOT / "sns/x/05_posts/scheduled"
QC_DIR = ROOT / "sns/x/ops/qc"
SLACK_REVIEW_STATE_PATH = ROOT / "sns/log/slack_review_state.json"

NOCODB_URL = os.getenv("NOCODB_URL", "https://noco.unson.jp")
NOCODB_TOKEN = os.getenv("NOCODB_TOKEN")
DEFAULT_BASE_ID = os.getenv("BRAINBASE_NOCODB_BASE_ID") or "pva7l2qlu6fdfip"
DEFAULT_TABLE_ID = os.getenv("BRAINBASE_NOCODB_CONTENT_TABLE_ID") or "mug1xcdhqhi7kjr"

HEADERS = {
    "xc-token": NOCODB_TOKEN or "",
    "Content-Type": "application/json",
}

COLUMN_SPECS = [
    {"title": "source_path", "uidt": "SingleLineText"},
    {"title": "story_id", "uidt": "SingleLineText"},
    {
        "title": "story_stage",
        "uidt": "SingleSelect",
        "dtxp": "'x_short','x_article','note'",
    },
    {
        "title": "review_status",
        "uidt": "SingleSelect",
        "dtxp": "'pending','approved','published','rejected'",
    },
    {"title": "qc_score", "uidt": "Number"},
    {"title": "qc_issues", "uidt": "LongText"},
    {"title": "review_summary", "uidt": "LongText"},
    {"title": "body", "uidt": "LongText"},
    # Optional mirror fields (only applied when the table has these columns).
    {"title": "slack_thread_ts", "uidt": "SingleLineText"},
]


class SyncError(RuntimeError):
    pass


def parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text
    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            raw = "\n".join(lines[1:idx])
            fm = yaml.safe_load(raw) or {}
            body = "\n".join(lines[idx + 1 :])
            return fm, body
    return {}, text


def collect_posts(include_draft: bool = False) -> list[dict[str, Any]]:
    posts: list[dict[str, Any]] = []
    dirs = [REVIEW_DIR, SCHEDULED_DIR]
    if include_draft:
        dirs.append(ROOT / "sns/x/05_posts/draft")

    for directory in dirs:
        if not directory.exists():
            continue
        for path in sorted(directory.glob("*.md")):
            text = path.read_text(encoding="utf-8", errors="ignore")
            fm, body = parse_frontmatter(text)
            first_line = next((line.strip() for line in body.splitlines() if line.strip()), "")
            status = fm.get("status") or (
                "review" if "review" in path.parts else "scheduled" if "scheduled" in path.parts else "draft"
            )
            channel = (fm.get("primary_channel") or "X").upper()
            raw_type = str(fm.get("type") or "post").lower()
            if raw_type in {"x_article", "note", "article"}:
                post_type = "article"
            elif raw_type in {"post", "x_post", "thread", "email", "video", "other"}:
                post_type = raw_type if raw_type != "x_post" else "post"
            else:
                post_type = "other"
            owner = fm.get("owner") or "ksato"
            posts.append(
                {
                    "id": fm.get("id"),
                    "type": post_type,
                    "status": status,
                    "primary_channel": channel,
                    "owner": owner,
                    "hook": fm.get("hook") or first_line,
                    "cta": fm.get("cta"),
                    "publish_at": fm.get("scheduled_at") or fm.get("publish_at") or fm.get("published_at"),
                    "target_icp": fm.get("target_icp") or "未設定",
                    "story_id": fm.get("story_id"),
                    "story_stage": fm.get("story_stage"),
                    "source_path": str(path.relative_to(ROOT)),
                    "body": body.strip(),
                }
            )
    return posts


def load_qc_map() -> dict[str, dict[str, Any]]:
    results: dict[str, dict[str, Any]] = {}
    if not QC_DIR.exists():
        return results
    for path in QC_DIR.glob("*.json"):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        items = payload if isinstance(payload, list) else [payload]
        mtime = path.stat().st_mtime
        for item in items:
            if not isinstance(item, dict):
                continue
            post_id = item.get("id")
            if not post_id:
                continue
            current = results.get(post_id)
            if not current or mtime > current.get("mtime", 0):
                results[post_id] = {
                    "mtime": mtime,
                    "score": item.get("score"),
                    "diagnosis": item.get("diagnosis") or [],
                    "fix": item.get("fix") or [],
                    "rewrite_hint": item.get("rewrite_hint") or "",
                }
    return results


def load_slack_review_state(path: Path = SLACK_REVIEW_STATE_PATH) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for key, value in raw.items():
        if not isinstance(key, str):
            continue
        if not isinstance(value, dict):
            continue
        out[key] = value
    return out


def ensure_columns(table_id: str) -> set[str]:
    url = f"{NOCODB_URL}/api/v2/meta/tables/{table_id}"
    resp = requests.get(url, headers=HEADERS)
    if resp.status_code != 200:
        raise SyncError(f"Failed to fetch table metadata: {resp.status_code} {resp.text[:200]}")
    table_data = resp.json()
    columns = table_data.get("columns", [])
    existing = {col.get("title") for col in columns if col.get("title")}

    for spec in COLUMN_SPECS:
        if spec["title"] in existing:
            continue
        create_url = f"{NOCODB_URL}/api/v2/meta/tables/{table_id}/columns"
        create_resp = requests.post(create_url, headers=HEADERS, json=spec)
        if create_resp.status_code not in (200, 201):
            print(
                f"WARN: column create failed: {spec['title']} ({create_resp.status_code}) {create_resp.text[:200]}",
                file=sys.stderr,
            )
            continue
        existing.add(spec["title"])
    return existing


def get_primary_key(table_id: str) -> str:
    url = f"{NOCODB_URL}/api/v2/meta/tables/{table_id}"
    resp = requests.get(url, headers=HEADERS)
    if resp.status_code != 200:
        raise SyncError(f"Failed to fetch primary key: {resp.status_code} {resp.text[:200]}")
    for col in resp.json().get("columns", []):
        if col.get("pk"):
            return col.get("title")
    return "Id"


def get_valid_columns(table_id: str) -> set[str]:
    url = f"{NOCODB_URL}/api/v2/meta/tables/{table_id}"
    resp = requests.get(url, headers=HEADERS)
    if resp.status_code != 200:
        raise SyncError(f"Failed to fetch table columns: {resp.status_code} {resp.text[:200]}")
    columns = resp.json().get("columns", [])
    valid = set()
    for col in columns:
        if col.get("uidt") in {"CreatedTime", "LastModifiedTime", "CreatedBy", "LastModifiedBy", "Order"}:
            continue
        if col.get("title"):
            valid.add(col["title"])
    return valid


def fetch_existing_state(table_id: str, primary_key: str) -> tuple[dict[str, Any], int]:
    url = f"{NOCODB_URL}/api/v2/tables/{table_id}/records"
    limit = 200
    offset = 0
    mapping: dict[str, Any] = {}
    max_pk = 0

    while True:
        resp = requests.get(url, headers=HEADERS, params={"limit": limit, "offset": offset})
        if resp.status_code != 200:
            raise SyncError(f"Failed to list records: {resp.status_code} {resp.text[:200]}")
        data = resp.json()
        records = data.get("list") if isinstance(data, dict) else data
        if not records:
            break
        for record in records:
            if not isinstance(record, dict):
                continue
            record_id = record.get(primary_key) or record.get("Id") or record.get("id")
            fields = record.get("fields") or record
            source_path = fields.get("source_path") if isinstance(fields, dict) else None
            if source_path:
                mapping[source_path] = record_id
            if isinstance(record_id, int):
                max_pk = max(max_pk, record_id)
        if len(records) < limit:
            break
        offset += limit
    return mapping, max_pk


def chunked(items: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def sync_records(table_id: str, primary_key: str, records: list[dict[str, Any]], valid_columns: set[str], dry_run: bool = False) -> None:
    existing, max_pk = fetch_existing_state(table_id, primary_key)
    next_pk = max_pk + 1
    create_batch: list[dict[str, Any]] = []
    update_batch: list[dict[str, Any]] = []

    for record in records:
        source_path = record.get("source_path")
        fields = {}
        for key, value in record.items():
            if key not in valid_columns:
                continue
            if value is None:
                continue
            if isinstance(value, datetime):
                value = value.isoformat(sep=" ")
            elif isinstance(value, date):
                value = value.isoformat()
            fields[key] = value

        if not fields:
            continue

        record_id = existing.get(source_path)
        if record_id:
            payload = {primary_key: record_id}
            payload.update(fields)
            update_batch.append(payload)
        else:
            if primary_key in valid_columns and primary_key not in fields:
                fields[primary_key] = next_pk
                next_pk += 1
            create_batch.append(fields)

    if dry_run:
        print(f"Dry-run: create={len(create_batch)} update={len(update_batch)}")
        return

    url = f"{NOCODB_URL}/api/v2/tables/{table_id}/records"

    for batch in chunked(create_batch, 50):
        resp = requests.post(url, headers=HEADERS, json=batch)
        if resp.status_code == 200:
            continue
        # Fallback: try one by one to locate the failing record
        for record in batch:
            single_resp = requests.post(url, headers=HEADERS, json=[record])
            if single_resp.status_code != 200:
                key = record.get("source_path") or record.get("hook") or "(unknown)"
                raise SyncError(
                    f"Create failed for {key}: {single_resp.status_code} {single_resp.text[:200]}"
                )

    for batch in chunked(update_batch, 50):
        resp = requests.patch(url, headers=HEADERS, json=batch)
        if resp.status_code not in (200, 201):
            raise SyncError(f"Update failed: {resp.status_code} {resp.text[:200]}")


def build_records(
    posts: list[dict[str, Any]],
    qc_map: dict[str, dict[str, Any]],
    slack_state: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    def normalize_status(value: str) -> str:
        status = (value or "").lower()
        if status in {"draft", "review", "ready", "scheduled", "published", "archived", "rejected"}:
            return status
        if status in {"posted"}:
            return "published"
        if status in {"skip", "skipped", "reject"}:
            return "rejected"
        if status in {"pending"}:
            return "review"
        return "draft"

    for post in posts:
        post_id = str(post.get("id") or "")
        qc = qc_map.get(post.get("id") or "")
        qc_score = qc.get("score") if qc else None
        issues = []
        if qc:
            issues.extend(qc.get("diagnosis") or [])
            issues.extend(qc.get("fix") or [])
        qc_issues = "\n".join(f"- {line}" for line in issues) if issues else None
        review_summary = qc.get("rewrite_hint") if qc else None

        status = str(post.get("status") or "").lower()
        post_type = str(post.get("type") or "").lower()
        story_stage_raw = str(post.get("story_stage") or "").lower()
        if story_stage_raw in {"x_article", "note", "x_short"}:
            story_stage = story_stage_raw
        elif story_stage_raw in {"hook", "progress", "decision", "result", "reflection"}:
            story_stage = "x_short"
        elif "x_article" in post_type:
            story_stage = "x_article"
        elif "note" in post_type:
            story_stage = "note"
        else:
            story_stage = "x_short"

        if status in {"review", "draft", "pending"}:
            review_status = "pending"
        elif status in {"ready", "scheduled"}:
            review_status = "approved"
        elif status in {"rejected", "reject"}:
            review_status = "rejected"
        elif status in {"posted", "published"}:
            review_status = "published"
        elif status in {"skipped"}:
            review_status = "rejected"
        else:
            review_status = "pending"

        record = {
            "source_path": post.get("source_path"),
            "type": post.get("type"),
            "status": normalize_status(str(post.get("status") or "")),
            "primary_channel": post.get("primary_channel"),
            "owner": post.get("owner"),
            "hook": post.get("hook"),
            "cta": post.get("cta"),
            "publish_at": post.get("publish_at"),
            "target_icp": post.get("target_icp"),
            "story_id": post.get("story_id"),
            "story_stage": story_stage,
            "review_status": review_status,
            "qc_score": qc_score,
            "qc_issues": qc_issues,
            "review_summary": review_summary,
            "body": post.get("body"),
            "slack_thread_ts": (
                str((slack_state or {}).get(post_id, {}).get("message_ts") or "").strip() or None
            ),
        }
        records.append(record)
    return records


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-id", default=DEFAULT_BASE_ID)
    parser.add_argument("--table-id", default=DEFAULT_TABLE_ID)
    parser.add_argument("--include-draft", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not NOCODB_TOKEN:
        raise SyncError("NOCODB_TOKEN is missing")

    ensure_columns(args.table_id)
    valid_columns = get_valid_columns(args.table_id)
    primary_key = get_primary_key(args.table_id)

    posts = collect_posts(include_draft=args.include_draft)
    qc_map = load_qc_map()
    slack_state = load_slack_review_state()
    records = build_records(posts, qc_map, slack_state=slack_state)

    sync_records(args.table_id, primary_key, records, valid_columns, dry_run=args.dry_run)
    print(f"Synced {len(records)} records @ {datetime.now().isoformat(timespec='seconds')}")


if __name__ == "__main__":
    try:
        main()
    except SyncError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
