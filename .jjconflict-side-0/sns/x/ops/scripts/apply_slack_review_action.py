#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import yaml

from dispatch_logs import upsert_dispatch_entry

ROOT = Path("/Users/ksato/workspace/brainbase-config/_codex")
SCHEDULE_PATH = ROOT / "sns/scheduled_posts.yml"
POSTS_SCHEDULED_DIR = ROOT / "sns/x/05_posts/scheduled"
RUN_LEDGER_SCRIPT = ROOT / "common/ops/scripts/run_ledger.py"
JST = ZoneInfo("Asia/Tokyo")
GENERIC_EDIT_REASONS = {"", "slack:sns_review_edit"}


def load_schedule(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"posts": []}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {"posts": []}


def save_schedule(path: Path, data: dict[str, Any]) -> None:
    path.write_text(
        yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=1000),
        encoding="utf-8",
    )


def parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    if not text.lstrip().startswith("---"):
        return {}, text.strip()
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text.strip()
    return yaml.safe_load(parts[1]) or {}, parts[2].strip()


def write_markdown(path: Path, meta: dict[str, Any], body: str) -> None:
    front = "---\n" + yaml.safe_dump(meta, allow_unicode=True, sort_keys=False).strip() + "\n---\n\n"
    path.write_text(front + body.strip() + "\n", encoding="utf-8")


def parse_payload(raw: str) -> dict[str, Any]:
    data = json.loads(raw)
    if isinstance(data.get("payload"), str):
        data = json.loads(data["payload"])
    return data


def map_action_id(action_id: str) -> str:
    value = (action_id or "").lower()
    if "approve" in value:
        return "approve"
    if "reject" in value:
        return "reject"
    if "reschedule" in value:
        return "reschedule"
    if "edit" in value:
        return "edit"
    return ""


def action_status(action: str) -> str:
    if action == "approve":
        return "ready"
    if action == "reject":
        return "skipped"
    if action == "reschedule":
        return "ready"
    if action == "edit":
        return "ready"
    raise ValueError(f"Unsupported action: {action}")


def ledger_status(action: str) -> str:
    if action == "approve":
        return "approved"
    if action == "reject":
        return "blocked"
    if action in {"reschedule", "edit"}:
        return "review"
    return "failed"


def content_channel(post_type: str) -> tuple[str, str]:
    kind = (post_type or "").lower()
    if "note" in kind:
        return "note", "note"
    if "article" in kind:
        return "x", "x_article"
    return "x", "x_post"


def resolve_source_path(target: dict[str, Any], post_id: str) -> Path:
    source_raw = str(target.get("source_path") or "").strip()
    if source_raw:
        path = Path(source_raw)
        if not path.is_absolute():
            path = ROOT / source_raw
        return path
    return POSTS_SCHEDULED_DIR / f"{post_id}.md"


def to_root_relative(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def cleanup_edit_body(body: str, post_type: str) -> tuple[str, list[str]]:
    lines = str(body or "").splitlines()
    out: list[str] = []
    removed: list[str] = []
    skip_section = False
    skip_level = 7

    for raw in lines:
        line = raw.rstrip()
        stripped = line.strip()
        heading = re.match(r"^(#{1,6})\s*(.+?)\s*$", stripped)

        if skip_section:
            if heading and len(heading.group(1)) <= skip_level:
                skip_section = False
            elif stripped in {"---", "***", "___"}:
                # "次回予告" セクションは区切り線で終わるケースが多い。
                skip_section = False
                continue
            else:
                continue

        if re.match(r"^(?:\*\*)?文字数(?:\*\*)?\s*[:：]", stripped):
            removed.append("char_count_line")
            continue

        if heading and heading.group(2).startswith("次回予告"):
            skip_section = True
            skip_level = len(heading.group(1))
            removed.append("next_preview_section")
            continue

        if stripped == "次回予告":
            skip_section = True
            skip_level = 6
            removed.append("next_preview_section")
            continue

        out.append(line)

    cleaned = "\n".join(out)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    cleaned = re.sub(r"(?:\n---\n?|\n\*\*\*\n?)\s*$", "", cleaned).strip()
    return cleaned, removed


def run_ledger_write(action: str, post_id: str, actor: str, reason: str, source_path: str, output_status: str) -> None:
    run_id = f"sns-review-{post_id}-{datetime.now(JST).strftime('%Y%m%d%H%M%S')}"
    payload = {
        "run_id": run_id,
        "pipeline": "sns_review_exception",
        "phase": action,
        "status": ledger_status(action),
        "input_refs": ["sns/scheduled_posts.yml", source_path],
        "output_refs": ["sns/scheduled_posts.yml", source_path],
        "started_at": datetime.now(JST).isoformat(timespec="seconds"),
        "notes": "\n".join(
            [
                f"- actor: {actor or 'unknown'}",
                f"- action: {action}",
                f"- post_id: {post_id}",
                f"- result_status: {output_status}",
                f"- reason: {reason or '-'}",
            ]
        ),
    }
    try:
        subprocess.run(
            [sys.executable, str(RUN_LEDGER_SCRIPT), "write", "--run-json", json.dumps(payload, ensure_ascii=False)],
            check=True,
            capture_output=True,
            text=True,
        )
    except Exception as exc:
        print(f"WARN: run_ledger write failed: {exc}", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply Slack review action to SNS queue")
    parser.add_argument("--payload-json", default="")
    parser.add_argument("--payload-file", default="")
    parser.add_argument("--action", default="")
    parser.add_argument("--post-id", default="")
    parser.add_argument("--scheduled-at", default="")
    parser.add_argument("--actor", default="")
    parser.add_argument("--reason", default="")
    parser.add_argument("--schedule-file", default=str(SCHEDULE_PATH))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    payload: dict[str, Any] = {}
    if args.payload_file:
        payload = parse_payload(Path(args.payload_file).read_text(encoding="utf-8"))
    elif args.payload_json:
        payload = parse_payload(args.payload_json)

    action_id = ""
    value_data: dict[str, Any] = {}
    if payload:
        actions = payload.get("actions") or []
        if actions and isinstance(actions[0], dict):
            action_id = str(actions[0].get("action_id") or "")
            raw_value = actions[0].get("value")
            if isinstance(raw_value, str):
                try:
                    value_data = json.loads(raw_value)
                except Exception:
                    value_data = {}
        if not args.actor:
            user = payload.get("user") or {}
            if isinstance(user, dict):
                args.actor = str(user.get("id") or user.get("username") or "")

    action = args.action or str(value_data.get("action") or map_action_id(action_id))
    post_id = args.post_id or str(value_data.get("post_id") or "")
    scheduled_at = args.scheduled_at or str(value_data.get("scheduled_at") or "")
    reason = args.reason or str(value_data.get("reason") or "")
    actor = args.actor or "unknown"

    if not action:
        raise SystemExit("action is required")
    if not post_id:
        raise SystemExit("post_id is required")
    if action == "reschedule" and not scheduled_at:
        raise SystemExit("scheduled_at is required for reschedule")

    schedule_path = Path(args.schedule_file)
    data = load_schedule(schedule_path)
    posts = data.get("posts", [])
    target = None
    for post in posts:
        if post.get("id") == post_id:
            target = post
            break
    if target is None:
        raise SystemExit(f"post not found: {post_id}")

    before = dict(target)
    now_iso = datetime.now(JST).isoformat(timespec="seconds")
    new_status = action_status(action)
    edit_applied = False
    edit_removed: list[str] = []
    target["status"] = new_status
    if action == "reschedule":
        target["scheduled_at"] = scheduled_at
        target.pop("skipped_at", None)
        target.pop("skip_reason", None)
    elif action == "reject":
        target["skipped_at"] = now_iso
        target["skip_reason"] = reason or f"rejected_by:{actor}"
    elif action == "approve":
        target.pop("skipped_at", None)
        target.pop("skip_reason", None)
    elif action == "edit":
        target.pop("skipped_at", None)
        target.pop("skip_reason", None)
        target["edit_requested_at"] = now_iso
        target["edit_requested_by"] = actor
        if reason:
            target["edit_note"] = reason

    source_path = resolve_source_path(target, post_id)
    source_rel = to_root_relative(source_path)
    target["source_path"] = source_rel
    if source_path.exists():
        text = source_path.read_text(encoding="utf-8", errors="ignore")
        meta, body = parse_frontmatter(text)
        if action == "edit":
            cleaned, removed = cleanup_edit_body(body, str(target.get("type") or ""))
            edit_applied = cleaned != body
            edit_removed = sorted(set(removed))
            body = cleaned
            target["body"] = body
            target["edit_applied_at"] = now_iso
            target["edit_applied_by"] = "system"
            target["edit_cleanup"] = ",".join(edit_removed) if edit_removed else "noop"
        meta["status"] = new_status
        if target.get("scheduled_at"):
            meta["scheduled_at"] = target.get("scheduled_at")
        if target.get("posted_at"):
            meta["published_at"] = target.get("posted_at")
        if target.get("posted_url"):
            meta["x_url"] = target.get("posted_url")
        meta["reviewer"] = actor
        if action == "edit":
            meta["edited_at"] = now_iso
            meta["edited_by"] = actor
            if reason and reason not in GENERIC_EDIT_REASONS:
                meta["edit_note"] = reason
        if not args.dry_run:
            write_markdown(source_path, meta, body)
    elif action == "edit":
        cleaned, removed = cleanup_edit_body(str(target.get("body") or ""), str(target.get("type") or ""))
        edit_applied = cleaned != str(target.get("body") or "")
        edit_removed = sorted(set(removed))
        target["body"] = cleaned
        target["edit_applied_at"] = now_iso
        target["edit_applied_by"] = "system"
        target["edit_cleanup"] = ",".join(edit_removed) if edit_removed else "noop"

    channel, content_type = content_channel(str(target.get("type") or "x_post"))
    slot = str(target.get("scheduled_at") or now_iso)
    date_str = slot[:10] if len(slot) >= 10 else datetime.now(JST).date().isoformat()
    if not args.dry_run:
        save_schedule(schedule_path, data)
        upsert_dispatch_entry(
            date_str=date_str,
            slot_jst=slot,
            story_id=str(target.get("story_id") or ""),
            story_stage=str(target.get("story_stage") or ""),
            channel=channel,
            content_type=content_type,
            post_id=post_id,
            image=str(target.get("image") or ""),
            status=new_status,
            source_path=source_rel,
            note=f"slack_{action}",
        )
        run_ledger_write(action, post_id, actor, reason, source_rel, new_status)

    print(
        json.dumps(
            {
                "ok": True,
                "action": action,
                "post_id": post_id,
                "actor": actor,
                "status_before": before.get("status"),
                "status_after": target.get("status"),
                "scheduled_at_before": before.get("scheduled_at"),
                "scheduled_at_after": target.get("scheduled_at"),
                "edit_applied": edit_applied,
                "edit_cleanup": edit_removed,
                "dry_run": args.dry_run,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
