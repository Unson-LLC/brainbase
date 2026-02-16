#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
from datetime import date
from pathlib import Path
from urllib.request import Request, urlopen


API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"


def load_env_key(env_path: Path) -> str:
    if not env_path.exists():
        return ""
    for line in env_path.read_text().splitlines():
        if not line or line.strip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == "ANTHROPIC_API_KEY":
            return value.strip().strip('"').strip("'")
    return ""


def parse_frontmatter(text: str):
    if not text.startswith("---"):
        return {}, text
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text
    fm_raw = parts[1]
    body = parts[2].lstrip("\n")
    fm = {}
    for line in fm_raw.splitlines():
        if not line.strip() or ":" not in line:
            continue
        k, v = line.split(":", 1)
        fm[k.strip()] = v.strip()
    return fm, body


def analyze_text(body: str):
    lines = [l for l in body.splitlines() if l.strip()]
    char_count = len(body.replace("\n", ""))
    line_count = len(lines)
    has_number = bool(re.search(r"\d", body))
    has_question = "?" in body or "？" in body
    cta_type = "none"
    if re.search(r"(コメント|教えて|どうしてる|意見|質問)", body):
        cta_type = "comment"
    elif re.search(r"(プロフィール|固定ポスト|リンク|note|詳細)", body):
        cta_type = "profile_or_link"
    elif has_question:
        cta_type = "question"
    return {
        "char_count": char_count,
        "line_count": line_count,
        "has_number": has_number,
        "has_question": has_question,
        "cta_type": cta_type,
    }


def call_anthropic(api_key: str, model: str, system: str, user: str, max_tokens: int = 700):
    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "temperature": 0.4,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    data = json.dumps(payload).encode("utf-8")
    headers = {
        "content-type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": ANTHROPIC_VERSION,
    }
    req = Request(API_URL, data=data, headers=headers, method="POST")
    with urlopen(req, timeout=120) as resp:
        raw = resp.read().decode("utf-8")
    obj = json.loads(raw)
    return obj["content"][0]["text"]


def extract_json(text: str):
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("no json block")
    return json.loads(text[start : end + 1])


def build_prompt(post_id: str, body: str, features: dict):
    system = (
        "You are a strict Japanese chief editor for X posts. "
        "Score content quality only. Be harsh about sameness, AI-smell, genericness, "
        "and forced CTA. 100 is extremely rare. Output must be in Japanese."
    )
    user = f"""
Post ID: {post_id}

Content:
{body}

Features:
- char_count: {features['char_count']}
- line_count: {features['line_count']}
- has_number: {features['has_number']}
- has_question: {features['has_question']}
- cta_type: {features['cta_type']}

Evaluation rules:
- The voice must feel like a real person (first-person "俺" viewpoint).
- Penalize if it reads like a template, or if structure/length feel copy-pasted.
- Penalize forced CTA or weak CTA that breaks logic.
- Penalize vague claims or self-important tone without evidence.
- Reward specificity, tension, and concrete experience.

Output JSON only, in Japanese:
{{
  "score": 0-100,
  "pass": true|false,  // pass if >=80 and publish-ready
  "diagnosis": ["short reason 1", "short reason 2"],
  "fix": ["actionable fix 1", "actionable fix 2"],
  "rewrite_hint": "one-line hint"
}}
"""
    return system, user.strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--date", default=str(date.today()))
    parser.add_argument("--model", default=os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001"))
    args = parser.parse_args()

    api_key = os.getenv("ANTHROPIC_API_KEY") or load_env_key(Path("/Users/ksato/workspace/.env"))
    if not api_key:
        print("Missing ANTHROPIC_API_KEY", file=sys.stderr)
        sys.exit(1)

    input_dir = Path(args.input_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    results = []
    for path in sorted(input_dir.glob("*.md")):
        text = path.read_text()
        fm, body = parse_frontmatter(text)
        post_id = fm.get("id", path.stem)
        body = body.strip()
        features = analyze_text(body)
        system, user = build_prompt(post_id, body, features)
        try:
            raw = call_anthropic(api_key, args.model, system, user)
            data = extract_json(raw)
            data["_raw"] = raw
        except Exception as e:
            data = {
                "score": 50,
                "pass": False,
                "diagnosis": [f"LLM review failed: {type(e).__name__}"],
                "fix": ["rerun review after fixing API error"],
                "rewrite_hint": "n/a",
                "_raw": "",
            }
        data["id"] = post_id
        results.append(data)

    md_path = out_dir / f"phase2_5_reviews_{args.date}_llm.md"
    tbl_path = out_dir / f"qc_quality_{args.date}_llm.md"

    lines = [f"# Phase 2.5 鬼編集長レビュー（LLM） {args.date}", "", f"- model: {args.model}", ""]
    for r in results:
        lines.append(f"## {r['id']}")
        lines.append("")
        lines.append(f"### スコア: {r['score']}点 / 100点")
        lines.append("")
        lines.append("### 判定")
        lines.append(f"- {'PASS' if r['pass'] else 'FAIL'}")
        lines.append("")
        lines.append("### 診断")
        for d in r.get("diagnosis", []):
            lines.append(f"- {d}")
        lines.append("")
        lines.append("### 修正指示")
        for f in r.get("fix", []):
            lines.append(f"- {f}")
        lines.append("")
        lines.append("### 1行ヒント")
        lines.append(r.get("rewrite_hint", ""))
        lines.append("")
    md_path.write_text("\n".join(lines))

    table = [
        f"# QC Quality LLM {args.date}",
        "",
        "| id | score | result | diagnosis |",
        "| --- | ---: | :---: | --- |",
    ]
    for r in results:
        diag = "; ".join(r.get("diagnosis", []))
        table.append(f"| {r['id']} | {r['score']} | {'PASS' if r['pass'] else 'FAIL'} | {diag} |")
    tbl_path.write_text("\n".join(table))


if __name__ == "__main__":
    main()
