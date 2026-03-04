#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
import yaml

load_dotenv("/Users/ksato/workspace/.env")

JST = ZoneInfo("Asia/Tokyo")
ROOT = Path("/Users/ksato/workspace/brainbase-config/_codex")
SEED_OUT_DIR = ROOT / "sns/x/04_ideas"
DRAFT_DIR = ROOT / "sns/drafts"
QC_DIR = ROOT / "sns/x/ops/qc"
SEED_FACTORY = ROOT / "sns/x/ops/scripts/seed_factory.py"
REVIEW_SUBAGENT = ROOT / "sns/x/ops/scripts/phase2_5_review_subagent.py"
SAVE_DRAFT_SCRIPT = ROOT / "sns/x/ops/scripts/x_article_save_draft.py"
WEB_DRAFT_SCRIPT = ROOT / "sns/x/ops/scripts/x_article_web_draft.py"
RUN_LEDGER_SCRIPT = ROOT / "common/ops/scripts/run_ledger.py"
SCHEDULE_PATH = ROOT / "sns/scheduled_posts.yml"

BASE_ALLOWED_NUMBERS = {"4", "100"}
MIN_CHARS = 1400
MAX_CHARS = 2200
MAX_LENGTH_RETRIES = 2
_CLAUDE_UNAVAILABLE = False
_CODEX_UNAVAILABLE = False


def dedupe_text(text: str) -> str:
    return "".join(str(text or "").split()).strip()


def similarity_ratio(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


@dataclass
class SeedItem:
    pillar_no: str
    sprout_id: str
    seed: str
    sprout: str
    tension_tag: str
    assumption: str
    process: list[str]


def run_cmd(cmd: list[str], timeout: int | None = None) -> str:
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "command failed")
    return result.stdout.strip()


def codex_timeout_for(claude_timeout: int) -> int:
    base = max(claude_timeout * 2, 180)
    override = os.environ.get("CODEX_MIN_TIMEOUT_SEC", "").strip()
    if override.isdigit():
        return max(base, int(override))
    return base


def run_codex(prompt: str, system_prompt: str, agent_name: str, timeout: int = 180) -> str:
    global _CODEX_UNAVAILABLE
    if _CODEX_UNAVAILABLE:
        raise RuntimeError("codex unavailable in this run")

    codex_bin = os.environ.get("CODEX_CLI_BIN", "codex")
    codex_model = os.environ.get("CODEX_MODEL", "").strip()
    fallback_models_env = os.environ.get("CODEX_FALLBACK_MODELS", "gpt-5.2-codex,gpt-5.1-codex")
    model_candidates = [m.strip() for m in fallback_models_env.split(",") if m.strip()]
    if codex_model:
        model_candidates = [codex_model] + model_candidates
    if not model_candidates:
        model_candidates = [""]

    full_prompt = (
        f"{system_prompt.strip()}\n\n"
        f"[Agent]\n{agent_name}\n\n"
        f"{prompt.strip()}\n\n"
        "厳守: 指示された出力形式だけを返す。"
    )
    per_attempt_timeout = timeout
    timeout_override = os.environ.get("CODEX_PER_ATTEMPT_TIMEOUT_SEC", "").strip()
    if timeout_override.isdigit():
        per_attempt_timeout = max(per_attempt_timeout, int(timeout_override))

    last_error = "codex execution failed"
    for model_name in model_candidates:
        with tempfile.NamedTemporaryFile(prefix="x_article_codex_", suffix=".txt", delete=False) as tmp:
            out_path = Path(tmp.name)
        cmd = [
            codex_bin,
            "exec",
            "--skip-git-repo-check",
            "-c",
            'model_reasoning_effort="high"',
            "-o",
            str(out_path),
        ]
        if model_name:
            cmd.extend(["-m", model_name])
        cmd.append(full_prompt)
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=per_attempt_timeout)
        except Exception as exc:
            last_error = f"codex failed ({model_name or 'default'}): {exc}"
            out_path.unlink(missing_ok=True)
            continue

        output = out_path.read_text(encoding="utf-8", errors="ignore").strip() if out_path.exists() else ""
        out_path.unlink(missing_ok=True)
        if result.returncode == 0 and output:
            return output
        last_error = result.stderr.strip() or result.stdout.strip() or f"codex failed ({model_name})"

    _CODEX_UNAVAILABLE = True
    raise RuntimeError(last_error)


def run_claude(prompt: str, system_prompt: str, timeout: int, agent_name: str = "x_article_writer") -> str:
    global _CLAUDE_UNAVAILABLE
    if _CLAUDE_UNAVAILABLE:
        return run_codex(prompt, system_prompt, agent_name, timeout=codex_timeout_for(timeout))

    claude_bin = os.environ.get("CLAUDE_CODE_BIN", "claude")
    model = os.environ.get("CLAUDE_CODE_MODEL")
    agents = {
        agent_name: {
            "description": agent_name,
            "prompt": system_prompt.strip(),
        }
    }
    cmd = [
        claude_bin,
        "-p",
        "--agent",
        agent_name,
        "--agents",
        json.dumps(agents, ensure_ascii=False),
        "--output-format",
        "text",
    ]
    if model:
        cmd.extend(["--model", model])
    cmd.append(prompt)
    try:
        return run_cmd(cmd, timeout=timeout)
    except Exception as exc:
        msg = str(exc).lower()
        if (
            "organization does not have access to claude" in msg
            or "please login again" in msg
            or "quota" in msg
            or "rate limit" in msg
            or "hit your limit" in msg
        ):
            _CLAUDE_UNAVAILABLE = True
        try:
            return run_codex(prompt, system_prompt, agent_name, timeout=codex_timeout_for(timeout))
        except Exception as codex_exc:
            raise RuntimeError(f"claude failed: {exc}; codex fallback failed: {codex_exc}") from codex_exc


def run_ledger_write(payload: dict) -> None:
    if not RUN_LEDGER_SCRIPT.exists():
        return
    try:
        cmd = [
            os.environ.get("PYTHON", "python3"),
            str(RUN_LEDGER_SCRIPT),
            "write",
            "--run-json",
            json.dumps(payload, ensure_ascii=False),
        ]
        subprocess.run(cmd, check=True, capture_output=True, text=True, env=os.environ.copy())
    except Exception as exc:
        print(f"[WARN] run_ledger write failed: {exc}")


def run_ledger_update(run_id: str, payload: dict) -> None:
    if not RUN_LEDGER_SCRIPT.exists():
        return
    try:
        cmd = [
            os.environ.get("PYTHON", "python3"),
            str(RUN_LEDGER_SCRIPT),
            "update",
            "--run-id",
            run_id,
            "--update-json",
            json.dumps(payload, ensure_ascii=False),
        ]
        subprocess.run(cmd, check=True, capture_output=True, text=True, env=os.environ.copy())
    except Exception as exc:
        print(f"[WARN] run_ledger update failed: {exc}")


def parse_seed_log(path: Path) -> list[SeedItem]:
    items: list[SeedItem] = []
    current: dict | None = None
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if line.startswith("## Pillar:"):
            if current:
                items.append(SeedItem(**current))
            current = {
                "pillar_no": re.search(r"pillar_no=([0-9]+)", line).group(1) if "pillar_no=" in line else "",
                "sprout_id": "",
                "seed": "",
                "sprout": "",
                "tension_tag": "contradiction",
                "assumption": "",
                "process": [],
            }
            continue
        if not current:
            continue
        if line.startswith("- sprout_id:"):
            current["sprout_id"] = line.split(":", 1)[1].strip()
        elif line.startswith("seed:"):
            current["seed"] = line.split(":", 1)[1].strip()
        elif line.startswith("sprout_selected:"):
            current["sprout"] = line.split(":", 1)[1].strip()
        elif line.startswith("tension_tag_editor:"):
            current["tension_tag"] = line.split(":", 1)[1].strip()
        elif line.startswith("assumption_editor:"):
            current["assumption"] = line.split(":", 1)[1].strip()
        elif line.startswith("- P-"):
            current["process"].append(line.lstrip("- ").strip())
    if current:
        items.append(SeedItem(**current))
    return [item for item in items if item.sprout]


def latest_seed_log(out_dir: Path) -> Path | None:
    logs = sorted(out_dir.glob("*_seed_sprout.md"), key=lambda p: p.stat().st_mtime, reverse=True)
    return logs[0] if logs else None


def load_schedule(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"posts": []}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {"posts": []}


def save_schedule(path: Path, data: dict[str, Any]) -> None:
    path.write_text(
        yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=1000),
        encoding="utf-8",
    )


def normalize_hhmm(value: str) -> str:
    val = (value or "").strip()
    if not val:
        return "12:30"
    if re.fullmatch(r"\d{2}:\d{2}", val):
        return val
    if re.fullmatch(r"\d{1,2}:\d{2}", val):
        h, m = val.split(":", 1)
        return f"{int(h):02d}:{m}"
    raise ValueError(f"invalid slot format: {value}")


def parse_schedule_slots(raw: str) -> list[str]:
    slots = []
    for token in str(raw or "").split(","):
        token = token.strip()
        if not token:
            continue
        slots.append(normalize_hhmm(token))
    return slots or ["12:30"]


def build_schedule_iso(date_str: str, hhmm: str) -> str:
    dt = datetime.fromisoformat(f"{date_str}T{normalize_hhmm(hhmm)}:00").replace(tzinfo=JST)
    return dt.isoformat()


def pick_schedule_slot(date_str: str, slots: list[str], used: set[str]) -> str:
    for slot in slots:
        iso = build_schedule_iso(date_str, slot)
        if iso not in used:
            used.add(iso)
            return iso
    # fallback: 30分ずつ後ろへずらす
    base = datetime.fromisoformat(build_schedule_iso(date_str, slots[-1]))
    while True:
        base = base + timedelta(minutes=30)
        iso = base.isoformat()
        if iso not in used:
            used.add(iso)
            return iso


def extract_title(body: str, fallback: str) -> str:
    for line in body.splitlines():
        text = line.strip()
        if text:
            return text[:80]
    return fallback[:80]


def is_duplicate_entry(
    posts: list[dict[str, Any]],
    title: str,
    body: str,
    source_path: str,
    *,
    skip_post_id: str | None = None,
) -> bool:
    title_norm = dedupe_text(title)
    body_norm = dedupe_text(body)
    source_norm = str(source_path or "").strip()
    for post in posts:
        if skip_post_id and str(post.get("id") or "") == skip_post_id:
            continue
        status = str(post.get("status") or "").lower()
        if status in {"skipped", "archived"}:
            continue
        if source_norm and str(post.get("source_path") or "").strip() == source_norm:
            return True
        title_sim = similarity_ratio(title_norm, dedupe_text(post.get("title") or ""))
        body_sim = similarity_ratio(body_norm, dedupe_text(post.get("body") or ""))
        if body_sim >= 0.97:
            return True
        if title_sim >= 0.98 and body_sim >= 0.9:
            return True
    return False


def score_seed_item(item: SeedItem) -> int:
    text = f"{item.seed} {item.sprout}"
    score = len(re.findall(r"\d", text)) * 2
    if "%" in text:
        score += 3
    if "円" in text:
        score += 3
    if "オフ" in text:
        score += 2
    if "離職" in text:
        score += 2
    return score


def extract_numbers(text: str) -> set[str]:
    cleaned = text.replace(",", "")
    return set(re.findall(r"\d+", cleaned))


def sanitize_numbers(body: str, allowed: set[str]) -> str:
    def repl(match: re.Match) -> str:
        num = match.group(0)
        return num if num in allowed else "数"
    return re.sub(r"\d+", repl, body)


def count_chars(text: str) -> int:
    return len(text.replace("\r\n", "\n"))


def build_prompt(item: SeedItem, allowed_numbers: list[str]) -> str:
    return f"""
seed: {item.seed}
sprout: {item.sprout}
assumption: {item.assumption}
process: {', '.join(item.process)}

制約:
- 俺視点で書く
- 一人称は必ず「俺」
- 事実の範囲だけで書く（捏造禁止）
- 数字は次だけ使用可: {', '.join(allowed_numbers) if allowed_numbers else '（数字は使わない）'}
- 文字数は{MIN_CHARS}〜{MAX_CHARS}文字（改行含む）。不足/超過は失格
- 文字数配分の目安:
  - 結論: 80〜140文字
  - 判断の背景: 400〜600文字
  - 具体例: 500〜700文字
  - 次の行動/問い: 200〜300文字
- 8〜14段落でテンポを作る
- 1段落1〜3行を目安にリズムを作る
- 1文はできるだけ短く（最大70文字目安）
- 抽象語（本質/重要/必要/最適など）の連続は禁止。抽象語を書いたら直後に具体を置く
- 読者がそのまま使える具体フォーマットを最低1つ入れる（例: 箇条書き3点、固定文テンプレ）
- 末尾に文字数メモや注釈は書かない
- 次の構成で書く
  1) 結論（1行）
  2) 判断の背景（2〜4段落）
  3) 具体例（最低1つ。processやseedの事実のみ）
  4) 次の行動 or 問いかけ

出力: 本文のみ（markdown可）。
""".strip()


def build_length_prompt(body: str, item: SeedItem, allowed_numbers: list[str], current_chars: int) -> str:
    target_range = f"{MIN_CHARS}〜{MAX_CHARS}"
    if current_chars < MIN_CHARS:
        action = "文字数が不足しています。既存の事実内で、具体の体験・判断・行動描写を厚くして膨らませてください。"
    else:
        action = "文字数が超過しています。重複や説明を削って圧縮してください。"
    return f"""
seed: {item.seed}
sprout: {item.sprout}
assumption: {item.assumption}
process: {', '.join(item.process)}

制約:
- 俺視点で書く
- 一人称は必ず「俺」
- 事実の範囲だけで書く（捏造禁止）
- 新しい事実や具体例の追加は禁止（既存事実の描写を厚くするのは可）
- 数字は次だけ使用可: {', '.join(allowed_numbers) if allowed_numbers else '（数字は使わない）'}
- 文字数は{target_range}文字（改行含む）に必ず収める
- 末尾に文字数メモや注釈は書かない
- 説明調の連続は削り、温度差は残す
- 前置き・注釈・説明文は禁止
- 1文は短く保つ（最大70文字目安）
- 抽象語の反復を削除し、各段落に最低1つの具体動詞を入れる
- 読者が使える具体フォーマット（箇条書き or 固定文）を1つ以上残す

調整方針:
{action}

現状本文（{current_chars}文字）:
{body}

出力: 修正後の本文のみ。
""".strip()


def ensure_length(body: str, item: SeedItem, allowed_numbers: list[str], timeout: int) -> str:
    allowed_set = set(allowed_numbers)
    body = body.strip()
    for _ in range(MAX_LENGTH_RETRIES + 1):
        current_chars = count_chars(body)
        if MIN_CHARS <= current_chars <= MAX_CHARS:
            return body
        prompt = build_length_prompt(body, item, allowed_numbers, current_chars)
        system_prompt = "あなたはX記事の編集者。文字数と事実制約を厳守する。"
        body = run_claude(prompt, system_prompt, timeout).strip()
        body = sanitize_numbers(body, allowed_set)
    return body


def build_local_article(item: SeedItem) -> str:
    title = item.sprout.split("、")[0].strip() or item.sprout[:40]
    process_items = [p.lstrip("- ").strip() for p in item.process if p.strip()]
    if not process_items:
        process_items = ["最初に、観測条件を揃える", "次に、判断軸を固定する"]

    lines = [
        f"{title}",
        "",
        "俺の現場では、ここまで曖昧な状態で進むと、判断の遅れは避けられない。",
        "",
        "今回の結論はシンプルだ。",
        "",
        "1) Seed",
        f"   {item.seed}",
        "",
        "2) どう進めるか",
        f"   {item.assumption}",
        "",
        "3) 実際の固定手順",
    ]
    for idx, proc in enumerate(process_items, 1):
        lines.append(f"   - {idx}. {proc}")
        lines.append("     まず、条件を言語化する。対象・判定・完了条件を1行にする。")
        lines.append("     次に、誰が見ても同じ観点で判断できるよう、検証順を固定する。")
        lines.append("     最後に、例外処理を先に決める。")
    lines.extend(
        [
            "",
            "この方式を回すと、だいたい次が消える。",
            "・「あとで詰める」を繰り返す状態",
            "・完了の言葉がバラバラで止まる状態",
            "・再現手順がその場しのぎになる状態",
            "",
            "だから、先に言葉を固定してから、実行する。",
            "",
            "1) 依頼: 対象 / 期限 / 担当 / 何を見てほしいか",
            "2) チェック: 観点 / 判定 / 判定理由",
            "3) 完了: 判定結果 / 修正内容 / 次アクション",
            "",
            "これを先に決めるだけで、運用が会話ベースから仕様ベースになる。",
            "会議での再確認より、記録で再現できる状態を先に作るのが早い。",
        ]
    )
    return "\n".join(lines) + "\n"


def ensure_local_length(body: str) -> str:
    text = body.strip()
    if len(text) > MAX_CHARS:
        text = text[:MAX_CHARS].strip()
    while len(text) < MIN_CHARS:
        text += (
            "\n"
            "この判断順は、条件を先に固定しないと崩れる。"
            "「直感で進める」ではなく、次に何を見ればOKかを先に決める。"
        )
    return text.strip()


def write_draft(path: Path, story_id: str, item: SeedItem, body: str) -> None:
    front = [
        "---",
        f"id: x_article_{story_id}",
        f"story_id: {story_id}",
        "type: x_article",
        "status: draft",
        f"pillar_no: {item.pillar_no}",
        f"sprout_id: {item.sprout_id}",
        f"seed: {item.seed}",
        f"sprout: {item.sprout}",
        "---",
        "",
    ]
    path.write_text("\n".join(front) + body.strip() + "\n", encoding="utf-8")


def read_frontmatter(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8", errors="ignore")
    if not text.startswith("---"):
        return {}
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}
    fm_raw = parts[1]
    frontmatter: dict[str, str] = {}
    for line in fm_raw.splitlines():
        if not line.strip() or ":" not in line:
            continue
        key, value = line.split(":", 1)
        frontmatter[key.strip()] = value.strip()
    return frontmatter


def draft_id_from_path(path: Path) -> str:
    fm = read_frontmatter(path)
    return fm.get("id", path.stem)


def read_review_result(path: Path, date_tag: str) -> dict[str, Any]:
    payload_id = draft_id_from_path(path)
    report_path = QC_DIR / f"phase2_5_reviews_{date_tag}_subagent.json"
    if not report_path.exists():
        return {}
    try:
        data = json.loads(report_path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"WARN: invalid review report ({payload_id}): {exc}")
        return {}
    if isinstance(data, dict):
        data = [data]
    for item in data:
        if item.get("id") == payload_id:
            return item
    return {}


def rewrite_with_fix(item: SeedItem, body: str, fixes: list[str], timeout: int, allowed_numbers: list[str]) -> str:
    fix_block = "\n".join(f"- {f}" for f in fixes) if fixes else "- 具体の体験が刺さるように修正する"
    allowed = ", ".join(allowed_numbers) if allowed_numbers else "（数字は使わない）"
    prompt = f"""
seed: {item.seed}
sprout: {item.sprout}
assumption: {item.assumption}
process: {', '.join(item.process)}

修正指示:
{fix_block}

制約:
- 本文全体を以下の修正指示に合わせて書き換える（追加の捏造NG）
- 一人称は必ず「俺」
- 一人称視点を崩さず、読者が話に入れる具体を最低1箇所追加
- 数字は次だけ使用可: {allowed}
- 文字数は{MIN_CHARS}〜{MAX_CHARS}文字（改行含む）
- 末尾にメモや注釈は書かない
- 抽象語だけで終わらないよう、各パートに行動描写を入れる
- 1文は短めに保つ（最大70文字目安）

出力: 本文のみ
""".strip()
    system_prompt = "あなたはX記事の鬼編集長リライト担当。編集指示を反映して再執筆する。"
    try:
        rewritten = run_claude(prompt, system_prompt, timeout, agent_name="x_article_rewriter").strip()
        rewritten = sanitize_numbers(rewritten, set(allowed_numbers))
        rewritten = ensure_length(rewritten, item, allowed_numbers, timeout)
        return rewritten
    except Exception as exc:
        print(f"WARN: rewrite_with_fix fallback to local template: {exc}")
        return ensure_local_length(build_local_article(item))


def review_article(path: Path, date_tag: str) -> None:
    cmd = [
        os.environ.get("PYTHON", "python3"),
        str(REVIEW_SUBAGENT),
        "--input-dir",
        str(path.parent),
        "--out-dir",
        str(QC_DIR),
        "--date",
        date_tag,
        "--pattern",
        path.name,
    ]
    try:
        run_cmd(cmd, timeout=120)
    except Exception as exc:
        print(f"WARN: review step skipped due to error: {exc}")


def run_review(path: Path, date_tag: str) -> dict[str, Any]:
    review_article(path, date_tag)
    return read_review_result(path, date_tag)


def enqueue_schedule_entry(
    schedule_data: dict[str, Any],
    story_id: str,
    title: str,
    body: str,
    source_path: Path,
    scheduled_at: str,
) -> tuple[bool, str]:
    posts = schedule_data.setdefault("posts", [])
    source_rel = str(source_path.relative_to(ROOT))
    post_id = f"xart-{story_id.replace('story-', '')}"
    if is_duplicate_entry(posts, title, body, source_rel, skip_post_id=post_id):
        return False, "duplicate"

    for post in posts:
        if str(post.get("id") or "") == post_id:
            post.update(
                {
                    "story_id": story_id,
                    "story_stage": "x_article",
                    "scheduled_at": scheduled_at,
                    "type": "x_article",
                    "title": title,
                    "body": body,
                    "image": "",
                    "source_path": source_rel,
                    "sns_smart_completed": True,
                    "status": "ready" if scheduled_at else "pending",
                }
            )
            return True, post_id

    posts.append(
        {
            "id": post_id,
            "story_id": story_id,
            "story_stage": "x_article",
            "scheduled_at": scheduled_at,
            "type": "x_article",
            "title": title,
            "body": body,
            "image": "",
            "source_path": source_rel,
            "sns_smart_completed": True,
            "status": "ready" if scheduled_at else "pending",
        }
    )
    return True, post_id


def main() -> None:
    parser = argparse.ArgumentParser(description="X Article Line")
    parser.add_argument("--date", default=datetime.now(JST).strftime("%Y-%m-%d"))
    parser.add_argument("--seed-file", default="")
    parser.add_argument("--count", type=int, default=1)
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--mode", default="auto")
    parser.add_argument("--llm-timeout", type=int, default=90)
    parser.add_argument("--skip-review", action="store_true")
    parser.add_argument("--save-draft", action="store_true", help="save to X article draft queue")
    parser.add_argument("--x-web-draft", action="store_true", help="save draft on x.com via browser")
    parser.add_argument("--x-web-publish", action="store_true", help="publish on x.com via browser")
    parser.add_argument("--enqueue-schedule", action="store_true", help="append generated article to scheduled_posts.yml")
    parser.add_argument("--schedule-file", default=str(SCHEDULE_PATH))
    parser.add_argument("--schedule-slots", default="12:30", help="JST slots (HH:MM,comma)")
    args = parser.parse_args()

    DRAFT_DIR.mkdir(parents=True, exist_ok=True)
    QC_DIR.mkdir(parents=True, exist_ok=True)
    SEED_OUT_DIR.mkdir(parents=True, exist_ok=True)

    seed_file = Path(args.seed_file) if args.seed_file else None
    if not seed_file:
        cmd = [
            os.environ.get("PYTHON", "python3"),
            str(SEED_FACTORY),
            "--out-dir",
            str(SEED_OUT_DIR),
            "--days",
            str(args.days),
            "--count",
            str(max(args.count, 3)),
            "--mode",
            args.mode,
            "--llm-timeout",
            str(args.llm_timeout),
            "--max-files",
            "6",
        ]
        run_cmd(cmd, timeout=args.llm_timeout + 60)
        seed_file = SEED_OUT_DIR / f"{args.date}_seed_sprout.md"
    if not seed_file.exists():
        seed_file = latest_seed_log(SEED_OUT_DIR)
    if not seed_file:
        raise SystemExit("seed log not found")

    items = parse_seed_log(seed_file)
    if not items:
        raise SystemExit("no seeds found")

    items = sorted(items, key=score_seed_item, reverse=True)[: args.count]
    schedule_changed = False
    schedule_data = {"posts": []}
    used_schedule_times: set[str] = set()
    schedule_slots = parse_schedule_slots(args.schedule_slots)
    if args.enqueue_schedule:
        schedule_data = load_schedule(Path(args.schedule_file))
    if args.x_web_draft or args.x_web_publish:
        args.save_draft = True
    for idx, item in enumerate(items, 1):
        story_id = f"story-{args.date.replace('-', '')}-xart-{idx:03d}"
        filename = f"x_article_{story_id}.md"
        path = DRAFT_DIR / filename
        post_id = f"xart-{story_id.replace('story-', '')}"
        current_scheduled_at = ""
        if args.enqueue_schedule:
            current_scheduled_at = ""
            for post in schedule_data.get("posts", []):
                if str(post.get("id") or "") == post_id:
                    current_scheduled_at = str(post.get("scheduled_at") or "").strip()
                else:
                    scheduled_at = str(post.get("scheduled_at") or "").strip()
                    if scheduled_at:
                        used_schedule_times.add(scheduled_at)
            if current_scheduled_at:
                used_schedule_times.discard(current_scheduled_at)
        run_id = f"x_article_{story_id}"
        run_ledger_write(
            {
                "run_id": run_id,
                "pipeline": "x-article-line",
                "phase": "seed",
                "status": "running",
                "input_refs": [str(seed_file)],
                "output_refs": [],
                "started_at": datetime.now(JST).isoformat(),
            }
        )

        try:
            allowed_numbers = sorted(BASE_ALLOWED_NUMBERS | extract_numbers(f"{item.seed} {item.sprout}"))
            prompt = build_prompt(item, allowed_numbers)
            system_prompt = "あなたはX記事の執筆者。事実ベースで書く。"
            generation_note = ""
            try:
                body = run_claude(prompt, system_prompt, args.llm_timeout)
                body = sanitize_numbers(body, set(allowed_numbers))
                body = ensure_length(body, item, allowed_numbers, args.llm_timeout)
            except Exception as llm_exc:
                generation_note = f"local_fallback: {str(llm_exc)[:180]}"
                print(f"WARN: x-article generation fallback to local template ({llm_exc})")
                body = build_local_article(item)
                body = sanitize_numbers(body, set(allowed_numbers))
                body = ensure_local_length(body)

            write_draft(path, story_id, item, body)
            run_ledger_update(
                run_id,
                {
                    "phase": "draft",
                    "status": "running",
                    "output_refs": [str(path)],
                },
            )
            if generation_note:
                run_ledger_update(
                    run_id,
                    {
                        "phase": "draft",
                        "status": "review",
                        "notes": generation_note,
                    },
                )

            if not args.skip_review:
                review_tag = f"{args.date}-x-article-{story_id}"
                review_result: dict[str, Any] = {}
                review_passed = False
                for attempt in range(2):
                    tag = review_tag if attempt == 0 else f"{review_tag}-retry"
                    review_result = run_review(path, tag)
                    if review_result.get("pass"):
                        review_passed = True
                        break
                    if attempt == 0:
                        fixes = review_result.get("fix", [])
                        if not isinstance(fixes, list):
                            fixes = [str(fixes)]
                        body = rewrite_with_fix(
                            item,
                            body,
                            fixes or ["読者が入る具体描写を増やす"],
                            args.llm_timeout,
                            allowed_numbers,
                        )
                        write_draft(path, story_id, item, body)
                        run_ledger_update(
                            run_id,
                            {
                                "phase": "draft",
                                "status": "review",
                                "output_refs": [str(path)],
                                "notes": "rewrite_after_review_fail",
                            },
                        )
                        continue
                if not review_passed:
                    run_ledger_update(
                        run_id,
                        {
                            "phase": "review",
                            "status": "failed",
                            "decision": "reject",
                            "notes": f"review_fail:{review_result.get('notes', 'failed')}",
                        },
                    )
                    continue

                run_ledger_update(
                    run_id,
                    {
                        "phase": "review",
                        "status": "review",
                    },
                )

            if args.save_draft:
                cmd = [
                    os.environ.get("PYTHON", "python3"),
                    str(SAVE_DRAFT_SCRIPT),
                    str(path),
                    "--story-id",
                    story_id,
                ]
                run_cmd(cmd, timeout=60)
                run_ledger_update(
                    run_id,
                    {
                        "phase": "queue",
                        "status": "approved",
                        "decision": "approve",
                    },
                )

            if args.x_web_publish:
                cmd = [
                    os.environ.get("PYTHON", "python3"),
                    str(WEB_DRAFT_SCRIPT),
                    str(path),
                    "--publish",
                ]
                run_cmd(cmd, timeout=300)
                run_ledger_update(
                    run_id,
                    {
                        "phase": "ship",
                        "status": "shipped",
                        "decision": "approve",
                    },
                )
            elif args.x_web_draft:
                cmd = [
                    os.environ.get("PYTHON", "python3"),
                    str(WEB_DRAFT_SCRIPT),
                    str(path),
                ]
                run_cmd(cmd, timeout=300)
                run_ledger_update(
                    run_id,
                    {
                        "phase": "queue",
                        "status": "review",
                        "decision": "hold",
                    },
                )
            if args.enqueue_schedule:
                slot = (
                    current_scheduled_at
                    if current_scheduled_at
                    else pick_schedule_slot(args.date, schedule_slots, used_schedule_times)
                )
                title = extract_title(body, item.sprout)
                changed, post_id = enqueue_schedule_entry(
                    schedule_data=schedule_data,
                    story_id=story_id,
                    title=title,
                    body=body,
                    source_path=path,
                    scheduled_at=slot,
                )
                if changed:
                    schedule_changed = True
                    run_ledger_update(
                        run_id,
                        {
                            "phase": "queue",
                            "status": "approved",
                            "decision": "approve",
                            "notes": f"enqueued:{post_id} at {slot}",
                        },
                    )
                else:
                    run_ledger_update(
                        run_id,
                        {
                            "phase": "queue",
                            "status": "review",
                            "decision": "hold",
                            "reason": "duplicate_entry",
                        },
                    )
            print(f"generated: {path}")
        except Exception as exc:
            run_ledger_update(
                run_id,
                {
                    "phase": "ship",
                    "status": "failed",
                    "reason": str(exc),
                },
            )
            raise

    if args.enqueue_schedule and schedule_changed:
        save_schedule(Path(args.schedule_file), schedule_data)
        print(f"schedule updated: {args.schedule_file}")


if __name__ == "__main__":
    main()
