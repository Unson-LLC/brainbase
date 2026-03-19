#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import random
import re
import signal
import shutil
import subprocess
import sys
import tempfile
from dotenv import load_dotenv
from dataclasses import dataclass
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
import yaml

try:
    from dispatch_logs import ensure_note_log, upsert_dispatch_entry
except Exception:
    def ensure_note_log() -> None:
        return None

    def upsert_dispatch_entry(**_: str) -> None:
        return None


load_dotenv(Path.home() / "workspace/.env")
JST = ZoneInfo("Asia/Tokyo")

ROOT = Path.home() / "workspace/brainbase-config/_codex"
SEED_OUT_DIR = ROOT / "sns/x/04_ideas"
POSTS_DIR = ROOT / "sns/x/05_posts"
POSTS_DRAFT_DIR = POSTS_DIR / "draft"
POSTS_REVIEW_DIR = POSTS_DIR / "review"
POSTS_SCHEDULED_DIR = POSTS_DIR / "scheduled"
QC_DIR = ROOT / "sns/x/ops/qc"
LOG_DIR = ROOT / "sns/x/ops/logs"
SEED_LOG_DIR = ROOT / "sns/log"
SCHEDULE_PATH = ROOT / "sns/scheduled_posts.yml"
NANO_BANANA = ROOT / "common/ops/scripts/nano_banana.py"
SEED_FACTORY = ROOT / "sns/x/ops/scripts/seed_factory.py"
REVIEW_SUBAGENT = ROOT / "sns/x/ops/scripts/phase2_5_review_subagent.py"


TEMPLATES_ALL = [
    "infographic",
    "exploded",
    "dashboard",
    "framework",
    "progress",
    "incident",
    "poll",
    "recovery",
    "confession",
    "mystery",
    "gap",
    "isometric",
    "graphrec",
    "whiteboard",
    "character",
]

FORBIDDEN_WORDS = [
    "Next.js",
    "Rails",
    "BigQuery",
    "CRM",
    "SaaS",
    "受託",
    "コンサル",
]

ABSTRACT_WORDS = [
    "戦略",
    "勝率",
    "本質",
    "重要",
    "必要",
    "最強",
    "最適解",
    "教訓",
    "学び",
]

BASE_ALLOWED_NUMBERS = {"4", "100"}

CTA_OPTIONS = [
    "コメントで教えて",
    "どうしてるか教えて",
    "固定ポスト見てほしい",
    "プロフィールから見てほしい",
    "保存しておいて",
    "同じ経験ある？",
    "これ、どう思う？",
]

BLOCKED_KEYWORDS: list[str] = []

BLOCK_TOPIC_GUIDE = """
あなたは出荷ブロッカー。
判定対象が「SNS自動化・SNS運用自動化・SNS投稿自動化・X自動化・自動投稿・投稿スケジューラ・
返信/分析/予約の自動化ツール・SNS運用の自動最適化」に該当する場合は blocked = true。
SNSとは無関係な自動化や、SNS運用以外の話題は blocked = false。
迷ったら blocked = true を返す。
""".strip()

CLAUDE_TOKEN_URL = os.environ.get("CLAUDE_TOKEN_URL", "https://console.anthropic.com/v1/oauth/token")
CLAUDE_CLIENT_ID = os.environ.get("CLAUDE_CLIENT_ID", "9d1c250a-e61b-44d9-88ed-5944d1962f5e")
_TOKEN_REFRESHED = False
_CLAUDE_UNAVAILABLE = False
_CODEX_UNAVAILABLE = False


@dataclass
class SeedItem:
    pillar_no: str
    sprout_id: str
    seed: str
    sprout: str
    tension_tag: str
    assumption: str
    process: list[str]


def lane_for_tension(tension_tag: str) -> str:
    tag = (tension_tag or "").lower()
    if tag == "contradiction":
        return "A"
    if tag == "surprise":
        return "C"
    if tag == "anxiety":
        return "D"
    return "B"


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def run_cmd(cmd: list[str], env: dict | None = None, timeout: int | None = None) -> str:
    result = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "command failed")
    return result.stdout.strip()


def run_cmd_kill_group_on_timeout(cmd: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    try:
        stdout, stderr = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except Exception:
            pass
        try:
            stdout, stderr = proc.communicate(timeout=5)
        except Exception:
            stdout = exc.stdout or ""
            stderr = exc.stderr or ""
        raise subprocess.TimeoutExpired(cmd, timeout, output=stdout, stderr=stderr) from exc

    return subprocess.CompletedProcess(cmd, proc.returncode, stdout, stderr)


def ensure_claude_oauth_token() -> None:
    global _TOKEN_REFRESHED
    if os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        return
    if _TOKEN_REFRESHED:
        return
    refresh_token = os.environ.get("CLAUDE_REFRESH_TOKEN")
    if not refresh_token:
        raise RuntimeError("CLAUDE_REFRESH_TOKEN is missing. Set it in ~/workspace/.env")
    payload = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": CLAUDE_CLIENT_ID,
    }
    resp = requests.post(CLAUDE_TOKEN_URL, json=payload, timeout=10)
    if resp.status_code != 200:
        raise RuntimeError(f"Claude token refresh failed: {resp.status_code} {resp.text[:200]}")
    data = resp.json()
    access_token = data.get("access_token")
    if not access_token:
        raise RuntimeError("Claude token refresh did not return access_token")
    os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = access_token
    _TOKEN_REFRESHED = True


def codex_timeout_for(claude_timeout: int) -> int:
    base = max(claude_timeout * 2, 180)
    env_override = os.environ.get("CODEX_MIN_TIMEOUT_SEC", "").strip()
    if env_override.isdigit():
        return max(base, int(env_override))
    return base


def run_claude(prompt: str, system_prompt: str, agent_name: str, timeout: int = 60) -> str:
    global _CLAUDE_UNAVAILABLE
    if _CLAUDE_UNAVAILABLE:
        return run_codex(prompt, system_prompt, agent_name, timeout=codex_timeout_for(timeout))
    ensure_claude_oauth_token()
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
        if "hit your limit" in msg or "quota" in msg or "rate limit" in msg or "resets" in msg:
            _CLAUDE_UNAVAILABLE = True
        try:
            return run_codex(prompt, system_prompt, agent_name, timeout=codex_timeout_for(timeout))
        except Exception as codex_exc:
            raise RuntimeError(f"claude failed: {exc}; codex fallback failed: {codex_exc}") from codex_exc


def run_codex(prompt: str, system_prompt: str, agent_name: str, timeout: int = 120) -> str:
    global _CODEX_UNAVAILABLE
    if _CODEX_UNAVAILABLE:
        raise RuntimeError("Codex unavailable in this run")

    codex_bin = os.environ.get("CODEX_CLI_BIN", "codex")
    codex_model = os.environ.get("CODEX_MODEL", "").strip()
    fallback_models_env = os.environ.get("CODEX_FALLBACK_MODELS", "gpt-5.2-codex,gpt-5.1-codex")
    fallback_models = [m.strip() for m in fallback_models_env.split(",") if m.strip()]

    model_candidates: list[str | None] = []
    if codex_model:
        model_candidates.append(codex_model)
    model_candidates.extend(fallback_models)
    if not model_candidates:
        model_candidates = [None]

    full_prompt = (
        f"{system_prompt.strip()}\n\n"
        f"[Agent]\n{agent_name}\n\n"
        f"{prompt.strip()}\n\n"
        "厳守: 指示された出力形式のみを返す。"
    )
    timeout_override = os.environ.get("CODEX_PER_ATTEMPT_TIMEOUT_SEC", "").strip()
    if timeout_override.isdigit():
        per_attempt_timeout = int(timeout_override)
    else:
        per_attempt_timeout = max(timeout, 120)
    last_error = "codex command failed"

    for model_name in model_candidates:
        with tempfile.NamedTemporaryFile(prefix="factory_line_codex_", suffix=".txt", delete=False) as tmp:
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
            result = run_cmd_kill_group_on_timeout(cmd, per_attempt_timeout)
        except Exception as exc:
            last_error = f"codex execution failed ({model_name or 'default'}): {exc}"
            try:
                out_path.unlink(missing_ok=True)
            except Exception:
                pass
            continue

        output = ""
        try:
            if out_path.exists():
                output = out_path.read_text(encoding="utf-8", errors="ignore").strip()
        finally:
            try:
                out_path.unlink(missing_ok=True)
            except Exception:
                pass

        if result.returncode == 0 and output:
            return output
        msg = result.stderr.strip() or result.stdout.strip() or "codex command failed"
        last_error = f"{model_name or 'default'}: {msg}"

    _CODEX_UNAVAILABLE = True
    raise RuntimeError(last_error)


def extract_json(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```\\w*\\n?", "", cleaned)
        cleaned = re.sub(r"\\n?```$", "", cleaned)
    start_obj = cleaned.find("{")
    end_obj = cleaned.rfind("}")
    if start_obj == -1 or end_obj == -1 or end_obj <= start_obj:
        raise ValueError("no json block")
    return json.loads(cleaned[start_obj : end_obj + 1])


def ensure_dirs() -> None:
    for path in [POSTS_DRAFT_DIR, POSTS_REVIEW_DIR, POSTS_SCHEDULED_DIR, QC_DIR, LOG_DIR, SEED_LOG_DIR]:
        path.mkdir(parents=True, exist_ok=True)


def default_meeting_roots() -> list[Path]:
    base = Path.home() / "workspace/projects"
    if not base.exists():
        return [base]
    roots = [p for p in base.glob("*/meetings") if p.is_dir()]
    return roots or [base]


def parse_seed_log(path: Path) -> list[SeedItem]:
    items: list[SeedItem] = []
    current: dict | None = None
    for raw in read_text(path).splitlines():
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


def normalize_keywords(raw: str) -> list[str]:
    if not raw:
        return []
    return [k.strip() for k in raw.split(",") if k.strip()]


def is_blocked_seed(item: SeedItem, blocked_keywords: list[str], blocked_pillars: set[str]) -> bool:
    if item.pillar_no and item.pillar_no in blocked_pillars:
        return True
    text = f"{item.seed} {item.sprout}"
    return any(keyword in text for keyword in blocked_keywords)


def is_blocked_seed_llm(item: SeedItem) -> tuple[bool, str]:
    prompt = f"""
seed: {item.seed}
sprout: {item.sprout}
assumption: {item.assumption}

判断: このseedがSNS自動化系か？（SNS自動化/自動投稿/X自動化/運用自動化/分析自動化/予約投稿）
出力はJSONのみ。
{{"blocked": true/false, "reason": "..."}}
"""
    system_prompt = BLOCK_TOPIC_GUIDE
    try:
        raw = run_claude(prompt.strip(), system_prompt, "block_guard", timeout=30)
        data = extract_json(raw)
        blocked = bool(data.get("blocked", False))
        reason = str(data.get("reason", "")).strip() or ("blocked" if blocked else "allowed")
        return blocked, reason
    except Exception:
        # Fail-open so transient LLM issues do not drop important topics.
        return False, "llm_error_allow"


def next_post_id(base_date: str) -> str:
    existing = []
    for folder in [POSTS_DRAFT_DIR, POSTS_REVIEW_DIR, POSTS_SCHEDULED_DIR]:
        for path in folder.glob("x-*.md"):
            match = re.search(r"x-(\d{8})-(\d{3})", path.stem)
            if match and match.group(1) == base_date:
                existing.append(int(match.group(2)))
    seq = max(existing) + 1 if existing else 1
    return f"x-{base_date}-{seq:03d}"


def story_id_for(post_id: str) -> str:
    match = re.search(r"x-(\d{8})-(\d{3})", post_id)
    if not match:
        return f"story-{datetime.now(JST).strftime('%Y%m%d')}-000"
    return f"story-{match.group(1)}-{match.group(2)}"


def load_voice_context() -> str:
    profile = read_text(ROOT / "sns/x_account_profile.md")
    rules = read_text(ROOT / "sns/style_guide.md")
    excerpt = "\n".join(profile.splitlines()[:80])
    rules_excerpt = "\n".join(rules.splitlines()[:80])
    return f"{excerpt}\n\n{rules_excerpt}"


def normalize_body(text: str) -> str:
    body = text.strip()
    body = re.sub(r"```\\w*\\n?", "", body)
    body = body.replace("```", "")
    lines = []
    for raw in body.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("修正案") or line.startswith("変更点") or line.startswith("修正点"):
            continue
        if line.startswith("**") or line.endswith("**"):
            line = line.strip("*")
        if line.startswith("#"):
            continue
        line = re.sub(r"^[\\-•・]\\s*", "", line)
        line = line.replace("。", "")
        lines.append(line)
    return "\n\n".join(lines)


def dedupe_text(text: str) -> str:
    return re.sub(r"\s+", "", str(text or "")).strip()


def similarity_ratio(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def find_duplicate_in_schedule(posts: list[dict], title: str, body: str) -> tuple[str, str] | None:
    title_norm = dedupe_text(title)
    body_norm = dedupe_text(normalize_body(body))
    if not title_norm or not body_norm:
        return None

    for existing in posts:
        existing_id = str(existing.get("id") or "").strip()
        if not existing_id:
            continue
        status = str(existing.get("status") or "").lower()
        if status in {"skipped", "archived"}:
            continue
        existing_title = dedupe_text(existing.get("title") or "")
        existing_body = dedupe_text(normalize_body(existing.get("body") or ""))
        title_sim = similarity_ratio(title_norm, existing_title)
        body_sim = similarity_ratio(body_norm, existing_body)
        if body_sim >= 0.97:
            return existing_id, f"body_sim={body_sim:.3f}"
        if title_sim >= 0.98 and body_sim >= 0.90:
            return existing_id, f"title_sim={title_sim:.3f},body_sim={body_sim:.3f}"
    return None


def extract_body_from_file(path: Path) -> str:
    text = read_text(path)
    if text.startswith("---") and text.count("---") >= 2:
        parts = text.split("---", 2)
        if len(parts) >= 3:
            return parts[2].strip()
    return text.strip()


def validate_body(body: str, tension_tag: str, allowed_numbers: set[str], strict_word_guard: bool = False) -> bool:
    if strict_word_guard:
        for word in FORBIDDEN_WORDS:
            if word in body:
                return False
        abstract_hits = sum(1 for word in ABSTRACT_WORDS if word in body)
        if abstract_hits >= 2:
            return False
    numbers = re.findall(r"\d+", body)
    if len(numbers) < 2:
        return False
    for n in numbers:
        if n not in allowed_numbers:
            return False
    if tension_tag == "contradiction":
        if not any(word in body for word in ["でも", "のに", "逆", "裏切"]):
            return False
    return True


def generate_draft(seed: SeedItem, voice_context: str, strict: bool = False) -> str:
    use_cta = random.choice([True, False, False])
    cta = random.choice(CTA_OPTIONS) if use_cta else ""
    target_chars = random.choice([120, 160, 200, 240])
    line_count = random.choice([4, 5, 6, 7])
    if "原価" in seed.seed and "利益" in seed.seed:
        manual = "\n".join(
            [
                "毎月黒字。なのに通帳が増えない",
                "月額3000円のサブスクでも、原価7割が先に出ていく",
                "黒字のまま詰む、ってこういうこと",
                "だから年払いプランを作った",
                "でも最初に返ってきたのは「そんなに続くかわからない」だった",
                "全額返金OKにしたら、解約が減った",
                "そこから設計を変えて、3ヶ月で残高が戻った",
            ]
        )
        return normalize_body(manual)
    if seed.tension_tag == "anxiety":
        structure = "不安の引き金 → 具体的な失敗/痛み → でも残ったもの → 今の判断"
    elif seed.tension_tag == "surprise":
        structure = "常識 → え、逆だった → 具体例（数字） → 学び"
    else:
        structure = "信じてた常識 → でも裏切られた → 俺の失敗（数字） → 残ったもの → 今の判断"
    allowed_facts = [
        "1人で4事業",
        "AIエージェントにマネジメントを丸投げする実験",
        "100日チャレンジを実行中",
        "週次で進捗公開",
    ]
    seed_numbers = extract_numbers(f"{seed.seed} {seed.sprout}")
    allowed_numbers = sorted(BASE_ALLOWED_NUMBERS | seed_numbers)
    strict_note = "必ず『でも/のに/逆』のいずれかを入れる" if strict else ""
    sprout_hint = seed.sprout
    sprout_hint = sprout_hint.replace("10倍", "後から効く").replace("10年後に", "数年後に")
    prompt = f"""
seed: {seed.seed}
sprout_hint: {sprout_hint}
tension_tag: {seed.tension_tag}
assumption: {seed.assumption}
structure_hint: {structure}

Voice/Rules (excerpt):
{voice_context}

上のseed/sproutを使って、俺視点のX投稿本文を作る。
条件:
- 1行目は結論/数字/逆説で始める
- 句点「。」は使わない
- 箇条書き「-」「・」禁止
- 知らない職種や現場描写は書かない
- sproutは比喩や気づきとして使い、具体例は俺の経験に寄せる
- sproutはそのまま引用せず、意図だけ使う
- 失敗/痛みを1つ入れる（例: 捨てた/やめた/戻した）
- 数字は最大2つ（sproutの数値 + 許可された数値のみ）
- 許可された数値: {', '.join(allowed_numbers)}
- 許可された事実だけ使う: {', '.join(allowed_facts)}
- 許可外のツール名や具体事例は捏造しない
- 自社プロダクト名は出さない
- 「戦略」「勝率」「本質」みたいな抽象ワードで締めない
- 抽象ワード禁止: {', '.join(ABSTRACT_WORDS)}
- 禁止ワード: {', '.join(FORBIDDEN_WORDS)}
- {strict_note}
- 行数は{line_count}行、行と行の間は空行を入れる
- 文量は{target_chars}±40文字
- CTAは任意。入れるなら本文の因果から自然に
- テンプレ臭/AI臭が出ないように、言い回しと構成は単調にしない
- 出力はJSONのみ

出力フォーマット:
{{"body": "..."}}
"""
    system_prompt = "あなたはX投稿の原稿担当。読者は経営者/PM。"
    raw = run_claude(prompt.strip(), system_prompt, "draft_generator")
    try:
        data = extract_json(raw)
        body = normalize_body(data.get("body", raw))
    except Exception:
        body = normalize_body(raw)
    if body.strip().startswith("{") and '"body"' in body:
        try:
            data = extract_json(body)
            body = normalize_body(data.get("body", body))
        except Exception:
            pass
    if cta and cta not in body:
        body = f"{body}\n\n{cta}"
    return body


def rewrite_with_fix(seed: SeedItem, body: str, fixes: list[str]) -> str:
    fix_text = "\n".join(f"- {f}" for f in fixes)
    sprout_hint = seed.sprout.replace("10倍", "後から効く").replace("10年後に", "数年後に")
    allowed_numbers = sorted(BASE_ALLOWED_NUMBERS | extract_numbers(f"{seed.seed} {seed.sprout}"))
    prompt = f"""
seed: {seed.seed}
sprout_hint: {sprout_hint}
tension_tag: {seed.tension_tag}

Original:
{body}

修正指示:
{fix_text}

条件:
- 俺視点で書く
- 句点「。」禁止
- 箇条書き禁止
- 不自然なCTAは入れない
- 改行は多め（行間に空行）
 - 数字は最大2つ（許可された数値のみ: {', '.join(allowed_numbers)}）
- 許可外のツール名や具体事例は捏造しない
- 自社プロダクト名は出さない
- 禁止ワード: {', '.join(FORBIDDEN_WORDS)}
- contradictionの場合は「信じてた→裏切られた」の順で出す
- 出力はJSONのみ

出力フォーマット:
{{"body": "..."}}
"""
    system_prompt = "あなたはX投稿の鬼編集長の修正担当。"
    raw = run_claude(prompt.strip(), system_prompt, "draft_rewriter")
    try:
        data = extract_json(raw)
        rewritten = normalize_body(data.get("body", raw))
    except Exception:
        rewritten = normalize_body(raw)
    if rewritten.strip().startswith("{") and '"body"' in rewritten:
        try:
            data = extract_json(rewritten)
            rewritten = normalize_body(data.get("body", rewritten))
        except Exception:
            pass
    return apply_fix_heuristics(rewritten, fixes, seed)


def apply_fix_heuristics(body: str, fixes: list[str], seed: SeedItem) -> str:
    lines = [line.strip() for line in body.splitlines() if line.strip()]
    if not lines:
        return body
    fix_text = " ".join(fixes)
    if any(word in fix_text for word in ["CTA", "問い", "疑問"]):
        last = lines[-1]
        if last.endswith("？") or last.endswith("?"):
            lines[-1] = f"結局、{seed.sprout}"
    if "最後" in fix_text and "削除" in fix_text and len(lines) > 1:
        lines = lines[:-1]
    if "抽象" in fix_text:
        cleaned = []
        for line in lines:
            line = line.replace("裏切らない", "残った")
            line = line.replace("戦略", "判断")
            line = line.replace("勝率", "結果")
            cleaned.append(line)
        lines = cleaned
    return "\n\n".join(lines)


def render_post(
    post_id: str,
    seed: SeedItem,
    body: str,
    status: str,
    scheduled_at: str | None,
    story_id: str,
    story_stage: str = "hook",
) -> str:
    lines = [
        "---",
        f"id: {post_id}",
        f"story_id: {story_id}",
        f"story_stage: {story_stage}",
        "primary_channel: x",
        "type: post",
        f"status: {status}",
        "",
        f"pillar_id: pillar-{seed.pillar_no}" if seed.pillar_no else "pillar_id: null",
        f"idea_id: {seed.sprout_id}" if seed.sprout_id else "idea_id: null",
        "tension_tag: " + seed.tension_tag,
        "seed: " + seed.seed,
        "sprout: " + seed.sprout,
        "",
        "risk_level: low",
        "owner: ksato",
        "reviewer: null",
        "",
        f"scheduled_at: {scheduled_at if scheduled_at else 'null'}",
        "published_at: null",
        "x_post_id: null",
        "x_url: null",
        "",
        "qc:",
        "  policy_checked: false",
        "  fact_checked: false",
        "  voice_checked: false",
        "  dedupe_checked: false",
        "",
        "measured_24h_at: null",
        "measured_7d_at: null",
        "",
        "distribution_status: pending",
        "repurpose_status: pending",
        "",
        "proof_refs: []",
        f"source_refs: [{str(seed.sprout_id) if seed.sprout_id else ''}]",
        f"lane: {lane_for_tension(seed.tension_tag)}",
        "---",
        "",
        body.strip(),
        "",
    ]
    return "\n".join(lines)


def review_posts(input_dir: Path, out_dir: Path, date_str: str) -> list[dict]:
    def codex_fallback_reviews() -> list[dict]:
        reviews: list[dict] = []
        for md in sorted(input_dir.glob("*.md")):
            post_id = md.stem
            body = extract_body_from_file(md)
            prompt = f"""
id: {post_id}
本文:
{body}

評価してJSONのみで返す:
{{"id":"{post_id}","score":0-100,"pass":true/false,"fix":["..."],"notes":"..."}}
""".strip()
            system_prompt = (
                "あなたはX投稿の厳格レビュアー。"
                "捏造は禁止。構成/具体性/読みやすさを評価し、改善指示を簡潔に返す。"
            )
            try:
                raw = run_claude(prompt, system_prompt, "phase2_5_reviewer_fallback", timeout=90)
                data = extract_json(raw)
            except Exception as exc:
                data = {"id": post_id, "score": 0, "pass": False, "fix": ["review_failed"], "notes": str(exc)[:120]}
            score = int(data.get("score", 0) or 0)
            data["pass"] = bool(score >= 80)
            if not isinstance(data.get("fix"), list):
                data["fix"] = []
            reviews.append(data)
        return reviews

    env = os.environ.copy()
    env.setdefault("CLAUDE_CODE_BIN", "claude")
    cmd = [
        sys.executable,
        str(REVIEW_SUBAGENT),
        "--input-dir",
        str(input_dir),
        "--out-dir",
        str(out_dir),
        "--date",
        date_str,
    ]
    if _CLAUDE_UNAVAILABLE:
        return codex_fallback_reviews()
    timeout_sec = int(os.environ.get("REVIEW_SUBAGENT_TIMEOUT_SEC", "120"))
    try:
        run_cmd(cmd, env=env, timeout=timeout_sec)
    except Exception:
        return codex_fallback_reviews()
    json_path = out_dir / f"phase2_5_reviews_{date_str}_subagent.json"
    if not json_path.exists():
        return codex_fallback_reviews()
    return json.loads(json_path.read_text(encoding="utf-8"))


def load_schedule(path: Path) -> dict:
    if not path.exists():
        return {"posts": []}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {"posts": []}


def used_templates_for_date(posts: list, day: datetime) -> set[str]:
    target = day.date().isoformat()
    used = set()
    for post in posts:
        scheduled = post.get("scheduled_at")
        if not scheduled:
            continue
        try:
            dt = datetime.fromisoformat(scheduled)
        except ValueError:
            continue
        if dt.date().isoformat() != target:
            continue
        image = post.get("image", "")
        if image:
            name = Path(image).stem
            if "_" in name:
                used.add(name.split("_", 1)[0])
    return used


def choose_template(tension_tag: str, used: set[str]) -> str:
    if tension_tag == "anxiety":
        candidates = ["gap", "confession", "recovery", "mystery"]
    elif tension_tag == "surprise":
        candidates = ["incident", "poll", "progress", "mystery"]
    else:
        candidates = ["gap", "framework", "mystery", "graphrec"]
    pool = [t for t in candidates if t not in used]
    if not pool:
        pool = [t for t in TEMPLATES_ALL if t not in used] or TEMPLATES_ALL
    return random.choice(pool)


def generate_image(template: str, title: str, seed: SeedItem, post_id: str) -> Path:
    output_dir = ROOT / "sns/images"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{template}_{post_id}.jpg"
    points = [seed.sprout, seed.assumption]
    cmd = [
        sys.executable,
        str(NANO_BANANA),
        "-t",
        template,
        "-o",
        str(output_path),
        title,
    ] + points
    run_cmd(cmd)
    return output_path


def choose_schedule_slot(day: datetime, start: str, end: str, interval_min: int, existing: set[str]) -> str:
    start_dt = datetime.fromisoformat(f"{day.date().isoformat()}T{start}:00+09:00")
    end_dt = datetime.fromisoformat(f"{day.date().isoformat()}T{end}:00+09:00")
    slot = start_dt
    while slot <= end_dt:
        if slot.isoformat() not in existing:
            return slot.isoformat()
        slot += timedelta(minutes=interval_min)
    # fallback to next day start
    next_day = start_dt + timedelta(days=1)
    return next_day.isoformat()


def choose_schedule_slot_from_list(day: datetime, slots: list[str], existing: set[str]) -> str | None:
    for slot in slots:
        slot = slot.strip()
        if not slot:
            continue
        scheduled = datetime.fromisoformat(f"{day.date().isoformat()}T{slot}:00+09:00").isoformat()
        if scheduled not in existing:
            return scheduled
    return None


def count_wip_drafts(window_days: int = 7) -> int:
    now = datetime.now(JST)
    threshold = now - timedelta(days=max(window_days, 0))
    count = 0
    for folder in (POSTS_DRAFT_DIR, POSTS_REVIEW_DIR):
        for path in folder.glob("x-*.md"):
            if window_days <= 0:
                count += 1
                continue
            mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=JST)
            if mtime >= threshold:
                count += 1
    return count


def write_schedule(path: Path, data: dict) -> None:
    path.write_text(
        yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=1000),
        encoding="utf-8",
    )


def append_seed_log(path: Path, lines: list[str]) -> None:
    if not lines:
        return
    content = "\n".join(lines).rstrip() + "\n"
    if path.exists():
        existing = path.read_text(encoding="utf-8", errors="ignore").rstrip()
        if existing:
            content = f"{existing}\n\n{content}"
    path.write_text(content, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="SNS Factory Line (one-shot)")
    parser.add_argument("--count", type=int, default=1)
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--mode", default="auto")
    parser.add_argument("--date", default=datetime.now(JST).strftime("%Y-%m-%d"))
    parser.add_argument("--seed-file", default="")
    parser.add_argument("--schedule-start", default="07:00")
    parser.add_argument("--schedule-end", default="14:00")
    parser.add_argument("--interval-min", type=int, default=180)
    parser.add_argument("--schedule-slots", default="")
    parser.add_argument("--max-wip", type=int, default=5)
    parser.add_argument("--wip-window-days", type=int, default=7)
    parser.add_argument("--wip-policy", choices=["abort", "warn"], default="warn")
    parser.add_argument("--blocked-keywords", default="")
    parser.add_argument("--blocked-pillars", default="")
    parser.add_argument("--block-mode", default="off")
    parser.add_argument("--pillar-no", default="")
    parser.add_argument("--skip-seed", action="store_true")
    parser.add_argument("--skip-images", action="store_true")
    parser.add_argument("--skip-schedule", action="store_true")
    parser.add_argument("--strict-word-guard", action="store_true")
    args = parser.parse_args()

    ensure_dirs()
    try:
        ensure_note_log()
    except Exception as exc:
        print(f"WARN: note_log ensure failed: {exc}")
    wip_count = count_wip_drafts(args.wip_window_days)
    if wip_count >= args.max_wip:
        message = (
            f"WIP limit reached: {wip_count} >= {args.max_wip} "
            f"(window_days={args.wip_window_days})"
        )
        if args.wip_policy == "abort":
            raise SystemExit(message)
        print(f"WARN: {message}; continue because wip_policy=warn")
    run_id = datetime.now(JST).strftime("%Y%m%d_%H%M%S")
    run_dir = POSTS_DIR / f"_run_{run_id}"
    run_dir.mkdir(parents=True, exist_ok=True)
    date_str = args.date
    day = datetime.fromisoformat(f"{date_str}T00:00:00+09:00")

    seed_file = Path(args.seed_file) if args.seed_file else None
    if not seed_file and not args.skip_seed:
        env = os.environ.copy()
        if not env.get("CLAUDE_CODE_OAUTH_TOKEN"):
            env["CLAUDE_CODE_ALLOW_NO_TOKEN"] = "1"
        if not env.get("MEETING_ROOTS"):
            env["MEETING_ROOTS"] = ",".join(str(p) for p in default_meeting_roots())
        cmd = [
            sys.executable,
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
            "60",
            "--max-files",
            "6",
        ]
        run_cmd(cmd, env=env)
        seed_file = Path(f"{SEED_OUT_DIR}/{date_str}_seed_sprout.md")
    if not seed_file or not seed_file.exists():
        seed_file = latest_seed_log(SEED_OUT_DIR)
    if not seed_file:
        raise SystemExit("seed log not found")

    items = parse_seed_log(seed_file)
    if not items:
        raise SystemExit("no seeds found")
    blocked_keywords = BLOCKED_KEYWORDS + normalize_keywords(os.environ.get("BLOCKED_SEED_KEYWORDS", ""))
    blocked_keywords += normalize_keywords(args.blocked_keywords)
    blocked_pillars = set(normalize_keywords(os.environ.get("BLOCKED_PILLAR_NOS", "")))
    blocked_pillars |= set(normalize_keywords(args.blocked_pillars))
    block_mode = (os.environ.get("BLOCK_MODE") or args.block_mode or "off").lower()
    strict_word_guard = args.strict_word_guard or os.environ.get("STRICT_WORD_GUARD", "").strip().lower() in {
        "1",
        "true",
        "yes",
    }
    if args.pillar_no:
        targets = {p.strip() for p in args.pillar_no.split(",") if p.strip()}
        items = [i for i in items if i.pillar_no in targets]
    items = sorted(items, key=score_seed_item, reverse=True)

    voice_context = load_voice_context()
    target = max(args.count, 1)
    scheduled_count = 0

    schedule_data = load_schedule(SCHEDULE_PATH)
    existing_times = {p.get("scheduled_at") for p in schedule_data.get("posts", []) if p.get("scheduled_at")}
    used_templates = used_templates_for_date(schedule_data.get("posts", []), day)
    schedule_slots = [s for s in args.schedule_slots.split(",") if s.strip()]

    log_lines = [
        "# SNS Factory Line Run",
        f"- date: {date_str}",
        f"- seed_log: {seed_file}",
        "",
    ]

    seed_log_path = SEED_LOG_DIR / f"seed_{date_str}.md"
    if seed_log_path.exists():
        seed_log_lines = [
            f"## run {run_id}",
            f"- source_seed_log: {seed_file}",
            "",
        ]
    else:
        seed_log_lines = [
            f"# seed log ({date_str})",
            "",
            f"- source_seed_log: {seed_file}",
            "",
        ]

    for item in items:
        if scheduled_count >= target:
            break
        if blocked_pillars and item.pillar_no in blocked_pillars:
            log_lines.append(f"- skip: pillar_blocked {item.pillar_no} {item.seed}")
            continue
        if block_mode in {"keywords", "hybrid"} and is_blocked_seed(item, blocked_keywords, set()):
            log_lines.append(f"- skip: keyword_blocked {item.pillar_no} {item.seed}")
            continue
        if block_mode in {"llm", "hybrid"}:
            blocked, reason = is_blocked_seed_llm(item)
            if blocked:
                log_lines.append(f"- skip: llm_blocked {reason} {item.pillar_no} {item.seed}")
                continue

        post_id = next_post_id(day.strftime("%Y%m%d"))
        story_id = story_id_for(post_id)
        story_stage = "hook"
        item_run_dir = run_dir / post_id
        item_run_dir.mkdir(parents=True, exist_ok=True)

        body = generate_draft(item, voice_context)
        allowed_numbers = BASE_ALLOWED_NUMBERS | extract_numbers(f"{item.seed} {item.sprout}")
        if not validate_body(body, item.tension_tag, allowed_numbers, strict_word_guard=strict_word_guard):
            body = generate_draft(item, voice_context, strict=True)

        draft_path = POSTS_DRAFT_DIR / f"{post_id}.md"
        draft_path.write_text(
            render_post(post_id, item, body, "draft", None, story_id, story_stage),
            encoding="utf-8",
        )
        shutil.copy2(draft_path, item_run_dir / f"{post_id}.md")

        review_tag = f"{date_str}-{post_id}"
        review_results = review_posts(item_run_dir, QC_DIR, review_tag)
        review_map = {r["id"]: r for r in review_results}
        result = review_map.get(post_id, {})

        if not result or not result.get("pass"):
            fixes = result.get("fix", []) if result else []
            body = normalize_body(extract_body_from_file(draft_path))
            rewritten = rewrite_with_fix(item, body, fixes)
            draft_path.write_text(
                render_post(post_id, item, rewritten, "draft", None, story_id, story_stage),
                encoding="utf-8",
            )
            shutil.copy2(draft_path, item_run_dir / f"{post_id}.md")

            review_results = review_posts(item_run_dir, QC_DIR, review_tag + "-retry")
            review_map = {r["id"]: r for r in review_results}
            result = review_map.get(post_id, {})

        if not result or not result.get("pass"):
            log_lines.append(f"- skip: {post_id} review_failed")
            continue

        body = normalize_body(extract_body_from_file(draft_path))
        title = item.sprout.split("、")[0][:28]

        duplicate = find_duplicate_in_schedule(schedule_data.get("posts", []), title, body)
        if duplicate:
            dup_id, dup_reason = duplicate
            log_lines.append(f"- skip: {post_id} duplicate_of={dup_id} ({dup_reason})")
            if draft_path.exists():
                draft_path.unlink()
            continue

        image_path = None
        template = None
        if not args.skip_images:
            template = choose_template(item.tension_tag, used_templates)
            image_path = generate_image(template, title, item, post_id)
            used_templates.add(template)

        scheduled_at = None
        final_status = "review"
        if not args.skip_schedule:
            scheduled_at = None
            if schedule_slots:
                scheduled_at = choose_schedule_slot_from_list(day, schedule_slots, existing_times)
            if not scheduled_at:
                scheduled_at = choose_schedule_slot(
                    day,
                    args.schedule_start,
                    args.schedule_end,
                    args.interval_min,
                    existing_times,
                )
            existing_times.add(scheduled_at)
            queue_status = "ready" if scheduled_at else "pending"
            schedule_data.setdefault("posts", []).append(
                {
                    "id": post_id,
                    "story_id": story_id,
                    "story_stage": story_stage,
                    "scheduled_at": scheduled_at,
                    "type": "x_post",
                    "title": title,
                    "body": body,
                    "image": str(image_path) if image_path else "",
                    "sns_smart_completed": True,
                    "status": queue_status,
                }
            )
            final_status = queue_status

            planned_source_path = str((POSTS_SCHEDULED_DIR / f"{post_id}.md").relative_to(ROOT))
            try:
                upsert_dispatch_entry(
                    date_str=date_str,
                    slot_jst=scheduled_at,
                    story_id=story_id,
                    story_stage=story_stage,
                    channel="x",
                    content_type="x_post",
                    post_id=post_id,
                    image=str(image_path.relative_to(ROOT)) if image_path else "",
                    status=queue_status,
                    source_path=planned_source_path,
                    note="factory_line",
                )
            except Exception as exc:
                log_lines.append(f"- warn: dispatch_plan_update_failed {post_id} {exc}")

        scheduled_path = POSTS_SCHEDULED_DIR / f"{post_id}.md"
        scheduled_path.write_text(
            render_post(post_id, item, body, final_status, scheduled_at, story_id, story_stage),
            encoding="utf-8",
        )
        if draft_path.exists():
            draft_path.unlink()
        scheduled_count += 1

        log_lines.extend(
            [
                f"## {post_id}",
                f"- story_id: {story_id}",
                f"- pillar_no: {item.pillar_no}",
                f"- seed: {item.seed}",
                f"- sprout: {item.sprout}",
                f"- tension: {item.tension_tag}",
                f"- process: {', '.join(item.process) if item.process else '-'}",
                f"- review_score: {result.get('score') if result else 'n/a'}",
                f"- template: {template if template else 'none'}",
                f"- scheduled_at: {scheduled_at if scheduled_at else 'skip'}",
                "",
            ]
        )

        seed_log_lines.extend(
            [
                f"## {story_id}",
                f"- post_id: {post_id}",
                f"- story_stage: {story_stage}",
                f"- pillar_no: {item.pillar_no}",
                f"- seed_line: {item.seed}",
                f"- sprout: {item.sprout}",
                f"- tension: {item.tension_tag}",
                f"- assumption: {item.assumption}",
                f"- scheduled_at: {scheduled_at if scheduled_at else 'skip'}",
                "",
            ]
        )

    if not args.skip_schedule:
        write_schedule(SCHEDULE_PATH, schedule_data)

    log_path = LOG_DIR / f"factory_line_{datetime.now(JST).strftime('%Y%m%d_%H%M')}.md"
    log_path.write_text("\n".join(log_lines), encoding="utf-8")
    append_seed_log(seed_log_path, seed_log_lines)
    print(f"factory line completed: {log_path}")


if __name__ == "__main__":
    main()
