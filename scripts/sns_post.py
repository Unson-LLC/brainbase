#!/Users/ksato/workspace/.venv/bin/python
"""
SNS投稿ワンストップ処理
投稿文生成 → 画像生成 → X投稿
"""

import os
import sys
import json
import argparse
from pathlib import Path
from datetime import datetime

# プロジェクトルートをパスに追加
sys.path.insert(0, str(Path(__file__).parent))

from nano_banana import generate_infographic, generate_from_sns_content
from x_client import post_tweet, verify_credentials


def create_infographic_prompt(title: str, points: list[str]) -> str:
    """インフォグラフィック用のプロンプトを構築"""
    return f"""
タイトル: {title}

ポイント:
{chr(10).join(f'- {p}' for p in points)}
"""


def post_with_infographic(
    title: str,
    body: str,
    points: list[str] | None = None,
    dry_run: bool = False,
    skip_image: bool = False,
    image_path: str | None = None
) -> dict:
    """
    インフォグラフィック付きでX投稿

    Args:
        title: 投稿タイトル（フック）
        body: 投稿本文
        points: インフォグラフィック用ポイント（省略時は本文から抽出）
        dry_run: 投稿せずに確認のみ
        skip_image: 画像生成をスキップ
        image_path: 既存の画像を使用する場合のパス

    Returns:
        処理結果
    """
    result = {
        "title": title,
        "body": body,
        "timestamp": datetime.now().isoformat()
    }

    # 投稿テキスト構築（280文字制限を考慮）
    tweet_text = body
    if len(tweet_text) > 280:
        tweet_text = tweet_text[:277] + "..."
        print(f"Warning: Text truncated to 280 chars")

    result["tweet_text"] = tweet_text

    # 画像生成
    if not skip_image and image_path is None:
        try:
            print("Generating infographic...")
            if points:
                image_path = generate_infographic(
                    topic=title,
                    points=points
                )
            else:
                image_path = generate_from_sns_content(
                    title=title,
                    body=body
                )
            result["image_path"] = image_path
            print(f"Image generated: {image_path}")
        except Exception as e:
            print(f"Warning: Image generation failed: {e}")
            result["image_error"] = str(e)
            image_path = None

    # X投稿
    if dry_run:
        print("\n" + "=" * 60)
        print("[DRY RUN] Would post to X:")
        print("-" * 60)
        print(tweet_text)
        if image_path:
            print(f"\n[Image: {image_path}]")
        print("=" * 60)
        result["dry_run"] = True
    else:
        try:
            post_result = post_tweet(
                text=tweet_text,
                image_path=image_path
            )
            result["post_result"] = post_result
            result["success"] = True
            url = post_result.get('url', 'unknown')
            print(f"\nPosted: {url}")

            # 投稿ログに記録
            log_post(url=url, topic=title)
        except Exception as e:
            result["post_error"] = str(e)
            result["success"] = False
            print(f"Post failed: {e}")

    return result


def log_post(url: str, topic: str, template: str = "infographic"):
    """投稿をログに記録"""
    log_path = Path(__file__).parent.parent / "_codex" / "sns" / "post_log.md"

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    log_entry = f"| {timestamp} | {url} | {topic} | {template} |\n"

    with open(log_path, "a") as f:
        f.write(log_entry)

    print(f"Logged: {topic}")


def save_draft(title: str, body: str, points: list[str] | None = None):
    """ドラフトを保存"""
    drafts_dir = Path(__file__).parent.parent / "_codex" / "sns" / "drafts"
    drafts_dir.mkdir(parents=True, exist_ok=True)

    date_str = datetime.now().strftime("%Y-%m-%d")
    draft_path = drafts_dir / f"{date_str}_draft.md"

    content = f"""# SNS Draft - {date_str}

## {title}

{body}

"""
    if points:
        content += "### Points for Infographic\n"
        for p in points:
            content += f"- {p}\n"

    # 追記モード
    mode = "a" if draft_path.exists() else "w"
    with open(draft_path, mode) as f:
        if mode == "a":
            f.write("\n---\n\n")
        f.write(content)

    print(f"Draft saved: {draft_path}")
    return str(draft_path)


def main():
    parser = argparse.ArgumentParser(
        description="SNS投稿ワンストップ処理（インフォグラフィック付き）"
    )
    parser.add_argument("--title", "-t", required=True, help="投稿タイトル")
    parser.add_argument("--body", "-b", required=True, help="投稿本文")
    parser.add_argument("--points", "-p", nargs="+", help="インフォグラフィック用ポイント")
    parser.add_argument("--dry-run", action="store_true", help="投稿せずに確認")
    parser.add_argument("--skip-image", action="store_true", help="画像生成をスキップ")
    parser.add_argument("--image", "-i", help="既存の画像ファイルを使用")
    parser.add_argument("--save-draft", action="store_true", help="ドラフトとして保存")
    parser.add_argument("--verify", action="store_true", help="認証確認のみ")
    parser.add_argument("--json", action="store_true", help="結果をJSON出力")

    args = parser.parse_args()

    if args.verify:
        result = verify_credentials()
        if args.json:
            print(json.dumps(result))
        elif result["valid"]:
            print(f"Authenticated: @{result['username']}")
        else:
            print(f"Auth failed: {result['error']}")
        sys.exit(0 if result.get("valid") else 1)

    if args.save_draft:
        save_draft(args.title, args.body, args.points)
        sys.exit(0)

    result = post_with_infographic(
        title=args.title,
        body=args.body,
        points=args.points,
        dry_run=args.dry_run,
        skip_image=args.skip_image,
        image_path=args.image
    )

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
