#!/usr/bin/env python3
import argparse
import re
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path


FAIL_MARKERS = [
    "失敗",
    "止まっ",
    "詰ま",
    "やらか",
    "怖",
    "不安",
    "事故",
    "無理",
    "迷っ",
]

PROPER_NOUN_MARKERS = [
    "Claude",
    "NocoDB",
    "brainbase",
    "note",
    "X",
    "Slack",
    "Tactiq",
    "Notion",
    "Google",
    "AWS",
]


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


def tokenize(text: str):
    text = re.sub(r"[\\n\\r]", " ", text)
    parts = re.split(r"[\\s、。,.!！?？/（）()「」\"']", text)
    return [p for p in parts if p]


def jaccard(a, b):
    if not a or not b:
        return 0.0
    sa = set(a)
    sb = set(b)
    inter = len(sa & sb)
    union = len(sa | sb)
    return inter / union


def analyze_text(body: str):
    lines = [l for l in body.splitlines() if l.strip()]
    char_count = len(body.replace("\n", ""))
    line_count = len(lines)
    has_number = bool(re.search(r"\\d", body))
    has_first_person = "俺" in body or "私" in body or "自分" in body
    has_failure = any(m in body for m in FAIL_MARKERS)
    has_proper = any(m in body for m in PROPER_NOUN_MARKERS) or bool(re.search(r"[A-Za-z]{2,}", body))
    has_question = "?" in body or "？" in body
    cta_type = "none"
    if re.search(r"(コメント|教えて|どうしてる|意見|質問|型ある)", body):
        cta_type = "comment"
    elif re.search(r"(プロフィール|固定ポスト|リンク|note|詳細)", body):
        cta_type = "profile_or_link"
    elif has_question:
        cta_type = "question"
    return {
        "char_count": char_count,
        "line_count": line_count,
        "has_number": has_number,
        "has_first_person": has_first_person,
        "has_failure": has_failure,
        "has_proper": has_proper,
        "has_question": has_question,
        "cta_type": cta_type,
        "tokens": tokenize(body),
    }


def score_post(features, similarity, line_mode, char_band):
    score = 90
    issues = []
    if not features["has_first_person"]:
        score -= 10
        issues.append("一人称の存在感が弱い")
    if not features["has_number"]:
        score -= 8
        issues.append("数字がない")
    if not features["has_proper"]:
        score -= 6
        issues.append("固有名詞がない")
    if not features["has_failure"]:
        score -= 8
        issues.append("失敗や葛藤が弱い")
    if features["cta_type"] == "profile_or_link":
        score -= 10
        issues.append("CTAが強引")
    if features["line_count"] == line_mode:
        score -= 6
        issues.append("行数が量産型")
    if char_band[0] <= features["char_count"] <= char_band[1]:
        score -= 6
        issues.append("文字量が横並び")
    if similarity >= 0.35:
        score -= 12
        issues.append("内容の類似度が高い")
    score = max(30, min(100, score))
    return score, issues


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--date", default=str(date.today()))
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    posts = []
    for path in sorted(input_dir.glob("*.md")):
        text = path.read_text()
        fm, body = parse_frontmatter(text)
        post_id = fm.get("id", path.stem)
        body = body.strip()
        features = analyze_text(body)
        posts.append({"id": post_id, "body": body, "features": features})

    line_counts = [p["features"]["line_count"] for p in posts]
    char_counts = [p["features"]["char_count"] for p in posts]
    line_mode = Counter(line_counts).most_common(1)[0][0] if line_counts else 0
    if char_counts:
        median = sorted(char_counts)[len(char_counts) // 2]
        char_band = (median - 10, median + 10)
    else:
        char_band = (0, 0)

    # similarity
    tokens_list = [p["features"]["tokens"] for p in posts]
    max_sims = []
    for i, tokens in enumerate(tokens_list):
        sims = []
        for j, other in enumerate(tokens_list):
            if i == j:
                continue
            sims.append(jaccard(tokens, other))
        max_sims.append(max(sims) if sims else 0.0)

    results = []
    for p, sim in zip(posts, max_sims):
        score, issues = score_post(p["features"], sim, line_mode, char_band)
        fixes = []
        if "失敗や葛藤が弱い" in issues:
            fixes.append("具体的な詰まり or 失敗を1行足す")
        if "内容の類似度が高い" in issues:
            fixes.append("視点を反転させる（Before/Afterや誤解→回収）")
        if "CTAが強引" in issues:
            fixes.append("CTAを削るか本文と因果でつなぐ")
        if "行数が量産型" in issues or "文字量が横並び" in issues:
            fixes.append("行数を2行増やすか1行削る")
        if "数字がない" in issues:
            fixes.append("数値 or 回数を入れる")
        if "固有名詞がない" in issues:
            fixes.append("ツール名 or ファイル名を1つ入れる")
        if not fixes:
            fixes.append("最後の一文を強める")
        results.append(
            {
                "id": p["id"],
                "score": score,
                "pass": score >= 80,
                "diagnosis": issues or ["大きな破綻なし"],
                "fix": fixes[:2],
                "rewrite_hint": "一文を削って断定を強める" if score < 80 else "最後の1行を切れ味重視に",
                "similarity": round(sim, 2),
            }
        )

    md_path = out_dir / f"phase2_5_reviews_{args.date}_local.md"
    tbl_path = out_dir / f"qc_quality_{args.date}_local.md"

    lines = [f"# Phase 2.5 鬼編集長レビュー（Local） {args.date}", ""]
    for r in results:
        lines.append(f"## {r['id']}")
        lines.append("")
        lines.append(f"### スコア: {r['score']}点 / 100点")
        lines.append("")
        lines.append("### 判定")
        lines.append(f"- {'PASS' if r['pass'] else 'FAIL'}")
        lines.append("")
        lines.append("### 診断")
        for d in r["diagnosis"]:
            lines.append(f"- {d}")
        lines.append("")
        lines.append("### 修正指示")
        for f in r["fix"]:
            lines.append(f"- {f}")
        lines.append("")
        lines.append("### 1行ヒント")
        lines.append(r["rewrite_hint"])
        lines.append("")

    md_path.write_text("\n".join(lines))

    table = [
        f"# QC Quality Local {args.date}",
        "",
        "| id | score | result | diagnosis | similarity |",
        "| --- | ---: | :---: | --- | ---: |",
    ]
    for r in results:
        diag = "; ".join(r["diagnosis"])
        table.append(
            f"| {r['id']} | {r['score']} | {'PASS' if r['pass'] else 'FAIL'} | {diag} | {r['similarity']} |"
        )
    tbl_path.write_text("\n".join(table))


if __name__ == "__main__":
    main()
