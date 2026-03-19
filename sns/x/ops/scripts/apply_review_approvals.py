#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import requests
import yaml

from dispatch_logs import ensure_note_log, upsert_dispatch_entry, upsert_note_log_entry

ROOT = Path.home() / "workspace/brainbase-config/_codex"
POSTS_DIR = ROOT / "sns/x/05_posts"
POSTS_REVIEW_DIR = POSTS_DIR / "review"
POSTS_SCHEDULED_DIR = POSTS_DIR / "scheduled"
SCHEDULE_PATH = ROOT / "sns/scheduled_posts.yml"
X_ARTICLE_PUBLISH = ROOT / "sns/x/ops/scripts/x_article_web_draft.py"
NOTE_POST = ROOT / "common/ops/scripts/note_post.py"

NOCODB_URL = os.getenv("NOCODB_URL", "https://noco.unson.jp")
NOCODB_TOKEN = os.getenv("NOCODB_TOKEN")
DEFAULT_TABLE_ID = os.getenv("BRAINBASE_NOCODB_CONTENT_TABLE_ID") or "mug1xcdhqhi7kjr"

HEADERS = {
    "xc-token": NOCODB_TOKEN or "",
    "Content-Type": "application/json",
}


class SyncError(RuntimeError):
    pass


def parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    if not text.lstrip().startswith("---"):
        return {}, text.strip()
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text.strip()
    _, fm_text, body = parts[0], parts[1], parts[2]
    meta = yaml.safe_load(fm_text) or {}
    return meta, body.strip()


def write_markdown(path: Path, meta: dict[str, Any], body: str) -> None:
    front = "---\n" + yaml.safe_dump(meta, allow_unicode=True, sort_keys=False).strip() + "\n---\n\n"
    path.write_text(front + body.strip() + "\n", encoding="utf-8")


def first_nonempty_line(body: str) -> str:
    for line in body.splitlines():
        if line.strip():
            return line.strip()
    return ""


def dispatch_date(value: str | None) -> str:
    if value:
        text = str(value).strip()
        if len(text) >= 10:
            return text[:10]
    return datetime.now().date().isoformat()


def classify_post(meta: dict[str, Any], fields: dict[str, Any]) -> str:
    post_type = (fields.get("type") or meta.get("type") or "").lower()
    story_stage = (fields.get("story_stage") or meta.get("story_stage") or "").lower()
    if "x_article" in post_type or story_stage == "x_article":
        return "x_article"
    if "note" in post_type or story_stage == "note":
        return "note"
    return "x_post"


def load_schedule(path: Path) -> dict:
    if not path.exists():
        return {"posts": []}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {"posts": []}


def write_schedule(path: Path, data: dict) -> None:
    path.write_text(
        yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=1000),
        encoding="utf-8",
    )


def get_primary_key(table_id: str) -> str:
    url = f"{NOCODB_URL}/api/v2/meta/tables/{table_id}"
    resp = requests.get(url, headers=HEADERS)
    if resp.status_code != 200:
        raise SyncError(f"Failed to fetch primary key: {resp.status_code} {resp.text[:200]}")
    for col in resp.json().get("columns", []):
        if col.get("pk"):
            return col.get("title")
    return "Id"


def fetch_records(table_id: str) -> list[dict[str, Any]]:
    url = f"{NOCODB_URL}/api/v2/tables/{table_id}/records"
    limit = 200
    offset = 0
    records: list[dict[str, Any]] = []
    while True:
        resp = requests.get(url, headers=HEADERS, params={"limit": limit, "offset": offset})
        if resp.status_code != 200:
            raise SyncError(f"Failed to list records: {resp.status_code} {resp.text[:200]}")
        payload = resp.json()
        items = payload.get("list") if isinstance(payload, dict) else payload
        if not items:
            break
        records.extend(item for item in items if isinstance(item, dict))
        if len(items) < limit:
            break
        offset += limit
    return records


def update_record(table_id: str, primary_key: str, record_id: Any, fields: dict[str, Any]) -> None:
    url = f"{NOCODB_URL}/api/v2/tables/{table_id}/records"
    payload = [{primary_key: record_id, **fields}]
    resp = requests.patch(url, headers=HEADERS, json=payload)
    if resp.status_code not in (200, 201):
        raise SyncError(f"Update failed: {resp.status_code} {resp.text[:200]}")


def schedule_x_post(path: Path, meta: dict[str, Any], body: str, scheduled_at: str) -> Path:
    schedule = load_schedule(SCHEDULE_PATH)
    posts = schedule.get("posts", [])
    post_id = meta.get("id") or path.stem
    if any(p.get("id") == post_id for p in posts):
        return path

    title = meta.get("hook") or first_nonempty_line(body)
    story_id = meta.get("story_id")
    story_stage = meta.get("story_stage") or "hook"
    image = meta.get("image") or ""

    posts.append(
        {
            "id": post_id,
            "story_id": story_id,
            "story_stage": story_stage,
            "scheduled_at": scheduled_at,
            "type": "x_post",
            "title": title,
            "body": body,
            "image": image,
            "sns_smart_completed": True,
            "status": "ready",
        }
    )
    schedule["posts"] = posts
    write_schedule(SCHEDULE_PATH, schedule)

    meta["status"] = "ready"
    meta["scheduled_at"] = scheduled_at
    POSTS_SCHEDULED_DIR.mkdir(parents=True, exist_ok=True)
    dest = POSTS_SCHEDULED_DIR / path.name
    write_markdown(dest, meta, body)
    if path.exists():
        path.unlink()
    return dest


def publish_x_article(path: Path, dry_run: bool = False, headless: bool = False) -> None:
    if dry_run:
        return
    cmd = [sys.executable, str(X_ARTICLE_PUBLISH), str(path), "--publish"]
    if headless:
        cmd.append("--headless")
    result = os.spawnv(os.P_WAIT, sys.executable, cmd)
    if result != 0:
        raise RuntimeError("x_article publish failed")


def publish_note(path: Path, dry_run: bool = False, headless: bool = False) -> None:
    if dry_run:
        return
    cmd = [sys.executable, str(NOTE_POST), str(path)]
    if headless:
        cmd.append("--headless")
    result = os.spawnv(os.P_WAIT, sys.executable, cmd)
    if result != 0:
        raise RuntimeError("note publish failed")


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply NocoDB review approvals")
    parser.add_argument("--table-id", default=DEFAULT_TABLE_ID)
    parser.add_argument("--approve-field", default="review_status")
    parser.add_argument("--approve-value", default="approved")
    parser.add_argument("--mark-value", default="published")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--headless", action="store_true")
    args = parser.parse_args()

    if not NOCODB_TOKEN:
        raise SyncError("NOCODB_TOKEN is missing")

    ensure_note_log()
    primary_key = get_primary_key(args.table_id)
    records = fetch_records(args.table_id)
    now = datetime.now().isoformat(timespec="seconds")

    for record in records:
        record_id = record.get(primary_key) or record.get("Id") or record.get("id")
        fields = record.get("fields") or record
        if not isinstance(fields, dict):
            continue
        if fields.get(args.approve_field) != args.approve_value:
            continue
        source_path = fields.get("source_path")
        if not source_path:
            continue
        path = ROOT / source_path
        if not path.exists():
            continue

        text = path.read_text(encoding="utf-8", errors="ignore")
        meta, body = parse_frontmatter(text)
        content_type = classify_post(meta, fields)
        publish_at = fields.get("publish_at") or meta.get("scheduled_at")
        story_id = fields.get("story_id") or meta.get("story_id") or ""
        story_stage = fields.get("story_stage") or meta.get("story_stage") or (
            "x_article" if content_type == "x_article" else "note" if content_type == "note" else "hook"
        )
        source_for_log = str(path.relative_to(ROOT))

        if content_type == "x_post":
            if not publish_at:
                print(f"skip: scheduled_at missing for {source_path}")
                continue
            new_path = path
            if not args.dry_run:
                new_path = schedule_x_post(path, meta, body, publish_at)
            new_source = str(new_path.relative_to(ROOT)) if new_path else source_path
            update_record(
                args.table_id,
                primary_key,
                record_id,
                {
                    args.approve_field: args.mark_value,
                    "status": "ready",
                    "publish_at": publish_at,
                    "source_path": new_source,
                },
            )
            if not args.dry_run:
                upsert_dispatch_entry(
                    date_str=dispatch_date(publish_at),
                    slot_jst=str(publish_at),
                    story_id=story_id,
                    story_stage=story_stage,
                    channel="x",
                    content_type="x_post",
                    post_id=meta.get("id") or path.stem,
                    image=str(meta.get("image") or ""),
                    status="ready",
                    source_path=new_source,
                    note="approved_from_nocodb",
                )
            print(f"scheduled: {source_path}")
        elif content_type == "x_article":
            publish_x_article(path, dry_run=args.dry_run, headless=args.headless)
            if not args.dry_run:
                meta["status"] = "published"
                meta["published_at"] = now
                write_markdown(path, meta, body)
                upsert_dispatch_entry(
                    date_str=dispatch_date(publish_at or now),
                    slot_jst=str(publish_at or now),
                    story_id=story_id,
                    story_stage=story_stage,
                    channel="x",
                    content_type="x_article",
                    post_id=meta.get("id") or path.stem,
                    image=str(meta.get("image") or ""),
                    status="published",
                    source_path=source_for_log,
                    note="approved_from_nocodb",
                )
            update_record(
                args.table_id,
                primary_key,
                record_id,
                {args.approve_field: args.mark_value, "status": "published", "publish_at": publish_at},
            )
            print(f"published x_article: {source_path}")
        else:
            publish_note(path, dry_run=args.dry_run, headless=args.headless)
            if not args.dry_run:
                meta["status"] = "published"
                meta["published_at"] = now
                write_markdown(path, meta, body)
                title = fields.get("hook") or meta.get("hook") or first_nonempty_line(body) or path.stem
                upsert_dispatch_entry(
                    date_str=dispatch_date(publish_at or now),
                    slot_jst=str(publish_at or now),
                    story_id=story_id,
                    story_stage=story_stage,
                    channel="note",
                    content_type="note",
                    post_id=meta.get("id") or path.stem,
                    image=str(meta.get("image") or ""),
                    status="published",
                    source_path=source_for_log,
                    note="approved_from_nocodb",
                )
                upsert_note_log_entry(
                    published_at_jst=str(now),
                    story_id=story_id,
                    title=title,
                    source_path=source_for_log,
                    status="published",
                    memo="auto_published_from_approval",
                )
            update_record(
                args.table_id,
                primary_key,
                record_id,
                {args.approve_field: args.mark_value, "status": "published", "publish_at": publish_at},
            )
            print(f"published note: {source_path}")


if __name__ == "__main__":
    try:
        main()
    except SyncError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
