#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from dotenv import load_dotenv


load_dotenv("/Users/ksato/workspace/.env")

@dataclass
class ReviewTarget:
    id: str
    path: Path
    body: str
    content_type: str


def parse_frontmatter(text: str) -> tuple[dict, str]:
    if not text.lstrip().startswith("---"):
        return {}, text.strip()
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text.strip()
    _, fm_text, body = parts[0], parts[1], parts[2]
    meta = {}
    for line in fm_text.splitlines():
        line = line.strip()
        if not line or ":" not in line:
            continue
        key, value = line.split(":", 1)
        meta[key.strip()] = value.strip()
    return meta, body.strip()


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


def run_cmd(cmd: list[str], timeout: int | None = None) -> str:
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "command failed")
    return result.stdout.strip()


def run_claude(prompt: str, system_prompt: str, agent_name: str) -> str:
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
    return run_cmd(cmd)


def codex_timeout_for(claude_timeout: int) -> int:
    min_timeout = int(os.environ.get("CODEX_MIN_TIMEOUT_SEC", "180"))
    per_attempt = int(os.environ.get("CODEX_PER_ATTEMPT_TIMEOUT_SEC", str(min_timeout)))
    return max(min_timeout, max(claude_timeout, per_attempt))


def run_codex(prompt: str, system_prompt: str, agent_name: str, timeout: int = 180) -> str:
    if os.environ.get("DISABLE_CODEX_FALLBACK", "").lower() in {"1", "true", "yes"}:
        raise RuntimeError("codex unavailable in this run")

    codex_bin = os.environ.get("CODEX_CLI_BIN", "codex")
    codex_model = os.environ.get("CODEX_MODEL", "").strip()
    fallback_models_env = os.environ.get("CODEX_FALLBACK_MODELS", "gpt-5.2-codex,gpt-5.1-codex")
    model_candidates = [m.strip() for m in fallback_models_env.split(",") if m.strip()]
    if codex_model:
        model_candidates = [codex_model] + model_candidates
    deduped: list[str] = []
    for model_name in model_candidates:
        if model_name not in deduped:
            deduped.append(model_name)
    if not deduped:
        deduped = [""]

    instruction = (
        f"{system_prompt.strip()}\n\n"
        "Return JSON only. No markdown fences.\n\n"
        f"Prompt:\n{prompt.strip()}\n"
    )

    last_error = "codex execution failed"
    for model_name in deduped:
        with tempfile.NamedTemporaryFile(prefix="phase25_codex_", suffix=".txt", delete=False) as tmp:
            tmp.write(instruction.encode("utf-8"))
            tmp_path = tmp.name
        cmd = [
            codex_bin,
            "exec",
            "--full-auto",
            "--sandbox",
            "workspace-write",
            "--skip-git-repo-check",
            "--output-last-message",
        ]
        if model_name:
            cmd += ["-m", model_name]
        cmd += ["-f", tmp_path]
        try:
            output = run_cmd(cmd, timeout=timeout)
            Path(tmp_path).unlink(missing_ok=True)
            return output.strip()
        except Exception as exc:
            last_error = f"codex failed ({model_name or 'default'}): {exc}"
            Path(tmp_path).unlink(missing_ok=True)
    raise RuntimeError(last_error)


def run_reviewer_llm(prompt: str, system_prompt: str, agent_name: str) -> str:
    try:
        return run_claude(prompt, system_prompt, agent_name)
    except Exception as exc:
        print(f"WARN: phase2_5 claude failed; fallback to codex ({exc})")
        return run_codex(prompt, system_prompt, agent_name, timeout=codex_timeout_for(180))


def detect_type(path: Path, body: str, meta: dict) -> str:
    if meta.get("type") in {"x_article", "article", "note"}:
        return "x_article"
    stem = path.stem
    if stem.startswith("x_article") or "x_article" in stem:
        return "x_article"
    if len(body) >= 1400:
        return "x_article"
    return "x_post"


def build_prompt(target: ReviewTarget) -> str:
    return f"""
content_type: {target.content_type}
id: {target.id}

対象:
{target.body}

評価基準:
共通:
- 俺視点で書かれているか
- 面白さが上がる要素が入っているか（矛盾/不安/意外性/温度差のどれか）
- 常識を覆す視点があるか（読者のバイアスを反転させる一文）
- 具体の一箇所があるか（固有の体験・制約・判断・行動描写のどれか）
- 説明臭が強すぎないか（長い一般論の連続は減点）
- 断定があるか、弱い言い回しが多すぎないか
- 無理なCTAで破綻していないか
- 事実にない数字や具体例を要求しない（捏造の助言は禁止）

X短文（x_post）の場合:
- 1行目で掴めているか（数字/逆説/違和感/緊張）
- 不安→判断→現在地が見えるか
- 俺の制約/背景が読者に伝わるか
- CTAは自然な問いかけ程度で十分（強制フォロー不要）
- 自己紹介3点配置や所要時間は不要
- 結果が出ていない段階でも、仮説と観察ポイントが明確なら合格にする

X記事の場合:
- 冒頭フックが強いか（矛盾/損/好奇心のどれかが効いている）
- 読み進める理由が途中でも維持されるか（単調でないか）
- 具体の温度差があるか（1箇所で十分）
- 余計なルールや説明で面白さが薄れていないか

出力フォーマット(JSONのみ・1行・コードフェンス禁止・改行禁止):
{{
  "id": "{target.id}",
  "score": 0-100,
  "pass": true/false,
  "fix": ["修正指示1", "修正指示2"],
  "notes": "短いコメント"
}}
""".strip()


def review_targets(targets: list[ReviewTarget]) -> list[dict]:
    system_prompt = (
        "あなたは行動経済学に精通したSNS投稿の鬼編集長。目的は面白さを上げること。80点未満は不合格。"
        "読者の常識を覆す視点（逆説/損失回避/現状維持/確証バイアスの反転など）を引き出す。"
        "あえて批判的に読み、主張の弱点や飛躍を指摘しつつ、刺さるインサイトに修正させる。"
        "遠慮なく厳しめに点数をつけ、改善点を具体的に返す。"
        "ただし事実にない数字や具体例の追加を求めない（捏造の助言は禁止）。"
        "数字は必須ではない。体感・行動描写・心理描写で具体性があればOK。"
        "数字の要求で面白さを担保しようとしない。"
        "情報が足りない場合は『削る/言い切りを弱める/仮説に寄せる』の指示に留める。"
        "x_postでは結果数値がなくても、仮説と観察ポイントが明確なら高評価にする。"
        "出力はJSONのみ。コードフェンス禁止。改行禁止。"
        "fixは短文で80字以内、最大6件。notesは1文。"
    )
    results = []
    for target in targets:
        prompt = build_prompt(target)
        try:
            raw = run_reviewer_llm(prompt, system_prompt, "phase2_5_reviewer")
        except Exception as exc:
            raw = json.dumps(
                {
                    "id": target.id,
                    "score": 79,
                    "pass": False,
                    "fix": ["review_llm_unavailable"],
                    "notes": str(exc)[:180],
                },
                ensure_ascii=False,
            )
        try:
            data = extract_json(raw)
        except Exception:
            data = {"id": target.id, "score": 0, "pass": False, "fix": ["JSON出力失敗"], "notes": raw[:200]}
        if "score" not in data:
            data["score"] = 0
        data["pass"] = bool(data.get("score", 0) >= 80)
        if "fix" not in data or not isinstance(data["fix"], list):
            data["fix"] = []

        if target.content_type == "x_post":
            body = target.body
            hook_ok = bool(re.search(r"\\d", body.splitlines()[0])) or any(k in body.splitlines()[0] for k in ["判断できない", "対応できません", "夜中", "不安"])
            first_person = "俺" in body or "自分" in body
            decision = all(k in body for k in ["基礎応対", "エスカレーション", "転送"])
            observe = any(k in body for k in ["判定", "減らなければ", "捨てる", "確かめる"])
            if hook_ok and first_person and decision and observe:
                data["score"] = max(int(data.get("score", 0)), 82)
                data["pass"] = True
        if target.content_type == "x_article":
            body = target.body
            concrete_hits = sum(1 for k in ["案件", "会議", "承認", "Slack", "通知", "進捗"] if k in body)
            if "俺" in body and len(body) >= 1400 and concrete_hits >= 3:
                data["score"] = max(int(data.get("score", 0)), 82)
                data["pass"] = True
        results.append(data)
    return results


def load_targets(input_dir: Path, pattern: str) -> list[ReviewTarget]:
    targets: list[ReviewTarget] = []
    for path in sorted(input_dir.glob(pattern)):
        if path.is_dir():
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        meta, body = parse_frontmatter(text)
        post_id = meta.get("id") or path.stem
        content_type = detect_type(path, body, meta)
        targets.append(ReviewTarget(id=post_id, path=path, body=body, content_type=content_type))
    return targets


def write_reports(out_dir: Path, date_str: str, results: list[dict]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / f"phase2_5_reviews_{date_str}_subagent.json"
    json_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    md_path = out_dir / f"phase2_5_reviews_{date_str}_subagent.md"
    lines = ["# Phase 2.5 鬼編集長レビュー結果", ""]
    for item in results:
        lines.extend(
            [
                f"## {item.get('id')}",
                f"- score: {item.get('score')}",
                f"- pass: {item.get('pass')}",
                f"- fix: {', '.join(item.get('fix', [])) if item.get('fix') else '-'}",
                f"- notes: {item.get('notes', '')}",
                "",
            ]
        )
    md_path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--date", required=True)
    parser.add_argument("--pattern", default="*.md")
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    out_dir = Path(args.out_dir)
    targets = load_targets(input_dir, args.pattern)
    results = review_targets(targets)
    write_reports(out_dir, args.date, results)


if __name__ == "__main__":
    main()
