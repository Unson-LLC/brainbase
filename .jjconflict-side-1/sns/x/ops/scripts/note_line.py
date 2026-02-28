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
RUN_LEDGER_SCRIPT = ROOT / "common/ops/scripts/run_ledger.py"
SCHEDULE_PATH = ROOT / "sns/scheduled_posts.yml"

BASE_ALLOWED_NUMBERS = {"4", "100"}
MIN_CHARS = 2200
MAX_CHARS = 3200
MAX_LENGTH_RETRIES = 2
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
    if os.environ.get("DISABLE_CODEX_FALLBACK", "").lower() in {"1", "true", "yes"}:
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
        with tempfile.NamedTemporaryFile(prefix="note_line_codex_", suffix=".txt", delete=False) as tmp:
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


def run_claude(prompt: str, system_prompt: str, timeout: int, agent_name: str = "note_writer") -> str:
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
    current: dict[str, Any] | None = None
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


def dedupe_text(text: str) -> str:
    return "".join(str(text or "").split()).strip()


def similarity_ratio(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


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

要件:
- note向け日本語記事。俺視点で書く
- 一人称は必ず「俺」
- 事実の範囲だけで書く（捏造禁止）
- 数字は次だけ使用可: {', '.join(allowed_numbers) if allowed_numbers else '（数字は使わない）'}
- 文字数は{MIN_CHARS}〜{MAX_CHARS}文字（改行含む）
- 構成:
  1) 導入（課題/違和感）
  2) 背景（なぜそう判断したか）
  3) 実例（具体の行動/事実）
  4) 失敗 or 学び
  5) 次のアクション
- 1文は短めに書く（最大80文字目安）
- 抽象語（本質/重要/必要/最適など）だけで段落を埋めない。抽象語の直後に具体を置く
- 読者がそのまま使える具体フォーマットを最低1つ入れる（テンプレ文、チェックリスト、箇条書き）
- 末尾に注釈・文字数メモは禁止

出力: 本文のみ（markdown可）。
""".strip()


def build_length_prompt(body: str, item: SeedItem, allowed_numbers: list[str], current_chars: int) -> str:
    if current_chars < MIN_CHARS:
        action = "情報量が不足。既存事実の文脈と具体描写を厚くして増やす。"
    else:
        action = "冗長表現を削って圧縮。事実は落とさない。"
    return f"""
seed: {item.seed}
sprout: {item.sprout}
assumption: {item.assumption}
process: {', '.join(item.process)}

制約:
- 一人称は「俺」
- 事実以外を追加しない
- 数字は次だけ使用可: {', '.join(allowed_numbers) if allowed_numbers else '（数字は使わない）'}
- 文字数は{MIN_CHARS}〜{MAX_CHARS}文字（改行含む）に必ず収める
- 注釈禁止
- 抽象語の反復を削除し、各セクションで具体行動を1つ以上書く
- 読者がそのまま使える具体フォーマットを1つ以上残す

調整方針: {action}
現状本文（{current_chars}文字）:
{body}

出力: 修正版本文のみ。
""".strip()


def ensure_length(body: str, item: SeedItem, allowed_numbers: list[str], timeout: int) -> str:
    allowed_set = set(allowed_numbers)
    body = body.strip()
    for _ in range(MAX_LENGTH_RETRIES + 1):
        current_chars = count_chars(body)
        if MIN_CHARS <= current_chars <= MAX_CHARS:
            return body
        prompt = build_length_prompt(body, item, allowed_numbers, current_chars)
        system_prompt = "あなたはnote編集者。文字数制約と事実制約を厳守する。"
        body = run_claude(prompt, system_prompt, timeout).strip()
        body = sanitize_numbers(body, allowed_set)
    return body


def clean_snippet(text: str, limit: int = 180) -> str:
    value = re.sub(r"\s+", " ", str(text or "")).strip()
    value = value.replace("```", "").replace("#", "")
    if len(value) > limit:
        value = value[:limit].rstrip(" 、,.")
    return value


def ensure_local_length(body: str) -> str:
    text = body.strip()
    pads = [
        "俺は運用で迷いが出たら、まず事実の並びを見直す。誰が何を見て、どこで判断し、どの時点で次の人に渡すのかを短い言葉で固定する。これを先にやると、感覚で回していた作業が再現可能な作業に変わる。派手さはないけど、現場の詰まりはこの地味な整理で確実に減る。",
        "俺が意識しているのは、正しさより順番だ。正しい施策でも順番が崩れると、現場では別物になる。だから最初に判断条件を明文化し、次に入力フォーマットを揃え、最後に完了報告の書き方を固定する。順番が揃うと、個人差ではなく手順差として課題が見えるようになる。",
        "運用の改善は、難しい理論よりも『誰でも同じ結果になるか』で判断する。俺はこの基準に寄せるために、曖昧な言い回しを減らしている。抽象語でまとめると、その場では分かった気になるけど次回に再現できない。再現できない改善は、改善ではなく偶然だと考えている。",
        "このやり方の副作用として、最初は作業が遅く感じる。けれど、判断の根拠が揃うと手戻りが減るので、全体では必ず速くなる。俺は短期の体感速度より、週次で見た再作業の減少を重視する。改善は一回の速さではなく、繰り返したときの安定で評価するべきだ。",
    ]
    idx = 0
    while count_chars(text) < MIN_CHARS:
        text = f"{text}\n\n{pads[idx % len(pads)]}".strip()
        idx += 1
        if idx > 30:
            break
    if count_chars(text) > MAX_CHARS:
        text = text[:MAX_CHARS].rstrip()
    return text


def build_local_note(item: SeedItem) -> str:
    seed = clean_snippet(item.seed) or "運用の判断が曖昧なまま進んでしまう違和感"
    sprout = clean_snippet(item.sprout) or "運用を再現可能な手順に落とし込む"
    assumption = clean_snippet(item.assumption) or "判断条件を先に固定すればブレを減らせる"
    process_lines = [clean_snippet(p, 160) for p in item.process if clean_snippet(p, 160)]
    if not process_lines:
        process_lines = [
            "事実を短く列挙する",
            "判断条件を先に固定する",
            "次の実行手順を一つだけ決める",
        ]
    process_block = "\n".join(f"- {line}" for line in process_lines[:5])
    body = f"""
## 導入（課題/違和感）
俺が最初に引っかかったのは「{seed}」という現場の違和感だった。作業そのものは回っているのに、判断の根拠が人ごとに違っていて、同じ入力でも結論が揺れる。これが積み上がると、進んでいるはずなのに前に進んだ実感が薄くなる。俺はこの状態を放置すると、後工程で必ず詰まると見ている。

## 背景（なぜそう判断したか）
背景にある前提は「{assumption}」だ。ここを曖昧にしたまま改善を重ねても、改善案の比較ができない。俺はまず判断条件を固定して、次に作業の受け渡し条件を固定する。判断条件が先、手順は後。この順番を守ると、成果が人依存ではなく運用依存になる。

## 実例（具体の行動/事実）
今回の軸足は「{sprout}」に置いた。実際に俺がやったことは次の通り。
{process_block}

この実行で重視したのは、派手な最適化よりも再現性だ。誰が見ても同じ理解になる言葉に置き換え、作業者の解釈余地を減らした。結果として、レビューの戻し理由が具体化され、修正ポイントが次の実行で再利用できる形になった。これは単発の改善ではなく、運用資産として残る改善だ。

## すぐ使えるフォーマット
俺は以下の3行を固定して使う。

- 依頼: 対象 / 期限 / 依頼者
- チェック: 確認項目 / 判定 / 差し戻し
- 完了報告: 結果 / リンク / 次アクション

## 失敗 or 学び
失敗は、最初に「意図が伝われば十分」と考えていたことだ。意図が伝わっても、条件が固定されていないと結果は揃わない。俺はここで、伝達の上手さより仕様の明確さを優先するように切り替えた。学びは、運用のズレは能力差ではなく定義不足で起こる、という点だ。

## 次のアクション
次は、今回固定した判断条件をテンプレート化して、次の案件でも同じ順番で回す。あわせて、完了報告のフォーマットを短文化し、判断の根拠と次アクションを必須項目にする。俺はこの運用を続けて、改善の速度よりも再現性の高さを先に取りにいく。再現性が取れれば、速度は後から必ず上がる。
""".strip()
    return ensure_local_length(body)


def normalize_hhmm(value: str) -> str:
    val = (value or "").strip()
    if not val:
        return "20:30"
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
    return slots or ["20:30"]


def build_schedule_iso(date_str: str, hhmm: str) -> str:
    dt = datetime.fromisoformat(f"{date_str}T{normalize_hhmm(hhmm)}:00").replace(tzinfo=JST)
    return dt.isoformat()


def pick_schedule_slot(date_str: str, slots: list[str], used: set[str]) -> str:
    for slot in slots:
        iso = build_schedule_iso(date_str, slot)
        if iso not in used:
            used.add(iso)
            return iso
    base = datetime.fromisoformat(build_schedule_iso(date_str, slots[-1]))
    while True:
        base = base + timedelta(minutes=30)
        iso = base.isoformat()
        if iso not in used:
            used.add(iso)
            return iso


def build_title(item: SeedItem, body: str) -> str:
    head = item.sprout.split("、")[0].strip()
    if head:
        return head[:48]
    for line in body.splitlines():
        text = line.strip()
        if text:
            return text[:48]
    return f"note {item.sprout_id or 'draft'}"


def write_note_draft(path: Path, story_id: str, item: SeedItem, title: str, body: str) -> None:
    front = [
        "---",
        f"id: note_{story_id}",
        f"story_id: {story_id}",
        "type: note",
        "status: draft",
        f"pillar_no: {item.pillar_no}",
        f"sprout_id: {item.sprout_id}",
        f"seed: {item.seed}",
        f"sprout: {item.sprout}",
        "---",
        "",
        f"**採用**: {title}",
        "**タグ**: #AI #マネジメント #実装",
        "",
        "## 本文",
        body.strip(),
        "",
        "## メタ情報",
        f"- story_id: {story_id}",
        f"- generated_at: {datetime.now(JST).isoformat(timespec='seconds')}",
    ]
    path.write_text("\n".join(front) + "\n", encoding="utf-8")


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
    fix_block = "\n".join(f"- {f}" for f in fixes) if fixes else "- 読者が入る具体事例と判断行動を増やす"
    allowed = ", ".join(allowed_numbers) if allowed_numbers else "（数字は使わない）"
    prompt = f"""
seed: {item.seed}
sprout: {item.sprout}
assumption: {item.assumption}
process: {', '.join(item.process)}

修正指示:
{fix_block}

制約:
- 冒頭〜末尾まで一貫して「俺」の視点を保つ
- 事実範囲のみで書き、捏造を追加しない
- 数字は次だけ使用可: {allowed}
- 文字数は{MIN_CHARS}〜{MAX_CHARS}文字（改行含む）
- 記事構成（導入・背景・実例・失敗/学び・次の行動）を維持
- 末尾に注釈・文字数メモを追加しない
- 1文は短め（最大80文字目安）

出力: 本文のみ
""".strip()
    system_prompt = "あなたはnote記事の鬼編集長リライト担当。読者を現場に戻せる具体化を先に置く。"
    try:
        rewritten = run_claude(prompt, system_prompt, timeout, agent_name="note_rewriter").strip()
        rewritten = sanitize_numbers(rewritten, set(allowed_numbers))
        rewritten = ensure_length(rewritten, item, allowed_numbers, timeout)
        return rewritten
    except Exception as exc:
        print(f"WARN: rewrite_with_fix fallback to local template: {exc}")
        return ensure_local_length(build_local_note(item))


def review_note(path: Path, date_tag: str) -> None:
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
    review_note(path, date_tag)
    return read_review_result(path, date_tag)


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


def enqueue_schedule_entry(
    schedule_data: dict[str, Any],
    post_id: str,
    story_id: str,
    title: str,
    body: str,
    source_path: Path,
    scheduled_at: str,
) -> tuple[bool, str]:
    posts = schedule_data.setdefault("posts", [])
    source_rel = str(source_path.relative_to(ROOT))
    if is_duplicate_entry(posts, title, body, source_rel, skip_post_id=post_id):
        return False, "duplicate"
    for post in posts:
        if str(post.get("id") or "") == post_id:
            post.update(
                {
                    "story_id": story_id,
                    "story_stage": "note",
                    "scheduled_at": scheduled_at,
                    "type": "note",
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
            "story_stage": "note",
            "scheduled_at": scheduled_at,
            "type": "note",
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
    parser = argparse.ArgumentParser(description="Note Line")
    parser.add_argument("--date", default=datetime.now(JST).strftime("%Y-%m-%d"))
    parser.add_argument("--seed-file", default="")
    parser.add_argument("--count", type=int, default=1)
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--mode", default="auto")
    parser.add_argument("--llm-timeout", type=int, default=90)
    parser.add_argument("--skip-review", action="store_true", help="skip post-generation review step")
    parser.add_argument("--enqueue-schedule", action="store_true", help="append generated note to scheduled_posts.yml")
    parser.add_argument("--schedule-file", default=str(SCHEDULE_PATH))
    parser.add_argument("--schedule-slots", default="20:30", help="JST slots (HH:MM,comma)")
    args = parser.parse_args()

    DRAFT_DIR.mkdir(parents=True, exist_ok=True)
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
    if seed_file and not seed_file.exists():
        seed_file = latest_seed_log(SEED_OUT_DIR)
    if not seed_file:
        raise SystemExit("seed log not found")

    items = parse_seed_log(seed_file)
    if not items:
        raise SystemExit("no seeds found")
    items = sorted(items, key=score_seed_item, reverse=True)[: args.count]

    schedule_data = {"posts": []}
    schedule_changed = False
    used_schedule_times: set[str] = set()
    schedule_slots = parse_schedule_slots(args.schedule_slots)
    if args.enqueue_schedule:
        schedule_data = load_schedule(Path(args.schedule_file))

    date_compact = args.date.replace("-", "")
    for idx, item in enumerate(items, 1):
        story_id = f"story-{date_compact}-note-{idx:03d}"
        post_id = f"note-{date_compact}-{idx:03d}"
        path = DRAFT_DIR / f"note_{story_id}.md"
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
        run_id = f"note_line_{post_id}"
        run_ledger_write(
            {
                "run_id": run_id,
                "pipeline": "note-line",
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
            system_prompt = "あなたはnote執筆者。事実ベースで長文記事を書く。"
            generation_note = ""
            try:
                body = run_claude(prompt, system_prompt, args.llm_timeout)
                body = sanitize_numbers(body, set(allowed_numbers))
                body = ensure_length(body, item, allowed_numbers, args.llm_timeout)
            except Exception as llm_exc:
                generation_note = f"local_fallback: {str(llm_exc)[:180]}"
                print(f"WARN: note generation fallback to local template ({llm_exc})")
                body = build_local_note(item)
                body = sanitize_numbers(body, set(allowed_numbers))
                body = ensure_local_length(body)
            title = build_title(item, body)

            write_note_draft(path, story_id, item, title, body)
            draft_payload = {
                "phase": "draft",
                "status": "review",
                "output_refs": [str(path)],
            }
            if generation_note:
                draft_payload["notes"] = generation_note
            run_ledger_update(run_id, draft_payload)

            if not args.skip_review:
                review_tag = f"{args.date}-note-{story_id}"
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
                            fixes or ["読者が現場に入りやすい具体を増やす"],
                            args.llm_timeout,
                            allowed_numbers,
                        )
                        title = build_title(item, body)
                        write_note_draft(path, story_id, item, title, body)
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

            if args.enqueue_schedule:
                slot = (
                    current_scheduled_at
                    if current_scheduled_at
                    else pick_schedule_slot(args.date, schedule_slots, used_schedule_times)
                )
                changed, result = enqueue_schedule_entry(
                    schedule_data=schedule_data,
                    post_id=post_id,
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
                            "notes": f"enqueued:{result} at {slot}",
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
