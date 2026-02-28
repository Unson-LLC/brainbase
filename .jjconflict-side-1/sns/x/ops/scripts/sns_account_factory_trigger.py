#!/usr/bin/env python3
from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(
        description="SNS Account Factory trigger (brainbase SSOT)",
    )
    parser.add_argument(
        "--goals",
        default="reply,profile",
        help="Comma-separated goals (reply,profile,follow). Default: reply,profile",
    )
    parser.add_argument(
        "--notes",
        default="",
        help="Optional notes for the run",
    )
    parser.add_argument(
        "--out",
        default="",
        help="Output trigger file path (default: _codex/sns/x/ops/triggers/ACCOUNT_FACTORY_YYYY-MM-DD.md)",
    )
    args = parser.parse_args()

    now = datetime.now()
    date = now.strftime("%Y-%m-%d")
    time = now.strftime("%H:%M")
    out = args.out or f"_codex/sns/x/ops/triggers/ACCOUNT_FACTORY_{date}.md"
    out_path = Path(out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    goals = [g.strip() for g in args.goals.split(",") if g.strip()]
    notes = args.notes.strip()

    content = "\n".join(
        [
            "# SNS Account Factory Trigger",
            "",
            f"- date: {date}",
            f"- time: {time}",
            f"- goals: {', '.join(goals) if goals else 'reply,profile'}",
            f"- notes: {notes if notes else '-'}",
            "",
            "## Required skill",
            "- sns-account-factory",
            "",
            "## Required SSOT updates",
            "- _codex/sns/x_account_profile.md (Promise/Proof/Path)",
            "- _codex/sns/x/00_line_charter.md (レーン/必須要素)",
            "- _codex/sns/x/ops/variety_gate.md (レーン条件)",
            "- _codex/sns/x/ops/runbook.md (日次運用)",
            "",
            "## Output expectation",
            "- Promise/Proof/Pathの更新案",
            "- レーン配分（今日/週）",
            "- SSOT差分の反映",
        ]
    )

    out_path.write_text(content)
    print(f"trigger written: {out_path}")


if __name__ == "__main__":
    main()
