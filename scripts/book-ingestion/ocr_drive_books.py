#!/usr/bin/env python3
"""OCR image-only Drive books into a temporary, resumable local cache.

The OCR output is intentionally kept outside the repository. Only the compact
status report (method, coverage and hashes) may be used as provenance for
derived team knowledge.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import re
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / "docs/internal/book-ingestion/extraction-report.json"
PDF_CACHE = Path("/private/tmp/brainbase-team-book-pdfs")
OCR_CACHE = Path("/private/tmp/brainbase-team-book-ocr")
VISION_BINARY = Path("/private/tmp/brainbase-vision-ocr")
DEFAULT_STATUS = ROOT / "docs/internal/book-ingestion/ocr-status.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def compile_vision_ocr() -> None:
    source = ROOT / "scripts/book-ingestion/vision_ocr.swift"
    if VISION_BINARY.exists() and VISION_BINARY.stat().st_mtime >= source.stat().st_mtime:
        return
    subprocess.run([
        "swiftc", "-framework", "Vision", "-framework", "AppKit",
        str(source), "-o", str(VISION_BINARY),
    ], check=True)


def pdf_for(index: int) -> Path:
    matches = sorted(PDF_CACHE.glob(f"{index:02d}-*.pdf"))
    if len(matches) != 1:
        raise RuntimeError(f"expected one cached PDF for index {index}, found {len(matches)}")
    return matches[0]


def japanese_characters(value: str) -> int:
    return len(re.findall(r"[\u3040-\u30ff\u3400-\u9fff]", value))


def ocr_page(pdf: Path, book_dir: Path, page: int, dpi: int) -> tuple[int, int]:
    output = book_dir / f"{page:04d}.txt"
    if output.exists() and output.stat().st_size:
        return page, output.stat().st_size
    with tempfile.TemporaryDirectory(prefix="brainbase-ocr-") as temporary:
        image_base = Path(temporary) / "page"
        subprocess.run([
            "pdftoppm", "-f", str(page), "-l", str(page), "-singlefile",
            "-jpeg", "-r", str(dpi), str(pdf), str(image_base),
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        vision = subprocess.run(
            [str(VISION_BINARY), str(image_base.with_suffix(".jpg"))],
            check=True, capture_output=True, text=True,
        ).stdout
        # Vision is fast and strong on horizontal text and diagrams, but can
        # omit the vertical body columns in Kindle screenshots. Fall back to
        # Tesseract's Japanese vertical model when Vision found little prose.
        selected = vision
        if japanese_characters(vision) < 180:
            vertical = subprocess.run([
                "tesseract", str(image_base.with_suffix(".jpg")), "stdout",
                "-l", "jpn_vert+eng", "--psm", "5",
            ], check=True, capture_output=True, text=True).stdout
            if japanese_characters(vertical) > japanese_characters(vision) * 1.25:
                selected = vertical
    temporary_output = output.with_suffix(".tmp")
    temporary_output.write_text(selected, encoding="utf-8")
    temporary_output.replace(output)
    return page, output.stat().st_size


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--dpi", type=int, default=180)
    parser.add_argument("--book", type=int, action="append", help="1-based manifest index")
    parser.add_argument("--limit-pages", type=int, help="quality/speed sampling only")
    parser.add_argument("--refresh", action="store_true", help="recheck cached pages")
    parser.add_argument("--status-out", type=Path, default=DEFAULT_STATUS)
    args = parser.parse_args()
    compile_vision_ocr()
    OCR_CACHE.mkdir(parents=True, exist_ok=True)
    books = json.loads(REPORT.read_text())["books"]
    selected = set(args.book or range(1, len(books) + 1))
    existing_status = []
    if args.status_out.exists():
        existing_status = json.loads(args.status_out.read_text()).get("books", [])
    status = {book["index"]: book for book in existing_status}
    for index, book in enumerate(books, start=1):
        if index not in selected or not book["needs_ocr_review"]:
            continue
        pdf = pdf_for(index)
        book_dir = OCR_CACHE / f"{index:02d}"
        book_dir.mkdir(exist_ok=True)
        last_page = min(book["pages"], args.limit_pages or book["pages"])
        pages = list(range(1, last_page + 1))
        if args.refresh:
            for path in book_dir.glob("[0-9][0-9][0-9][0-9].txt"):
                if japanese_characters(path.read_text(encoding="utf-8")) < 180:
                    path.unlink()
        print(f"[{index:02d}] {book['title']}: {last_page} pages", flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = [pool.submit(ocr_page, pdf, book_dir, page, args.dpi) for page in pages]
            completed = 0
            for future in concurrent.futures.as_completed(futures):
                future.result()
                completed += 1
                if completed % 25 == 0 or completed == len(pages):
                    print(f"  {completed}/{len(pages)}", flush=True)
        page_files = sorted(
            path for path in book_dir.glob("[0-9][0-9][0-9][0-9].txt")
            if path.stem.isdigit()
        )
        combined = book_dir / "book.txt"
        combined.write_text("\n".join(
            f"\n--- PAGE {int(path.stem)} ---\n{path.read_text(encoding='utf-8')}"
            for path in page_files
        ), encoding="utf-8")
        status[index] = {
            "index": index,
            "title": book["title"],
            "method": "hybrid macOS Vision plus Tesseract jpn_vert fallback at 180 dpi",
            "pages_ocrd": len(page_files),
            "source_pages": book["pages"],
            "characters": len(combined.read_text(encoding="utf-8")),
            "sha256": sha256(combined),
        }
        args.status_out.parent.mkdir(parents=True, exist_ok=True)
        args.status_out.write_text(
            json.dumps({"books": [status[key] for key in sorted(status)]}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
