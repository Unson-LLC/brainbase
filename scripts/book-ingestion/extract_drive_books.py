#!/usr/bin/env python3
"""Download resolved PDFs to a temporary cache and measure embedded text."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import unicodedata
from pathlib import Path

import pdfplumber


ROOT = Path(__file__).resolve().parents[2]
RESOLVED = ROOT / "docs/internal/book-ingestion/resolved.json"


def slug(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return "-".join("".join(ch if ch.isalnum() else " " for ch in normalized).split())[:100]


def digest(path: Path) -> str:
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


def download(account: str, file_id: str, output: Path) -> None:
    if output.exists() and output.stat().st_size:
        return
    subprocess.run([
        "gog", "drive", "download", file_id,
        "--account", account, "--readonly", "--no-input",
        "--out", str(output),
    ], check=True)


def inspect_pdf(path: Path) -> dict:
    page_chars = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            page_chars.append(len((page.extract_text() or "").strip()))
    sparse = [index + 1 for index, count in enumerate(page_chars) if count < 40]
    return {
        "pages": len(page_chars),
        "characters": sum(page_chars),
        "text_pages": sum(count >= 40 for count in page_chars),
        "sparse_pages": sparse,
        "needs_ocr_review": len(page_chars) > 0 and len(sparse) / len(page_chars) > 0.2,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path, default=Path("/private/tmp/brainbase-team-book-pdfs"))
    parser.add_argument("--out", type=Path, default=ROOT / "docs/internal/book-ingestion/extraction-report.json")
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    source = json.loads(RESOLVED.read_text())
    reports = []
    for index, book in enumerate(source["resolved"], start=1):
        output = args.cache / f"{index:02d}-{slug(book['title'])}.pdf"
        print(f"[{index:02d}/38] {book['title']}", flush=True)
        download(source["account"], book["file_id"], output)
        reports.append({
            **book,
            "sha256": digest(output),
            "extraction_method": "pdfplumber_embedded_text",
            **inspect_pdf(output),
        })
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps({"books": reports}, ensure_ascii=False, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
