#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo
from dotenv import load_dotenv


load_dotenv(Path.home() / "workspace/.env")
JST = ZoneInfo("Asia/Tokyo")

TRANSCRIPT_META_RE = re.compile(r"^(speaker\s*\d+(\s+\d{2}:\d{2}(:\d{2})?)?|[\d:]{4,8})\s*$", re.IGNORECASE)
LEADING_NOISE_RE = re.compile(r"^(に|で|を|へ|と|あ、|あの、|えっと、|まあ、|その、|なんか、)\b")
FILLER_RE = re.compile(r"(えっと|あの|なんか|みたい|ちょっと|まあ|その|はい)")
CONVERSATIONAL_RE = re.compile(
    r"(ですかね|と思って|なんですけど|っていう|みたいな|どうですか|はい。|そうですね|じゃん|やんなきゃ|ください|ありますか)"
)
LOW_SIGNAL_UPDATE_RE = re.compile(r"(対応お願いします|アップしました|格納します|予告だけしておきます|貼ってもらえますか)")
NUMERIC_UPDATE_UPDATE_RE = re.compile(
    r"(?:\d{1,2}月.*?(?:対応ありがとうございます|対応お願いします|対応して|対応済み|対応しました|アップしました|提出しました|終了しました|完了しました|完了報告))"
    r"|(?:\d{1,2}日.*?(?:対応ありがとうございます|対応お願いします|対応して|対応済み|対応しました|アップしました|提出しました|終了しました|完了しました|完了報告))"
)
BUSINESS_SIGNAL_RE = re.compile(
    r"(承認|レビュー|チェック|完了|報告|リンク|運用|手順|投稿|配信|通知|対応|ボトルネック|課題|改善|検証|判定|差し戻し|手戻り|期限切れ|検証範囲)"
)
ACTION_WORD_RE = re.compile(r"(する|した|決め|確認|共有|修正|投稿|運用|統一|固定|検証|判定|報告|対応|定義|可視化|標準化|短縮|減らす)")
TOPIC_SEED_RULES = [
    (
        re.compile(r"(セッション切れ|セッション期限切れ)"),
        "セッション切れの原因検証が環境依存でぶれるため、修正候補ごとに再現条件を固定して確認する",
    ),
    (
        re.compile(r"(74アクセス|50と24|段階的に診断|リクエスト)"),
        "診断対象が74アクセスで一括対応だと遅延するため、変更範囲ごとに診断順を分割して進める",
    ),
    (
        re.compile(r"(全部終わってから|納品状態|手戻り)"),
        "部分診断の手戻りが発生しやすいため、納品相当の完了条件を満たしてから最終診断する",
    ),
    (
        re.compile(r"(3月中旬|前倒し|スケジュール|上旬に終わってる)"),
        "開発完了時期の見通しが曖昧なため、粗い日程でも期限付きで共有して判断を前倒しする",
    ),
    (
        re.compile(r"(ネットワーク診断|インフラ上|連携取りながら)"),
        "再現確認が環境連携待ちで止まりやすいため、検証担当と確認手順を先に固定して進める",
    ),
    (
        re.compile(r"(RAゲート|共通網|接続なし|要件)"),
        "共通網接続の要件解釈が曖昧なため、担当部門確認でRAゲートの判定基準を確定する",
    ),
    (
        re.compile(r"(ismp|脆弱性|対象外|完了報告|ノート)", re.IGNORECASE),
        "ISMP脆弱性対応の進捗が見えにくいため、週次判定とノート完了報告リンクを同じ流れで運用する",
    ),
    (
        re.compile(r"(通知|完了報告).*(気づ|漏れ|気づく)"),
        "通知投稿だけでは対応漏れが起きるため、完了報告テンプレとタグをセットで標準化する",
    ),
]
SAFE_FALLBACK_ACTIONS = [
    "判断条件を先に固定して運用する",
    "チェック項目を3点に絞って検証する",
    "完了報告テンプレを統一して再発を防ぐ",
    "担当と期限を明記して進捗を可視化する",
    "判定基準を1枚にまとめてレビューを短縮する",
    "例外時のエスカレーション手順を先に定義する",
    "通知文と完了報告文をセットで標準化する",
    "差し戻し条件を明文化して手戻りを減らす",
    "依存タスクを先に洗い出して着手順を固定する",
    "完了条件を数値で定義して判定ぶれを防ぐ",
    "レビュー観点を共通化して確認漏れを防止する",
    "報告先を一本化して情報の散逸を防ぐ",
    "対応ログの記載項目を固定して追跡可能にする",
    "週次の確認時刻を固定して滞留を早期検知する",
    "担当交代時の引き継ぎテンプレを標準化する",
    "承認待ちの条件を明文化して待機時間を短縮する",
]


@dataclass
class SeedItem:
    seed: str
    sprout: str
    tension_tag: str
    assumption: str
    process: list[str]
    source: str


def normalize_mode(raw: str) -> str:
    mode = (raw or "auto").strip().lower()
    if mode in {"auto", "llm", "local"}:
        return mode
    return "auto"


def run_claude(prompt: str, system_prompt: str, timeout: int) -> str:
    claude_bin = os.environ.get("CLAUDE_CODE_BIN", "claude")
    model = os.environ.get("CLAUDE_CODE_MODEL")
    agents = {
        "seed_factory": {
            "description": "seed_factory",
            "prompt": system_prompt.strip(),
        }
    }
    cmd = [
        claude_bin,
        "-p",
        "--agent",
        "seed_factory",
        "--agents",
        json.dumps(agents, ensure_ascii=False),
        "--output-format",
        "text",
    ]
    if model:
        cmd.extend(["--model", model])
    cmd.append(prompt)
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "claude failed")
    return result.stdout.strip()


def extract_json(text: str) -> list[dict]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```\\w*\\n?", "", cleaned)
        cleaned = re.sub(r"\\n?```$", "", cleaned)
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("no json array")
    return json.loads(cleaned[start : end + 1])


def compact_text(text: str, max_chars: int = 6000) -> str:
    text = text.strip()
    if len(text) <= max_chars:
        return text
    head = text[:4000]
    tail = text[-1500:]
    return f"{head}\n...\n{tail}"


def normalize_candidate_line(raw: str) -> str:
    line = " ".join(str(raw or "").split()).strip()
    line = re.sub(r"^Speaker\s*\d+\s+\d{2}:\d{2}(?::\d{2})?\s*", "", line, flags=re.IGNORECASE)
    line = re.sub(r"^[\-\*\#>\d\.\)\(]+\s*", "", line)
    line = re.sub(r"^(に|で|を|へ|と)(?=\d|[一-龥ぁ-んァ-ン])", "", line)
    line = re.sub(r"\s+", " ", line)
    return line.strip()


def is_transcript_meta_line(line: str) -> bool:
    if not line:
        return True
    if line in {"---", "..."}:
        return True
    if line.lower().startswith("file:"):
        return True
    return bool(TRANSCRIPT_META_RE.match(line))


def cleanup_spoken_noise(text: str) -> str:
    line = normalize_candidate_line(text)
    line = line.replace("，", "、")
    line = re.sub(r"(みたいな感じで|みたいな感じ)", "", line)
    line = re.sub(r"(^|[、。])\s*(えっと|あの|なんか|ちょっと|まあ|その)\s*", r"\1", line)
    line = re.sub(r"(、)?\s*はい$", "", line)
    line = re.sub(r"\s+", " ", line)
    return line.strip(" 、。")


def filler_count(text: str) -> int:
    return len(FILLER_RE.findall(text))


def is_low_signal_update_request(seed: str) -> bool:
    line = normalize_candidate_line(seed)
    raw = str(seed or "").strip()
    if not line:
        return True

    if NUMERIC_UPDATE_UPDATE_RE.search(raw):
        return True
    if NUMERIC_UPDATE_UPDATE_RE.search(line):
        return True

    if re.search(r"^\d{1,2}月.*(アップしました|対応お願いします)", raw):
        return True

    if re.search(r"^\d{1,2}月.*(アップしました|対応お願いします)", line):
        return True

    if re.search(r"^\d{1,2}日.*(アップしました|対応お願いします)", raw):
        return True

    if LOW_SIGNAL_UPDATE_RE.search(line) and (re.search(r"\d{1,2}月", line) or re.search(r"\d{1,2}日", line)):
        return True

    if LOW_SIGNAL_UPDATE_RE.search(raw) and (re.search(r"\d{1,2}月", raw) or re.search(r"\d{1,2}日", raw)):
        return True

    if re.search(r"対応.*お願いします", line):
        return True
    if line.endswith("お願いします") and not BUSINESS_SIGNAL_RE.search(line):
        return True
    if "対応お願いします" in line:
        return True
    if line in {"対応お願いします", "お願いします", "連絡します", "完了報告"}:
        return True
    return False


def seed_quality_score(seed: str) -> int:
    line = normalize_candidate_line(seed)
    if not line:
        return -100

    score = 0
    length = len(line)
    if 28 <= length <= 120:
        score += 4
    elif 20 <= length <= 150:
        score += 1
    else:
        score -= 4

    if BUSINESS_SIGNAL_RE.search(line):
        score += 4
    if ACTION_WORD_RE.search(line):
        score += 3
    if re.search(r"\d", line):
        score += 1

    score -= filler_count(line) * 2
    if "みたいな感じ" in line:
        score -= 4
    if LEADING_NOISE_RE.match(line):
        score -= 4
    if line.endswith("ですけど") or line.endswith("かな"):
        score -= 2
    if re.search(r"(かなと思|っていう|なんですけど|どうですかね)", line):
        score -= 3
    if line.count("、") >= 5:
        score -= 2
    return score


def is_semantic_seed(seed: str) -> bool:
    line = normalize_candidate_line(seed)
    if not line:
        return False
    if is_low_signal_update_request(line):
        return False
    if LEADING_NOISE_RE.match(line):
        return False
    if CONVERSATIONAL_RE.search(line):
        return False
    if filler_count(line) > 1:
        return False
    if not (32 <= len(line) <= 95):
        return False
    if line.count("、") > 3:
        return False
    if not BUSINESS_SIGNAL_RE.search(line):
        return False
    if not ACTION_WORD_RE.search(line):
        return False
    if "ため、" not in line and "：" not in line:
        return False
    return seed_quality_score(line) >= 7


def is_readable_seed(seed: str) -> bool:
    line = normalize_candidate_line(seed)
    if not line:
        return False
    if re.search(r"[a-z]{4,}[ぁ-んァ-ン一-龥]", line):
        return False
    if re.search(r"[A-Z][a-z]{3,}[ぁ-んァ-ン一-龥]", line):
        return False
    if re.search(r"(ため、).*(ため、)", line):
        return False
    if "：" in line and "ため、" in line:
        return False
    if line.endswith("はい"):
        return False
    if "、、" in line or "。。" in line:
        return False
    return True


def build_default_sprout(seed: str) -> str:
    core = normalize_candidate_line(seed)
    if not core:
        return "判断条件を運用ルールに落とし込む"
    issue = core
    if "ため、" in core:
        issue = core.split("ため、", 1)[0].strip(" 、。")
    return f"{issue[:56]}課題に対する運用ルールをテンプレ化する"


def normalize_process(process: Any, seed: str) -> list[str]:
    return build_local_process(seed)


def extract_semantic_candidates(excerpt: str) -> list[str]:
    lines: list[str] = []
    for raw in str(excerpt or "").splitlines():
        line = normalize_candidate_line(raw)
        if is_transcript_meta_line(line):
            continue
        if len(line) < 16:
            continue
        if line.startswith("```") or line.startswith("|"):
            continue
        if "http://" in line or "https://" in line:
            continue
        if is_low_signal_update_request(line):
            continue
        lines.append(line)

    merged = " ".join(lines)
    sentence_candidates: list[str] = []
    for sentence in re.split(r"[。！？]", merged):
        line = normalize_candidate_line(sentence)
        if is_transcript_meta_line(line):
            continue
        if 20 <= len(line) <= 150:
            sentence_candidates.append(line)

    return lines + sentence_candidates


def build_topic_seed_candidates(excerpt: str) -> list[str]:
    text = str(excerpt or "")
    picked: list[str] = []
    for pattern, seed in TOPIC_SEED_RULES:
        if not pattern.search(text):
            continue
        line = cleanup_spoken_noise(seed)
        if is_semantic_seed(line) and is_readable_seed(line):
            picked.append(line)

    seen: set[str] = set()
    unique: list[str] = []
    for line in picked:
        key = line.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(line)
    return unique


def score_candidate_line(line: str) -> int:
    score = seed_quality_score(line)
    if re.search(r"(課題|原因|前提|判断|手順|条件)", line):
        score += 2
    if re.search(r"(ので|ため|だから|結果)", line):
        score += 1
    return score


def source_excerpt_map(sources: list[tuple[Path, str]]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for path, excerpt in sources:
        mapping[str(path)] = excerpt
    return mapping


def repair_seed_from_excerpt(seed: str, excerpt: str) -> str:
    candidates = extract_semantic_candidates(excerpt)
    if not candidates:
        return cleanup_spoken_noise(seed)
    ranked = sorted(candidates, key=score_candidate_line, reverse=True)
    top = [cleanup_spoken_noise(c) for c in ranked[:8]]
    top = [c for c in top if c]
    if not top:
        return cleanup_spoken_noise(seed)

    issue_clauses = [c for c in top if re.search(r"(課題|不足|不明|遅れ|詰まり|ボトルネック|見づら|曖昧)", c)]
    action_clauses = [c for c in top if ACTION_WORD_RE.search(c)]
    if issue_clauses and action_clauses:
        issue = issue_clauses[0][:42].rstrip("、。")
        action = action_clauses[0][:40].rstrip("、。")
        merged = f"{issue}ため、{action}を固定して運用する"
        return cleanup_spoken_noise(merged)

    strong = [c for c in top if BUSINESS_SIGNAL_RE.search(c)]
    if strong:
        merged = "、".join(c.rstrip("、。") for c in strong[:2])
    else:
        merged = top[0]
    merged = merged[:86].rstrip("、。")
    if not ACTION_WORD_RE.search(merged):
        merged = f"{merged}を整理して判断条件を固定する"
    return cleanup_spoken_noise(merged)


def fallback_seed_from_excerpt(excerpt: str) -> str:
    text = str(excerpt or "")
    if "承認" in text and "完了報告" in text:
        return "承認から完了報告までの判定基準が曖昧で滞留するため、チェック条件と報告テンプレを固定する"
    if "スケジュール" in text and "出荷" in text:
        return "開発と運用のスケジュール境界が曖昧なため、出荷基準と依存関係を先に定義して進める"
    if "セッション" in text and "期限" in text:
        return "セッション期限切れの再発を防ぐため、検証範囲を固定して優先順位順に対応する"
    return "議事録の主要課題を1つに絞り、判断条件と次アクションを固定して運用する"


def expand_fallback_seed(base_seed: str, idx: int) -> str:
    action = SAFE_FALLBACK_ACTIONS[idx % len(SAFE_FALLBACK_ACTIONS)]
    base = cleanup_spoken_noise(base_seed)
    if "ため、" in base:
        reason = base.split("ため、", 1)[0].strip(" 、。")
        return f"{reason}ため、{action}"
    return f"{base.rstrip('。')}。{action}"


def build_safe_fallback_rows(
    sources: list[tuple[Path, str]],
    needed: int,
    existing_keys: set[str],
) -> list[dict]:
    rows: list[dict] = []
    variant_idx = 0
    for path, excerpt in sources:
        base = fallback_seed_from_excerpt(excerpt)
        for _ in range(max(needed * 2, 4)):
            seed = cleanup_spoken_noise(expand_fallback_seed(base, variant_idx))
            variant_idx += 1
            if not (is_semantic_seed(seed) and is_readable_seed(seed)):
                continue
            key = "".join(seed.split()).lower()
            if key in existing_keys:
                continue
            existing_keys.add(key)
            rows.append(
                {
                    "seed": seed,
                    "sprout": build_default_sprout(seed),
                    "tension_tag": infer_tension_tag(seed),
                    "assumption": infer_assumption(seed),
                    "process": build_local_process(seed),
                    "source": str(path),
                }
            )
            if len(rows) >= needed:
                return rows
    return rows


def rewrite_seed_with_llm(seed: str, source_excerpt: str, timeout: int) -> str:
    excerpt = compact_text(source_excerpt, max_chars=1800)
    prompt = f"""
文字起こし由来のseedを、意味を保ったまま運用で使える1文に整形してください。

元seed:
{seed}

参照抜粋:
{excerpt}

制約:
- 1文のみ（35〜90文字）
- 「何が問題か」と「どんな判断/行動を取るか」を含める
- 「なんか」「みたいな感じ」など口語ノイズは禁止
- 事実の追加は禁止
- 先頭を助詞や接続詞で始めない

出力: 整形後seedの1行のみ。
""".strip()
    system = "あなたはseed編集者。文字起こしノイズを除去し、意味が通る業務seedへ再構成する。"
    try:
        out = run_claude(prompt, system, max(20, min(timeout, 45)))
    except Exception:
        return ""
    first_line = next((line.strip() for line in out.splitlines() if line.strip()), "")
    return cleanup_spoken_noise(first_line)


def sanitize_seed_rows(
    rows: list[dict],
    sources: list[tuple[Path, str]],
    mode: str,
    llm_timeout: int,
) -> list[dict]:
    src_map = source_excerpt_map(sources)
    sanitized: list[dict] = []
    seen: set[str] = set()

    for row in rows:
        source = str(row.get("source", "")).strip()
        excerpt = src_map.get(source, "")
        seed_raw = str(row.get("seed", "")).strip()
        seed = cleanup_spoken_noise(seed_raw)

        if not is_semantic_seed(seed):
            rewritten = ""
            if mode != "local":
                rewritten = rewrite_seed_with_llm(seed, excerpt, llm_timeout)
            if rewritten and is_semantic_seed(rewritten):
                seed = rewritten
            else:
                seed = repair_seed_from_excerpt(seed, excerpt)
            if not is_semantic_seed(seed):
                fallback_seed = fallback_seed_from_excerpt(excerpt)
                seed = cleanup_spoken_noise(fallback_seed)
            if not is_semantic_seed(seed):
                continue
        if not is_readable_seed(seed):
            seed = cleanup_spoken_noise(fallback_seed_from_excerpt(excerpt))
            if not (is_semantic_seed(seed) and is_readable_seed(seed)):
                continue

        key = "".join(seed.split()).lower()
        if key in seen:
            continue
        seen.add(key)

        sprout = build_default_sprout(seed)

        sanitized.append(
            {
                "seed": seed,
                "sprout": sprout,
                "tension_tag": str(row.get("tension_tag", infer_tension_tag(seed))).strip() or infer_tension_tag(seed),
                "assumption": str(row.get("assumption", infer_assumption(seed))).strip() or infer_assumption(seed),
                "process": normalize_process(row.get("process"), seed),
                "source": source,
            }
        )
    return sanitized


def infer_tension_tag(line: str) -> str:
    if re.search(r"(失敗|詰ま|遅れ|止ま|できない|不足|欠落|エラー|不整合)", line):
        return "anxiety"
    if re.search(r"(逆|しかし|なのに|一方|矛盾|ギャップ)", line):
        return "contradiction"
    return "surprise"


def infer_assumption(line: str) -> str:
    if "承認" in line or "レビュー" in line:
        return "承認待ちの滞留が生産量を下げる前提で動いている"
    if "自動" in line or "スケジュール" in line or "投稿" in line:
        return "手作業より自動化の再現性を優先する前提で進めている"
    if re.search(r"(失敗|エラー|詰ま|不足)", line):
        return "失敗要因を先に潰せば出荷の再現性が上がる前提で進める"
    return "判断条件を先に固定すれば運用のブレが減る前提で進める"


def build_local_process(line: str) -> list[str]:
    snippet = line[:48]
    return [
        f"P-1 事実行「{snippet}」を議事録から再確認",
        "P-2 ボトルネック要因を1つに絞って分解",
        "P-3 次の実行手順を1つ決めて検証",
    ]


def build_local_seed_rows(sources: list[tuple[Path, str]], count: int) -> list[dict]:
    candidates: list[tuple[int, Path, str]] = []
    seen: set[str] = set()
    for path, excerpt in sources:
        for line in build_topic_seed_candidates(excerpt):
            key = line.lower()
            if key in seen:
                continue
            seen.add(key)
            candidates.append((score_candidate_line(line) + 12, path, line))

        for raw in extract_semantic_candidates(excerpt):
            line = cleanup_spoken_noise(raw)
            if not line:
                continue
            if is_low_signal_update_request(line):
                continue
            if not is_semantic_seed(line):
                line = repair_seed_from_excerpt(line, excerpt)
                line = cleanup_spoken_noise(line)
            if not (is_semantic_seed(line) and is_readable_seed(line)):
                continue
            key = line.lower()
            if key in seen:
                continue
            seen.add(key)

            score = score_candidate_line(line)
            candidates.append((score, path, line))

    if not candidates:
        for path, excerpt in sources:
            base = fallback_seed_from_excerpt(excerpt)
            for idx in range(4):
                fallback = cleanup_spoken_noise(expand_fallback_seed(base, idx))
                if not (is_semantic_seed(fallback) and is_readable_seed(fallback)):
                    continue
                key = fallback.lower()
                if key in seen:
                    continue
                seen.add(key)
                candidates.append((score_candidate_line(fallback), path, fallback))
                if len(candidates) >= max(count, 1):
                    break

    candidates.sort(key=lambda row: row[0], reverse=True)
    rows: list[dict] = []
    for _, path, line in candidates:
        sprout = build_default_sprout(line)
        rows.append(
            {
                "seed": line,
                "sprout": sprout,
                "tension_tag": infer_tension_tag(line),
                "assumption": infer_assumption(line),
                "process": build_local_process(line),
                "source": str(path),
            }
        )
        if len(rows) >= max(count, 1):
            break
    return rows


def default_meeting_roots() -> list[Path]:
    base = Path.home() / "workspace/projects"
    if not base.exists():
        return [base]
    roots = [p for p in base.glob("*/meetings") if p.is_dir()]
    extra = [
        base / "unson/meetings/mywa",
        base / "unson/meetings/unson-os",
    ]
    for path in extra:
        if path.exists():
            roots.append(path)
    return roots or [base]


def gather_meeting_files(roots: list[Path], days: int, max_files: int) -> list[Path]:
    cutoff = datetime.now(JST) - timedelta(days=days)
    candidates: list[Path] = []
    for root in roots:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix.lower() not in {".md", ".txt"}:
                continue
            if path.stat().st_mtime < cutoff.timestamp():
                continue
            candidates.append(path)
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[:max_files]


def build_prompt(sources: list[tuple[Path, str]], count: int) -> str:
    source_blocks = []
    for path, excerpt in sources:
        source_blocks.append(f"FILE: {path}\n{excerpt}")
    merged = "\n\n---\n\n".join(source_blocks)
    return f"""
以下の議事録から、X投稿/記事のseedを{count}個抽出してください。
seedは「AIに聞く前に紙に1行書く」レベルの濃い1行にすること。
必ず議事録に書かれている内容からのみ作る。捏造は禁止。
文字起こしの口語ノイズをそのまま転記せず、意味を保って要約すること。

出力はJSON配列のみ（コードフェンス禁止）。
各要素のフォーマット:
{{
  "seed": "1行の核",
  "sprout": "seedから芽にした具体方向（1行）",
  "tension_tag": "contradiction|anxiety|surprise",
  "assumption": "暗黙の前提（1行）",
  "process": ["P-1 ...", "P-2 ...", "P-3 ..."],
  "source": "元ファイルパス"
}}

seed品質ルール:
- 35〜100文字の1文
- 「何が問題か」+「どんな判断/行動を取るか」を含める
- 先頭を助詞/接続詞（に/で/あの/えっと等）で始めない
- 「なんか」「みたいな感じ」などの話し言葉は禁止
- 単なる引用ではなく、意味を残した編集文にする

議事録:
{merged}
""".strip()


def write_seed_log(out_dir: Path, items: list[SeedItem], date_str: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{date_str}_seed_sprout.md"
    lines = [
        "# seed_sprout_log",
        f"generated_at: {datetime.now(JST).isoformat()}",
        "",
    ]
    for idx, item in enumerate(items, 1):
        lines.append(f"## Pillar: auto (pillar_no={idx:03d})")
        lines.append(f"- sprout_id: {date_str}-{idx:03d}")
        lines.append(f"seed: {item.seed}")
        lines.append(f"sprout_selected: {item.sprout}")
        lines.append(f"tension_tag_editor: {item.tension_tag}")
        lines.append(f"assumption_editor: {item.assumption}")
        for step in item.process:
            lines.append(f"- {step}")
        lines.append(f"- source: {item.source}")
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--count", type=int, default=5)
    parser.add_argument("--max-files", type=int, default=6)
    parser.add_argument("--mode", default="auto")
    parser.add_argument("--llm-timeout", type=int, default=60)
    args = parser.parse_args()
    mode = normalize_mode(args.mode)

    roots = []
    env_roots = os.environ.get("MEETING_ROOTS")
    if env_roots:
        roots = [Path(p.strip()) for p in env_roots.split(",") if p.strip()]
    if not roots:
        roots = default_meeting_roots()

    files = gather_meeting_files(roots, args.days, args.max_files)
    if not files:
        raise SystemExit("meeting files not found")

    sources = []
    for path in files:
        text = path.read_text(encoding="utf-8", errors="ignore")
        sources.append((path, compact_text(text)))

    system_prompt = (
        "あなたはseed抽出担当。事実の範囲でseedを作る。"
        "曖昧な抽象語ではなく、議事録に基づいた1行にする。"
    )
    prompt = build_prompt(sources, args.count)
    data: list[dict]
    if mode == "local":
        data = build_local_seed_rows(sources, args.count)
    else:
        try:
            raw = run_claude(prompt, system_prompt, args.llm_timeout)
            data = extract_json(raw)
        except Exception as exc:
            if mode == "llm":
                raise
            print(f"WARN: seed_factory llm failed; fallback to local mode ({exc})")
            data = build_local_seed_rows(sources, args.count)

    data = sanitize_seed_rows(data, sources, mode, args.llm_timeout)

    if len(data) < args.count:
        fallback_data = build_local_seed_rows(sources, args.count)
        data = sanitize_seed_rows(data + fallback_data, sources, "local", args.llm_timeout)[: args.count]

    if len(data) < args.count:
        existing = {"".join(str(row.get("seed", "")).split()).lower() for row in data}
        safe_rows = build_safe_fallback_rows(sources, args.count - len(data), existing)
        data.extend(safe_rows)

    items: list[SeedItem] = []
    for row in data[: args.count]:
        seed = row.get("seed", "").strip()
        sprout = row.get("sprout", "").strip()
        if not seed or not sprout:
            continue
        items.append(
            SeedItem(
                seed=seed,
                sprout=sprout,
                tension_tag=row.get("tension_tag", "contradiction").strip(),
                assumption=row.get("assumption", "").strip(),
                process=row.get("process", []) if isinstance(row.get("process"), list) else [],
                source=row.get("source", ""),
            )
        )
    if not items:
        raise SystemExit("no seed rows generated")
    date_str = datetime.now(JST).strftime("%Y-%m-%d")
    write_seed_log(Path(args.out_dir), items, date_str)


if __name__ == "__main__":
    main()
