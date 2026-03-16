#!/usr/bin/env python3
from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path.home() / "workspace/brainbase-config/_codex"
SNS_DIR = ROOT / "sns"
LOG_DIR = SNS_DIR / "log"
DISPATCH_TEMPLATE_PATH = LOG_DIR / "dispatch_plan_template.md"
NOTE_LOG_PATH = SNS_DIR / "note_log.md"
JST = ZoneInfo("Asia/Tokyo")

DISPATCH_DAY_TEMPLATE = """# dispatch plan ({date})

| slot_jst | story_id | story_stage | channel | content_type | post_id | image | status | source_path | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
"""

DISPATCH_TEMPLATE = """# dispatch plan template

Use this as a reference for `dispatch_plan_YYYY-MM-DD.md`.

| slot_jst | story_id | story_stage | channel | content_type | post_id | image | status | source_path | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-02-11T07:10:00+09:00 | story-20260211-001 | hook | x | x_post | x-20260211-001 | _codex/sns/images/gap_x-20260211-001.jpg | ready | sns/x/05_posts/scheduled/x-20260211-001.md | factory_line |
"""

NOTE_LOG_TEMPLATE = """# note log

| published_at_jst | story_id | title | source_path | note_url | pv | likes | follower_delta | status | memo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
"""


def _safe(value: str | None) -> str:
    if value is None:
        return ""
    text = str(value).strip().replace("\n", " ").replace("|", "/")
    return text


def _dispatch_path(date_str: str) -> Path:
    return LOG_DIR / f"dispatch_plan_{date_str}.md"


def ensure_dispatch_template() -> Path:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    if not DISPATCH_TEMPLATE_PATH.exists():
        DISPATCH_TEMPLATE_PATH.write_text(DISPATCH_TEMPLATE, encoding="utf-8")
    return DISPATCH_TEMPLATE_PATH


def ensure_dispatch_plan(date_str: str) -> Path:
    ensure_dispatch_template()
    plan_path = _dispatch_path(date_str)
    if not plan_path.exists():
        plan_path.write_text(DISPATCH_DAY_TEMPLATE.format(date=date_str), encoding="utf-8")
    return plan_path


def ensure_note_log() -> Path:
    NOTE_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not NOTE_LOG_PATH.exists():
        NOTE_LOG_PATH.write_text(NOTE_LOG_TEMPLATE, encoding="utf-8")
    return NOTE_LOG_PATH


def _upsert_table_row(path: Path, row: str, key: str) -> bool:
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    replaced = False
    for idx, line in enumerate(lines):
        if not line.startswith("|"):
            continue
        if line.strip().startswith("| ---"):
            continue
        if key and key in line:
            lines[idx] = row
            replaced = True
            break
    if not replaced:
        lines.append(row)
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    return replaced


def upsert_dispatch_entry(
    date_str: str,
    slot_jst: str,
    story_id: str,
    story_stage: str,
    channel: str,
    content_type: str,
    post_id: str,
    image: str,
    status: str,
    source_path: str,
    note: str = "",
) -> Path:
    plan_path = ensure_dispatch_plan(date_str)
    row = (
        f"| {_safe(slot_jst)} | {_safe(story_id)} | {_safe(story_stage)} | {_safe(channel)} | "
        f"{_safe(content_type)} | {_safe(post_id)} | {_safe(image)} | {_safe(status)} | "
        f"{_safe(source_path)} | {_safe(note)} |"
    )
    key = f"| {_safe(post_id)} |" if post_id else f"| {_safe(story_id)} | {_safe(story_stage)} |"
    _upsert_table_row(plan_path, row, key)
    return plan_path


def upsert_note_log_entry(
    published_at_jst: str,
    story_id: str,
    title: str,
    source_path: str,
    note_url: str = "",
    pv: str = "",
    likes: str = "",
    follower_delta: str = "",
    status: str = "published",
    memo: str = "",
) -> Path:
    note_path = ensure_note_log()
    row = (
        f"| {_safe(published_at_jst)} | {_safe(story_id)} | {_safe(title)} | {_safe(source_path)} | "
        f"{_safe(note_url)} | {_safe(pv)} | {_safe(likes)} | {_safe(follower_delta)} | "
        f"{_safe(status)} | {_safe(memo)} |"
    )
    key = f"| {_safe(source_path)} |" if source_path else f"| {_safe(story_id)} | {_safe(title)} |"
    _upsert_table_row(note_path, row, key)
    return note_path


def _today_jst() -> str:
    return datetime.now(JST).strftime("%Y-%m-%d")


def main() -> None:
    parser = argparse.ArgumentParser(description="dispatch/note log helper")
    sub = parser.add_subparsers(dest="command", required=True)

    ensure_parser = sub.add_parser("ensure", help="ensure template files")
    ensure_parser.add_argument("--date", default=_today_jst())

    dispatch_parser = sub.add_parser("dispatch", help="upsert one dispatch plan row")
    dispatch_parser.add_argument("--date", default=_today_jst())
    dispatch_parser.add_argument("--slot", required=True)
    dispatch_parser.add_argument("--story-id", default="")
    dispatch_parser.add_argument("--story-stage", default="")
    dispatch_parser.add_argument("--channel", default="x")
    dispatch_parser.add_argument("--content-type", default="x_post")
    dispatch_parser.add_argument("--post-id", default="")
    dispatch_parser.add_argument("--image", default="")
    dispatch_parser.add_argument("--status", default="ready")
    dispatch_parser.add_argument("--source-path", default="")
    dispatch_parser.add_argument("--note", default="")

    note_parser = sub.add_parser("note", help="upsert one note log row")
    note_parser.add_argument("--published-at", default=datetime.now(JST).isoformat(timespec="seconds"))
    note_parser.add_argument("--story-id", default="")
    note_parser.add_argument("--title", default="")
    note_parser.add_argument("--source-path", default="")
    note_parser.add_argument("--note-url", default="")
    note_parser.add_argument("--pv", default="")
    note_parser.add_argument("--likes", default="")
    note_parser.add_argument("--follower-delta", default="")
    note_parser.add_argument("--status", default="published")
    note_parser.add_argument("--memo", default="")

    args = parser.parse_args()
    if args.command == "ensure":
        ensure_dispatch_plan(args.date)
        ensure_note_log()
        return
    if args.command == "dispatch":
        upsert_dispatch_entry(
            date_str=args.date,
            slot_jst=args.slot,
            story_id=args.story_id,
            story_stage=args.story_stage,
            channel=args.channel,
            content_type=args.content_type,
            post_id=args.post_id,
            image=args.image,
            status=args.status,
            source_path=args.source_path,
            note=args.note,
        )
        return
    if args.command == "note":
        upsert_note_log_entry(
            published_at_jst=args.published_at,
            story_id=args.story_id,
            title=args.title,
            source_path=args.source_path,
            note_url=args.note_url,
            pv=args.pv,
            likes=args.likes,
            follower_delta=args.follower_delta,
            status=args.status,
            memo=args.memo,
        )


if __name__ == "__main__":
    main()
