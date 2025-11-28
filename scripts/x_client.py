#!/Users/ksato/workspace/.venv/bin/python
"""
X (Twitter) 投稿クライアント
OAuth 1.0a認証で画像付き投稿をサポート
"""

import os
import sys
from pathlib import Path

# .envファイルを読み込み
def load_env():
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    os.environ[key] = value

load_env()

try:
    import tweepy
except ImportError:
    print("Error: tweepy not installed. Run: pip install tweepy")
    sys.exit(1)


def get_client() -> tuple[tweepy.Client, tweepy.API]:
    """
    Tweepy v2 Client と v1.1 API を取得

    Returns:
        (v2_client, v1_api) のタプル
    """
    consumer_key = os.environ.get("X_CONSUMER_KEY")
    consumer_secret = os.environ.get("X_CONSUMER_SECRET")
    access_token = os.environ.get("X_ACCESS_TOKEN")
    access_token_secret = os.environ.get("X_ACCESS_TOKEN_SECRET")

    if not all([consumer_key, consumer_secret, access_token, access_token_secret]):
        raise ValueError("X API credentials not set in environment")

    # v2 Client (投稿用)
    client = tweepy.Client(
        consumer_key=consumer_key,
        consumer_secret=consumer_secret,
        access_token=access_token,
        access_token_secret=access_token_secret
    )

    # v1.1 API (メディアアップロード用)
    auth = tweepy.OAuth1UserHandler(
        consumer_key=consumer_key,
        consumer_secret=consumer_secret,
        access_token=access_token,
        access_token_secret=access_token_secret
    )
    api = tweepy.API(auth)

    return client, api


def upload_media(api: tweepy.API, image_path: str) -> str:
    """
    画像をアップロードしてmedia_idを取得

    Args:
        api: Tweepy v1.1 API
        image_path: 画像ファイルパス

    Returns:
        media_id文字列
    """
    if not Path(image_path).exists():
        raise FileNotFoundError(f"Image not found: {image_path}")

    media = api.media_upload(filename=image_path)
    return media.media_id_string


def post_tweet(
    text: str,
    image_path: str | None = None,
    dry_run: bool = False
) -> dict:
    """
    ツイートを投稿

    Args:
        text: 投稿テキスト（280文字以内推奨）
        image_path: 添付画像パス（省略可）
        dry_run: Trueの場合、投稿せずに内容を表示

    Returns:
        投稿結果の辞書
    """
    if dry_run:
        print("=" * 50)
        print("[DRY RUN] Would post:")
        print("-" * 50)
        print(text)
        if image_path:
            print(f"\n[Image: {image_path}]")
        print("=" * 50)
        return {"dry_run": True, "text": text, "image": image_path}

    client, api = get_client()

    media_ids = None
    if image_path:
        media_id = upload_media(api, image_path)
        media_ids = [media_id]
        print(f"Media uploaded: {media_id}")

    response = client.create_tweet(
        text=text,
        media_ids=media_ids
    )

    tweet_id = response.data["id"]
    tweet_url = f"https://x.com/i/web/status/{tweet_id}"

    print(f"Tweet posted: {tweet_url}")

    return {
        "success": True,
        "id": tweet_id,
        "url": tweet_url,
        "text": text
    }


def verify_credentials() -> dict:
    """認証情報を検証"""
    client, api = get_client()
    try:
        me = client.get_me()
        return {
            "valid": True,
            "id": me.data.id,
            "username": me.data.username,
            "name": me.data.name
        }
    except Exception as e:
        return {"valid": False, "error": str(e)}


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Post to X (Twitter)")
    parser.add_argument("text", nargs="?", help="Tweet text")
    parser.add_argument("-i", "--image", help="Image path")
    parser.add_argument("--dry-run", action="store_true", help="Don't actually post")
    parser.add_argument("--verify", action="store_true", help="Verify credentials")
    args = parser.parse_args()

    if args.verify:
        result = verify_credentials()
        if result["valid"]:
            print(f"Authenticated as: @{result['username']} ({result['name']})")
        else:
            print(f"Auth failed: {result['error']}")
        sys.exit(0 if result["valid"] else 1)

    if not args.text:
        parser.print_help()
        sys.exit(1)

    try:
        result = post_tweet(args.text, args.image, args.dry_run)
        if not args.dry_run and result.get("success"):
            print(f"Success: {result['url']}")
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
