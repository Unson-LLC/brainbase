#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path
import yaml

ROOT = Path.home() / "workspace/brainbase-config/_codex"
POST_DRAFT_DIR = ROOT / "sns/x/05_posts/draft"


def parse_frontmatter(text: str) -> tuple[dict, str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text.strip()
    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            fm = yaml.safe_load("\n".join(lines[1:idx])) or {}
            body = "\n".join(lines[idx + 1 :]).strip()
            return fm, body
    return {}, text.strip()


def first_nonempty_line(body: str) -> str:
    for line in body.splitlines():
        if line.strip():
            return line.strip()
    return ""


def infer_story_id(path: Path) -> str:
    stem = path.stem
    if stem.startswith("x_article_"):
        return stem.replace("x_article_", "", 1)
    return stem


def save_draft(source: Path, story_id: str | None = None) -> Path:
    text = source.read_text(encoding="utf-8", errors="ignore")
    fm, body = parse_frontmatter(text)
    story_id = story_id or fm.get("story_id") or infer_story_id(source)
    article_id = fm.get("id") or f"x_article_{story_id}"
    hook = fm.get("hook") or first_nonempty_line(body)

    POST_DRAFT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = POST_DRAFT_DIR / f"{article_id}.md"

    front = [
        "---",
        f"id: {article_id}",
        f"story_id: {story_id}",
        "story_stage: x_article",
        "type: x_article",
        "status: draft",
        f"source_path: {source}",
        f"hook: {hook}",
        "owner: ksato",
        "---",
        "",
    ]
    out_path.write_text("\n".join(front) + body + "\n", encoding="utf-8")
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Save X article draft to post queue")
    parser.add_argument("source", help="Source markdown path")
    parser.add_argument("--story-id", default="", help="Override story_id")
    args = parser.parse_args()

    source = Path(args.source)
    if not source.exists():
        raise SystemExit(f"source not found: {source}")
    out_path = save_draft(source, args.story_id or None)
    print(f"saved draft: {out_path}")


if __name__ == "__main__":
    main()
