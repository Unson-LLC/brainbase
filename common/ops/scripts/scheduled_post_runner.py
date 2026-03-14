#!/usr/bin/env python3
"""予約投稿ランナー - scheduled_posts.ymlに基づいて投稿を実行"""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml

JST = ZoneInfo("Asia/Tokyo")
TOLERANCE_MINUTES = 20  # ±20分の範囲でマッチ
PYTHON_PATH = Path.home() / "workspace/.venv/bin/python"
SCRIPT_DIR = Path(__file__).parent


def load_schedule(path: Path) -> dict:
    """YAMLファイルを読み込む"""
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def save_schedule(path: Path, data: dict):
    """YAMLファイルを保存（元のフォーマットをできるだけ維持）"""
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(
            data,
            f,
            allow_unicode=True,
            default_flow_style=False,
            sort_keys=False,
            width=1000,  # 改行を減らす
        )


def parse_scheduled_time(scheduled_str: str) -> datetime:
    """ISO形式の日時文字列をdatetimeに変換"""
    # Python 3.11+ の fromisoformat はタイムゾーン付きも対応
    dt = datetime.fromisoformat(scheduled_str)
    # タイムゾーンがない場合はJSTとして扱う
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=JST)
    return dt


def extract_image_template(image_path: str | None) -> str | None:
    """画像ファイル名からテンプレート名を推定（gap_20260101... -> gap）"""
    if not image_path:
        return None
    name = Path(image_path).stem
    if not name:
        return None
    return name.split("_", 1)[0] if "_" in name else name


def find_consecutive_template_conflicts(posts: list) -> list:
    """連続で同じテンプレートが並ぶ投稿を検出（投稿前の警告用）"""
    items = []
    for post in posts:
        status = post.get("status")
        if status in ("posted", "skipped"):
            continue
        scheduled_str = post.get("scheduled_at")
        if not scheduled_str:
            continue
        try:
            scheduled = parse_scheduled_time(scheduled_str)
        except ValueError:
            continue
        template = extract_image_template(post.get("image"))
        if not template:
            continue
        items.append((scheduled, post, template))

    items.sort(key=lambda x: x[0])
    conflicts = []
    prev = None
    for scheduled, post, template in items:
        if prev and template == prev[2]:
            conflicts.append((prev[1], post, template))
        prev = (scheduled, post, template)
    return conflicts


def find_same_day_template_conflicts(posts: list) -> list:
    """同日に同テンプレが複数ある投稿を検出（投稿前のブロック用）"""
    by_day = {}
    for post in posts:
        status = post.get("status")
        if status in ("posted", "skipped"):
            continue
        scheduled_str = post.get("scheduled_at")
        if not scheduled_str:
            continue
        try:
            scheduled = parse_scheduled_time(scheduled_str)
        except ValueError:
            continue
        template = extract_image_template(post.get("image"))
        if not template:
            continue
        day_key = scheduled.date().isoformat()
        by_day.setdefault(day_key, {}).setdefault(template, []).append(post)

    conflicts = []
    for day_key, templates in by_day.items():
        for template, posts in templates.items():
            if len(posts) > 1:
                conflicts.append((day_key, template, posts))
    return conflicts


def find_posts_to_publish(posts: list, force_id: str = None, now: datetime = None) -> list:
    """投稿すべきポストを検索"""
    if now is None:
        now = datetime.now(JST)
    to_publish = []

    for post in posts:
        # 強制投稿ID指定
        if force_id and post.get("id") == force_id:
            to_publish.append(post)
            continue

        # force_idが指定されていて、このpostが対象でなければスキップ
        if force_id:
            continue

        # status: posted/skipped は対象外
        status = post.get("status")
        if status in ("posted", "skipped"):
            continue

        # status: ready または pending が対象
        # (pendingでも時刻が来れば投稿される)
        if status not in ("ready", "pending"):
            continue

        # 時刻チェック（現在時刻から±TOLERANCE_MINUTESの範囲）
        scheduled_str = post.get("scheduled_at")
        if not scheduled_str:
            continue

        try:
            scheduled = parse_scheduled_time(scheduled_str)
        except ValueError as e:
            print(f"Warning: Invalid scheduled_at format for {post.get('id')}: {e}")
            continue

        diff_seconds = abs((now - scheduled).total_seconds())

        if diff_seconds <= TOLERANCE_MINUTES * 60:
            to_publish.append(post)

    return to_publish


def execute_post(post: dict, dry_run: bool = False) -> dict:
    """sns_post.pyを呼び出して投稿"""
    script = SCRIPT_DIR / "sns_post.py"

    # タイトルと本文を取得
    title = post.get("title", "")
    body = post.get("body", "").strip()

    cmd = [
        str(PYTHON_PATH),
        str(script),
        "--title", title,
        "--body", body,
        "--json",  # JSON出力を有効化
    ]

    # 画像がある場合
    image_path = post.get("image")
    if image_path:
        resolved_image_path = Path(image_path).expanduser()
        if resolved_image_path.exists():
            cmd.extend(["--image", str(resolved_image_path)])

    if dry_run:
        cmd.append("--dry-run")

    print(f"Executing: {' '.join(cmd[:6])}...")  # コマンドの一部を表示

    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"STDERR: {result.stderr}")
        raise RuntimeError(f"投稿失敗: {result.stderr or result.stdout}")

    print(f"STDOUT: {result.stdout}")

    # JSON出力をパース
    posted_at = datetime.now(JST).isoformat()
    posted_url = ""

    try:
        # 出力からJSONを探す
        for line in result.stdout.splitlines():
            line = line.strip()
            if line.startswith("{"):
                data = json.loads(line)
                posted_url = data.get("url", "")
                break
    except json.JSONDecodeError:
        # JSONパース失敗時はURL抽出を試みる
        for line in result.stdout.splitlines():
            if "https://x.com" in line or "https://twitter.com" in line:
                # URLを抽出
                import re
                urls = re.findall(r'https://[^\s"\']+', line)
                if urls:
                    posted_url = urls[0]
                    break

    return {"url": posted_url, "posted_at": posted_at}


def set_github_output(name: str, value: str):
    """GitHub Actions出力を設定"""
    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a") as f:
            # 複数行対応
            if "\n" in str(value):
                delimiter = "EOF"
                f.write(f"{name}<<{delimiter}\n{value}\n{delimiter}\n")
            else:
                f.write(f"{name}={value}\n")
    else:
        # ローカル実行時は標準出力
        print(f"OUTPUT: {name}={value}")


def git_commit_and_push(path: Path, message: str, dry_run: bool = False):
    """変更をコミット＆プッシュ"""
    repo_root = path.parent
    # リポジトリルートを見つける
    while repo_root != repo_root.parent:
        if (repo_root / ".git").exists():
            break
        repo_root = repo_root.parent

    if dry_run:
        print(f"[DRY-RUN] Would commit: {message}")
        return

    try:
        # git add
        subprocess.run(
            ["git", "add", str(path)],
            cwd=repo_root,
            check=True,
            capture_output=True,
        )

        # git commit
        result = subprocess.run(
            ["git", "commit", "-m", message],
            cwd=repo_root,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            if "nothing to commit" in result.stdout or "nothing to commit" in result.stderr:
                print("No changes to commit")
                return
            raise RuntimeError(f"git commit failed: {result.stderr}")

        # git push
        subprocess.run(
            ["git", "push"],
            cwd=repo_root,
            check=True,
            capture_output=True,
        )
        print(f"Committed and pushed: {message}")
    except subprocess.CalledProcessError as e:
        print(f"Git operation failed: {e}")
        raise


def main():
    parser = argparse.ArgumentParser(description="予約投稿ランナー")
    parser.add_argument("--schedule-file", required=True, help="スケジュールファイルパス")
    parser.add_argument("--force-id", help="強制投稿するpost ID")
    parser.add_argument("--dry-run", action="store_true", help="投稿せずに確認")
    parser.add_argument("--no-commit", action="store_true", help="git commitをスキップ")
    parser.add_argument("--list-ready", action="store_true", help="ready状態の投稿を一覧表示")
    args = parser.parse_args()

    schedule_path = Path(args.schedule_file)
    if not schedule_path.exists():
        print(f"Error: Schedule file not found: {schedule_path}")
        sys.exit(1)

    data = load_schedule(schedule_path)
    posts = data.get("posts", [])

    # ready状態の投稿を一覧表示
    if args.list_ready:
        ready_posts = [p for p in posts if p.get("status") == "ready"]
        print(f"Ready posts: {len(ready_posts)}")
        for p in ready_posts:
            print(f"  - {p.get('id')}: {p.get('scheduled_at')} - {p.get('title')}")
        return

    # 画像テンプレートのルールチェック（ブロック）
    consecutive_conflicts = find_consecutive_template_conflicts(posts)
    same_day_conflicts = find_same_day_template_conflicts(posts)

    if consecutive_conflicts or same_day_conflicts:
        print("\n[ERROR] 画像テンプレートのルール違反を検出。投稿を中止します。")
        if consecutive_conflicts:
            print("  - 連続テンプレート:")
            for prev_post, curr_post, template in consecutive_conflicts:
                print(
                    f"    {prev_post.get('id')} -> {curr_post.get('id')}"
                    f" (template: {template})"
                )
        if same_day_conflicts:
            print("  - 同日テンプレート重複:")
            for day_key, template, posts in same_day_conflicts:
                ids = ", ".join(p.get("id", "unknown") for p in posts)
                print(f"    {day_key}: {template} ({ids})")
        set_github_output("posted", "false")
        sys.exit(1)

    # 投稿対象を検索
    to_publish = find_posts_to_publish(posts, args.force_id)

    if not to_publish:
        print("投稿対象なし")
        set_github_output("posted", "false")
        return

    # 投稿実行
    posted_titles = []
    posted_urls = []

    for post in to_publish:
        post_id = post.get("id", "unknown")
        title = post.get("title", "unknown")
        print(f"\n{'='*50}")
        print(f"投稿中: [{post_id}] {title}")
        print(f"予定時刻: {post.get('scheduled_at')}")
        print(f"{'='*50}")

        try:
            result = execute_post(post, args.dry_run)

            # YAMLを更新
            post["status"] = "posted"
            post["posted_at"] = result.get("posted_at")
            if result.get("url"):
                post["posted_url"] = result["url"]
                posted_urls.append(result["url"])

            posted_titles.append(title)
            print(f"✅ 投稿成功: {title}")
            if result.get("url"):
                print(f"   URL: {result['url']}")

        except Exception as e:
            print(f"❌ 投稿失敗: {title}")
            print(f"   Error: {e}")
            # 失敗しても続行（他の投稿を試みる）
            continue

    # 結果出力
    if posted_titles:
        set_github_output("posted", "true")
        set_github_output("title", posted_titles[0] if len(posted_titles) == 1 else f"{len(posted_titles)}件")
        set_github_output("url", posted_urls[0] if posted_urls else "")
        set_github_output("count", str(len(posted_titles)))

        # YAML保存
        if not args.dry_run:
            save_schedule(schedule_path, data)
            print(f"\nSchedule file updated: {schedule_path}")

            # git commit & push
            if not args.no_commit:
                commit_msg = f"chore(sns): 予約投稿完了 ({len(posted_titles)}件)"
                git_commit_and_push(schedule_path, commit_msg, args.dry_run)
    else:
        set_github_output("posted", "false")
        print("\n投稿は完了しませんでした")


if __name__ == "__main__":
    main()
