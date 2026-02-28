#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests
import yaml

ROOT = Path("/Users/ksato/workspace/brainbase-config/_codex")
SCHEDULE_PATH = ROOT / "sns/scheduled_posts.yml"
STATE_PATH = ROOT / "sns/log/slack_review_state.json"
JST = ZoneInfo("Asia/Tokyo")


def load_schedule(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    payload = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    posts = payload.get("posts") if isinstance(payload, dict) else []
    return posts if isinstance(posts, list) else []


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_state(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_scheduled_at(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=JST)
        return dt
    except ValueError:
        return None


def post_fingerprint(post: dict[str, Any]) -> str:
    material = "|".join(
        [
            str(post.get("status") or ""),
            str(post.get("scheduled_at") or ""),
            str(post.get("type") or ""),
            str(post.get("title") or ""),
            str(post.get("body") or ""),
        ]
    )
    return hashlib.sha1(material.encode("utf-8")).hexdigest()


def build_body_preview(body: str, max_chars: int = 420) -> str:
    lines = [line.strip() for line in (body or "").splitlines() if line.strip()]
    preview = " / ".join(lines[:6])
    if len(preview) > max_chars:
        return preview[: max_chars - 1] + "…"
    return preview


def parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    if not text.lstrip().startswith("---"):
        return {}, text.strip()
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text.strip()
    meta = yaml.safe_load(parts[1]) or {}
    return meta, parts[2].strip()


def dedupe_text(text: str) -> str:
    return "".join(str(text or "").split()).strip()


def similarity_ratio(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def is_posted_like(post: dict[str, Any]) -> bool:
    status = str(post.get("status") or "").lower()
    if status in {"posted", "published"}:
        return True
    # Defensive guard for partially-updated records.
    return bool(post.get("posted_at") or post.get("posted_url"))


def has_posted_duplicate(target: dict[str, Any], posts: list[dict[str, Any]]) -> bool:
    target_id = str(target.get("id") or "")
    target_title = dedupe_text(target.get("title") or "")
    target_body = dedupe_text(target.get("body") or "")
    for post in posts:
        if str(post.get("id") or "") == target_id:
            continue
        if not is_posted_like(post):
            continue
        title_sim = similarity_ratio(target_title, dedupe_text(post.get("title") or ""))
        body_sim = similarity_ratio(target_body, dedupe_text(post.get("body") or ""))
        if body_sim >= 0.97:
            return True
        if title_sim >= 0.98 and body_sim >= 0.90:
            return True
    return False


def reschedule_iso(scheduled_at: str | None, delta: timedelta) -> str | None:
    base = parse_scheduled_at(scheduled_at)
    if not base:
        return None
    return (base + delta).isoformat()


def build_blocks(post: dict[str, Any]) -> list[dict[str, Any]]:
    post_id = str(post.get("id") or "")
    story_id = str(post.get("story_id") or "")
    post_type = str(post.get("type") or "x_post")
    status = str(post.get("status") or "ready")
    title = str(post.get("title") or "(no title)")
    scheduled_at = str(post.get("scheduled_at") or "")
    preview = build_body_preview(str(post.get("body") or ""))

    def action_value(action: str, override_scheduled_at: str | None = None) -> str:
        return json.dumps(
            {
                "post_id": post_id,
                "story_id": story_id,
                "action": action,
                "scheduled_at": override_scheduled_at if override_scheduled_at is not None else scheduled_at,
            },
            ensure_ascii=False,
        )

    plus_1h = reschedule_iso(scheduled_at, timedelta(hours=1))
    plus_1d = reschedule_iso(scheduled_at, timedelta(days=1))

    blocks: list[dict[str, Any]] = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f":factory: SNS Review {post_id}", "emoji": True},
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"*type:* `{post_type}`  *status:* `{status}`\n"
                    f"*story:* `{story_id or '-'}`\n"
                    f"*scheduled_at:* `{scheduled_at or '-'}`\n"
                    f"*title:* {title}"
                ),
            },
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*body preview:*\n{preview or '(empty)'}"},
        },
    ]

    actions: list[dict[str, Any]] = [
        {
            "type": "button",
            "action_id": "sns_review_approve",
            "style": "primary",
            "text": {"type": "plain_text", "text": "承認", "emoji": True},
            "value": action_value("approve"),
        },
        {
            "type": "button",
            "action_id": "sns_review_reject",
            "style": "danger",
            "text": {"type": "plain_text", "text": "却下", "emoji": True},
            "value": action_value("reject"),
        },
        {
            "type": "button",
            "action_id": "sns_review_edit",
            "text": {"type": "plain_text", "text": "編集依頼", "emoji": True},
            "value": action_value("edit"),
        },
    ]
    if plus_1h:
        actions.append(
            {
                "type": "button",
                "action_id": "sns_review_reschedule_1h",
                "text": {"type": "plain_text", "text": "+1h", "emoji": True},
                "value": action_value("reschedule", plus_1h),
            }
        )
    if plus_1d:
        actions.append(
            {
                "type": "button",
                "action_id": "sns_review_reschedule_1d",
                "text": {"type": "plain_text", "text": "+1d", "emoji": True},
                "value": action_value("reschedule", plus_1d),
            }
        )

    blocks.append({"type": "actions", "elements": actions[:5]})
    return blocks


def select_candidates(
    posts: list[dict[str, Any]], horizon_hours: int, include_pending: bool
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    now = datetime.now(JST)
    end = now + timedelta(hours=max(horizon_hours, 1))
    allowed_status = {"ready"}
    if include_pending:
        allowed_status.add("pending")
    skip_stats: dict[str, int] = {
        "status_mismatch": 0,
        "already_posted_like": 0,
        "missing_or_invalid_scheduled_at": 0,
        "outside_window": 0,
        "duplicate_posted_content": 0,
    }
    candidates = []
    for post in posts:
        status = str(post.get("status") or "").lower()
        if status == "scheduled":
            status = "ready"
            post["status"] = "ready"
        if status not in allowed_status:
            skip_stats["status_mismatch"] += 1
            continue
        if is_posted_like(post):
            skip_stats["already_posted_like"] += 1
            continue
        scheduled = parse_scheduled_at(post.get("scheduled_at"))
        if not scheduled:
            skip_stats["missing_or_invalid_scheduled_at"] += 1
            continue
        if scheduled < now or scheduled > end:
            skip_stats["outside_window"] += 1
            continue
        if has_posted_duplicate(post, posts):
            skip_stats["duplicate_posted_content"] += 1
            continue
        candidates.append(post)
    candidates.sort(key=lambda p: parse_scheduled_at(p.get("scheduled_at")) or now)
    return candidates, skip_stats


def build_fulltext_payload(post: dict[str, Any]) -> tuple[str, bytes]:
    post_id = str(post.get("id") or "sns-review")
    source_raw = str(post.get("source_path") or "").strip()
    source_path = None
    if source_raw:
        source_path = Path(source_raw)
        if not source_path.is_absolute():
            source_path = ROOT / source_path

    body = str(post.get("body") or "").strip()
    if source_path and source_path.exists():
        text = source_path.read_text(encoding="utf-8", errors="ignore")
        _, parsed_body = parse_frontmatter(text)
        if parsed_body:
            body = parsed_body

    lines = [
        f"id: {post_id}",
        f"type: {post.get('type') or ''}",
        f"status: {post.get('status') or ''}",
        f"story_id: {post.get('story_id') or ''}",
        f"scheduled_at: {post.get('scheduled_at') or ''}",
        f"title: {post.get('title') or ''}",
        f"source_path: {source_raw}",
        "",
        body,
        "",
    ]
    filename = f"{post_id}.txt"
    return filename, "\n".join(lines).encode("utf-8")


def upload_fulltext_attachment(
    token: str,
    channel_id: str,
    thread_ts: str,
    post: dict[str, Any],
) -> tuple[bool, str]:
    filename, content = build_fulltext_payload(post)
    req_headers = {"Authorization": f"Bearer {token}"}

    resp = requests.post(
        "https://slack.com/api/files.getUploadURLExternal",
        headers=req_headers,
        data={"filename": filename, "length": str(len(content))},
        timeout=20,
    )
    data = resp.json() if resp.status_code == 200 else {}
    if not data.get("ok"):
        return False, str(data.get("error") or f"http_{resp.status_code}")

    upload_url = str(data.get("upload_url") or "")
    file_id = str(data.get("file_id") or "")
    if not upload_url or not file_id:
        return False, "missing_upload_url_or_file_id"

    upload_resp = requests.post(
        upload_url,
        data=content,
        headers={"Content-Type": "text/plain; charset=utf-8"},
        timeout=20,
    )
    if upload_resp.status_code not in (200, 201):
        return False, f"upload_http_{upload_resp.status_code}"

    complete_resp = requests.post(
        "https://slack.com/api/files.completeUploadExternal",
        headers=req_headers,
        data={
            "files": json.dumps([{"id": file_id, "title": f"Full Text {post.get('id') or ''}"}], ensure_ascii=False),
            "channel_id": channel_id,
            "thread_ts": thread_ts,
            "initial_comment": f"全文txtを添付します: `{post.get('id') or ''}`",
        },
        timeout=20,
    )
    complete = complete_resp.json() if complete_resp.status_code == 200 else {}
    if not complete.get("ok"):
        return False, str(complete.get("error") or f"http_{complete_resp.status_code}")
    return True, "ok"


def post_message(token: str, channel_id: str, post: dict[str, Any], dry_run: bool) -> tuple[bool, str]:
    if dry_run:
        return True, "dry-run"

    payload = {
        "channel": channel_id,
        "text": f"[SNS Review] {post.get('id')}",
        "blocks": build_blocks(post),
    }
    try:
        resp = requests.post(
            "https://slack.com/api/chat.postMessage",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"},
            json=payload,
            timeout=15,
        )
    except requests.RequestException as exc:
        return False, f"request_error:{exc}"
    if resp.status_code != 200:
        return False, f"http_{resp.status_code}"
    data = resp.json()
    if not data.get("ok"):
        return False, str(data.get("error") or "unknown_error")

    attach_enabled = os.getenv("SLACK_REVIEW_ATTACH_FULLTEXT", "true").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    ts = str(data.get("ts") or "")
    if attach_enabled and ts:
        ok, reason = upload_fulltext_attachment(token, channel_id, ts, post)
        if not ok:
            print(f"WARN fulltext attach failed: {post.get('id')} ({reason})", file=sys.stderr)
    return True, ts


def main() -> None:
    parser = argparse.ArgumentParser(description="Post scheduled SNS review cards to Slack")
    parser.add_argument("--schedule-file", default=str(SCHEDULE_PATH))
    parser.add_argument("--state-file", default=str(STATE_PATH))
    parser.add_argument("--channel-id", default=os.getenv("SLACK_SNS_REVIEW_CHANNEL_ID", os.getenv("SLACK_CHANNEL_ID", "")))
    parser.add_argument("--horizon-hours", type=int, default=36)
    parser.add_argument("--max-posts", type=int, default=10)
    parser.add_argument("--include-pending", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    token = os.getenv("SLACK_BOT_TOKEN", "").strip()
    if not args.channel_id and not args.dry_run:
        raise SystemExit("SLACK review channel is missing (--channel-id or SLACK_SNS_REVIEW_CHANNEL_ID)")
    if not token and not args.dry_run:
        raise SystemExit("SLACK_BOT_TOKEN is missing")

    posts = load_schedule(Path(args.schedule_file))
    state_path = Path(args.state_file)
    state = load_state(state_path)
    candidates, skip_reasons = select_candidates(posts, args.horizon_hours, args.include_pending)

    posted = 0
    skipped = 0
    failed = 0
    for post in candidates[: max(args.max_posts, 1)]:
        post_id = str(post.get("id") or "")
        fp = post_fingerprint(post)
        prev = state.get(post_id, {})
        if not args.force and isinstance(prev, dict) and prev.get("fingerprint") == fp:
            skipped += 1
            skip_reasons["same_fingerprint"] = skip_reasons.get("same_fingerprint", 0) + 1
            continue
        ok, result = post_message(token, args.channel_id, post, args.dry_run)
        if not ok:
            failed += 1
            print(f"ERROR post failed: {post_id} ({result})", file=sys.stderr)
            continue
        posted += 1
        state[post_id] = {
            "fingerprint": fp,
            "message_ts": result,
            "last_posted_at": datetime.now(JST).isoformat(timespec="seconds"),
        }

        if not args.dry_run:
            save_state(state_path, state)
    print(
        json.dumps(
            {
                "candidates": len(candidates),
                "posted": posted,
                "skipped": skipped,
                "failed": failed,
                "skip_reasons": {k: v for k, v in skip_reasons.items() if v > 0},
                "state_file": str(state_path),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
