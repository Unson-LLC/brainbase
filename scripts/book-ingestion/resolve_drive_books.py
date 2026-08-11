#!/usr/bin/env python3
"""Resolve the approved team-book manifest to Drive PDF metadata."""

from __future__ import annotations

import json
import subprocess
import sys
import unicodedata
import argparse
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "docs/internal/book-ingestion/manifest.yml"


def normalized(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold()
    return "".join(ch for ch in value if ch.isalnum())


def search(account: str, title: str) -> list[dict]:
    command = [
        "gog", "drive", "search", title,
        "--account", account,
        "--readonly", "--no-input", "--json", "--max", "50",
    ]
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    return json.loads(result.stdout).get("files", [])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    manifest = yaml.safe_load(MANIFEST.read_text())
    account = manifest["account"]
    source_owner = manifest["source_owner"]
    resolved = []
    failures = []
    for entry in manifest["books"]:
        title = entry["title"]
        drive_title = entry.get("drive_title", title)
        wanted = normalized(drive_title)
        candidates = [f for f in search(account, drive_title) if f.get("mimeType") == "application/pdf"]
        matches = [
            f for f in candidates
            if wanted in normalized(Path(f["name"]).stem)
            or normalized(Path(f["name"]).stem) in wanted
        ]
        owned = [
            f for f in matches
            if source_owner in [owner.get("emailAddress") for owner in f.get("owners", [])]
        ]
        selected = owned if owned else matches
        if len(selected) != 1:
            failures.append({"title": title, "matches": len(selected), "candidates": candidates})
            continue
        file = selected[0]
        resolved.append({
            **{key: value for key, value in entry.items() if key != "drive_title"},
            "file_id": file["id"],
            "file_name": file["name"],
            "size": int(file.get("size", 0)),
            "modified_time": file.get("modifiedTime"),
            "web_view_link": file.get("webViewLink"),
            "owners": [owner.get("emailAddress") for owner in file.get("owners", [])],
        })
    payload = {"account": account, "resolved": resolved, "failures": failures}
    rendered = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(rendered)
    sys.stdout.write(rendered)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
