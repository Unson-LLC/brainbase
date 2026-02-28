#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
from typing import Iterable, Tuple

import yaml
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

SCRIPT_DIR = Path(__file__).parent
COOKIE_FILE = SCRIPT_DIR / ".x_cookies.json"

X_HOME_URL = "https://x.com/home"
X_LOGIN_URL = "https://x.com/i/flow/login"
DEFAULT_EDITOR_URLS = [
    "https://x.com/i/article/create",
    "https://x.com/i/article/new",
    "https://x.com/i/articles/new",
    "https://x.com/i/article/compose",
]
ARTICLE_LIST_URL = "https://x.com/i/articles"


def load_env() -> None:
    env_paths = [
        Path("/Users/ksato/workspace/.env"),
        SCRIPT_DIR.parent.parent / ".env",
    ]
    for env_path in env_paths:
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip())
            break


load_env()


def parse_frontmatter(text: str) -> tuple[dict, str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text.strip()
    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            fm = yaml.safe_load("\n".join(lines[1:idx])) or {}
            body = "\n".join(lines[idx + 1 :]).strip()
            return fm, body
    return {}, text.strip()


def extract_title_and_body(body: str, fm: dict) -> tuple[str, str]:
    title = fm.get("title") or fm.get("hook") or ""
    lines = [line.rstrip("\n") for line in body.splitlines()]
    idx = 0
    while idx < len(lines) and not lines[idx].strip():
        idx += 1
    if title:
        if idx < len(lines) and lines[idx].strip() == title.strip():
            body_out = "\n".join(lines[idx + 1 :]).lstrip()
        else:
            body_out = body.strip()
    else:
        if idx < len(lines):
            title = lines[idx].strip()
            body_out = "\n".join(lines[idx + 1 :]).lstrip()
        else:
            title = "無題"
            body_out = ""
    title = title.strip() or "無題"
    if len(title) > 120:
        title = title[:120]
    if not body_out:
        body_out = body.strip()
    return title, body_out


def load_cookies(context) -> bool:
    if not COOKIE_FILE.exists():
        return False
    try:
        cookies = json.loads(COOKIE_FILE.read_text(encoding="utf-8"))
        context.add_cookies(cookies)
        return True
    except Exception:
        return False


def save_cookies(context) -> None:
    cookies = context.cookies()
    COOKIE_FILE.write_text(json.dumps(cookies, ensure_ascii=False, indent=2), encoding="utf-8")


def clear_cookies() -> None:
    if COOKIE_FILE.exists():
        COOKIE_FILE.unlink()


def has_selector(page, selector: str) -> bool:
    try:
        return page.locator(selector).count() > 0
    except Exception:
        return False


def is_logged_in(page) -> bool:
    url = ""
    try:
        url = str(page.url or "")
    except Exception:
        url = ""
    # If we were redirected to login flow, treat as logged out.
    if "/i/flow/login" in url or "/login" in url:
        return False

    selectors = [
        '[data-testid="SideNav_AccountSwitcher_Button"]',
        '[data-testid="AppTabBar_Profile_Link"]',
        'a[href="/home"]',
        'a[aria-label="Profile"]',
    ]
    return any(has_selector(page, sel) for sel in selectors)


def wait_for_login(page, timeout_sec: int = 180) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        if is_logged_in(page):
            return True
        time.sleep(1)
    return False


def ensure_login(page, headless: bool, wait_timeout: int = 180) -> None:
    page.goto(X_HOME_URL, wait_until="domcontentloaded")
    # XのUIはDOMContentLoaded直後だと判定がブレることがあるので少し待つ。
    for _ in range(6):
        if is_logged_in(page):
            return
        time.sleep(0.5)
    page.goto(X_LOGIN_URL, wait_until="domcontentloaded")
    if headless:
        raise RuntimeError("Not logged in. Run without --headless to login.")
    print("[ACTION] Xにログインしてください。ログイン完了まで待機します…")
    if not wait_for_login(page, timeout_sec=wait_timeout):
        raise RuntimeError("Login timeout")


def wait_for_editor(page) -> Tuple[object, object] | None:
    try:
        page.wait_for_selector('[contenteditable="true"]', timeout=15000)
    except PlaywrightTimeoutError:
        return None
    editables = page.locator('[contenteditable="true"]')
    count = editables.count()
    if count >= 2:
        return editables.nth(0), editables.nth(1)
    if count == 1:
        return editables.nth(0), editables.nth(0)
    return None


def open_editor(page, urls: Iterable[str]) -> Tuple[object, object]:
    last_error = None
    for url in urls:
        page.goto(url, wait_until="domcontentloaded")
        if "login" in page.url:
            continue
        result = wait_for_editor(page)
        if result:
            return result
        last_error = f"editor not found at {url}"
    result = open_editor_from_list(page)
    if result:
        return result
    raise RuntimeError(last_error or "editor not found")


def open_editor_from_list(page) -> Tuple[object, object] | None:
    try:
        page.goto(ARTICLE_LIST_URL, wait_until="domcontentloaded")
    except Exception:
        return None
    candidates = [
        'button:has-text("新しい記事")',
        'button:has-text("記事を書く")',
        'button:has-text("記事を作成")',
        'button:has-text("新規作成")',
        'button:has-text("Create")',
        'button:has-text("New article")',
        'a:has-text("新しい記事")',
        'a:has-text("記事を書く")',
        'a:has-text("Create")',
    ]
    for sel in candidates:
        loc = page.locator(sel)
        if loc.count() == 0:
            continue
        try:
            loc.first.click()
            result = wait_for_editor(page)
            if result:
                return result
        except Exception:
            continue
    return None


def click_first(page, selectors: Iterable[str]) -> bool:
    for sel in selectors:
        loc = page.locator(sel)
        if loc.count() == 0:
            continue
        try:
            loc.first.click()
            return True
        except Exception:
            continue
    return False


def fill_editor(el, text: str) -> None:
    el.click()
    try:
        el.press("Meta+A")
    except Exception:
        try:
            el.press("Control+A")
        except Exception:
            pass
    el.type(text, delay=5)


def click_save(page) -> bool:
    selectors = [
        'button:has-text("下書き保存")',
        'button:has-text("保存")',
        'button:has-text("Save")',
        '[data-testid="saveDraft"]',
    ]
    if click_first(page, selectors):
        return True
    menu_selectors = [
        'button[aria-label="More"]',
        'button[aria-label="More options"]',
        'button[aria-label="もっと見る"]',
        '[data-testid="overflow"]',
    ]
    for menu_sel in menu_selectors:
        menu = page.locator(menu_sel)
        if menu.count() == 0:
            continue
        try:
            menu.first.click()
            time.sleep(1)
            if click_first(page, selectors):
                return True
        except Exception:
            continue
    return False


def upload_cover_image(page, image_path: str) -> bool:
    if not image_path:
        return False
    image_file = Path(image_path).expanduser()
    if not image_file.exists():
        return False

    def try_set_file() -> bool:
        inputs = page.locator('input[type="file"]')
        if inputs.count() == 0:
            return False
        try:
            inputs.first.set_input_files(str(image_file))
            return True
        except Exception:
            return False

    if try_set_file():
        time.sleep(2)
        return True

    trigger_selectors = [
        'button:has-text("画像を追加")',
        'button:has-text("カバー")',
        'button:has-text("Add image")',
        'button:has-text("Add cover")',
        '[data-testid="mediaButton"]',
        '[aria-label*="画像"]',
        '[aria-label*="image"]',
    ]
    click_first(page, trigger_selectors)
    time.sleep(1)
    if try_set_file():
        time.sleep(2)
        return True
    return False


def click_publish(page) -> bool:
    selectors = [
        'button:has-text("公開")',
        'button:has-text("投稿")',
        'button:has-text("Publish")',
        'button:has-text("Post")',
        '[data-testid="publishButton"]',
        '[data-testid="tweetButton"]',
    ]
    return click_first(page, selectors)


def click_publish_confirm(page) -> bool:
    selectors = [
        'button:has-text("公開")',
        'button:has-text("投稿")',
        'button:has-text("Publish")',
        'button:has-text("Post")',
        '[data-testid="confirmationSheetConfirm"]',
        '[data-testid="confirm"]',
    ]
    return click_first(page, selectors)


def wait_for_save_toast(page) -> bool:
    texts = [
        "下書き保存",
        "保存しました",
        "Saved",
        "Draft saved",
    ]
    for text in texts:
        try:
            if page.locator(f'text={text}').first.is_visible():
                return True
        except Exception:
            continue
    return False


def wait_for_publish_toast(page) -> bool:
    texts = [
        "公開しました",
        "公開完了",
        "投稿しました",
        "Published",
        "Post sent",
    ]
    for text in texts:
        try:
            if page.locator(f'text={text}').first.is_visible():
                return True
        except Exception:
            continue
    return False


def wait_for_article_url(page, timeout_ms: int) -> str:
    try:
        page.wait_for_url("**/i/article/**", timeout=timeout_ms)
        if "/i/article/" in page.url:
            return page.url
    except Exception:
        pass
    return page.url if "/i/article/" in page.url else ""


def build_context(playwright, args) -> tuple[object, object]:
    channel = args.channel or None
    user_agent = args.user_agent or None
    if args.use_system_chrome:
        channel = "chrome"
        if not args.profile_dir:
            args.profile_dir = str(Path.home() / "Library/Application Support/Google/Chrome")
        if not args.chrome_profile:
            args.chrome_profile = "Default"
    if args.persistent or args.profile_dir:
        profile_dir = Path(args.profile_dir) if args.profile_dir else (SCRIPT_DIR / ".x_playwright_profile")
        profile_dir.mkdir(parents=True, exist_ok=True)
        launch_args = ["--start-maximized", "--disable-blink-features=AutomationControlled"]
        if args.chrome_profile:
            launch_args.append(f"--profile-directory={args.chrome_profile}")
        ignore_default_args = None
        if args.real_keychain:
            ignore_default_args = ["--use-mock-keychain", "--password-store=basic"]
        context = playwright.chromium.launch_persistent_context(
            user_data_dir=str(profile_dir),
            headless=args.headless,
            channel=channel,
            user_agent=user_agent,
            args=launch_args,
            ignore_default_args=ignore_default_args,
        )
        page = context.new_page()
        return context, page
    browser = playwright.chromium.launch(
        headless=args.headless,
        channel=channel,
        args=["--start-maximized", "--disable-blink-features=AutomationControlled"],
    )
    context = browser.new_context(user_agent=user_agent)
    if args.auth:
        clear_cookies()
    load_cookies(context)
    page = context.new_page()
    return context, page


def main() -> None:
    parser = argparse.ArgumentParser(description="Save X Article draft on x.com")
    parser.add_argument("source", help="Source markdown path")
    parser.add_argument("--title", default="", help="Override title")
    parser.add_argument("--editor-url", default="", help="Override editor url")
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--publish", action="store_true", help="Publish after saving draft")
    parser.add_argument("--publish-timeout", type=int, default=20, help="Publish wait timeout (seconds)")
    parser.add_argument("--image", default="", help="Cover image path override")
    parser.add_argument("--auth", action="store_true", help="Re-authenticate (clear cookies)")
    parser.add_argument("--wait-login", type=int, default=180)
    parser.add_argument("--persistent", action="store_true", help="Use persistent context for login")
    parser.add_argument("--profile-dir", default="", help="Use specific browser user data dir")
    parser.add_argument("--chrome-profile", default="", help="Chrome profile directory name (e.g. 'Default', 'Profile 1')")
    parser.add_argument("--real-keychain", action="store_true", help="Allow using macOS keychain for Chrome profile cookies")
    parser.add_argument("--channel", default="", help="Playwright channel (e.g. chrome)")
    parser.add_argument("--use-system-chrome", action="store_true", help="Use system Chrome profile")
    parser.add_argument("--user-agent", default="", help="Override user agent")
    args = parser.parse_args()

    source = Path(args.source)
    if not source.exists():
        raise SystemExit(f"source not found: {source}")

    text = source.read_text(encoding="utf-8", errors="ignore")
    fm, body = parse_frontmatter(text)
    title, body = extract_title_and_body(body, fm)
    if args.title:
        title = args.title
    image_path = args.image or fm.get("image") or ""

    editor_urls = [args.editor_url] if args.editor_url else DEFAULT_EDITOR_URLS

    with sync_playwright() as p:
        context, page = build_context(p, args)

        ensure_login(page, headless=args.headless, wait_timeout=args.wait_login)
        title_el, body_el = open_editor(page, editor_urls)

        fill_editor(title_el, title)
        fill_editor(body_el, body)
        upload_cover_image(page, image_path)

        if not click_save(page):
            raise RuntimeError("Save draft button not found")

        time.sleep(2)
        wait_for_save_toast(page)
        published_url = ""
        if args.publish:
            if not click_publish(page):
                raise RuntimeError("Publish button not found")
            time.sleep(2)
            click_publish_confirm(page)
            time.sleep(2)
            wait_for_publish_toast(page)
            published_url = wait_for_article_url(page, args.publish_timeout * 1000)
        if not args.profile_dir and not args.persistent and not args.use_system_chrome:
            save_cookies(context)
        context.close()

    if args.publish:
        if published_url:
            print(f"published: {published_url}")
        else:
            print("published: url not detected")
    else:
        print("saved draft on x.com")


if __name__ == "__main__":
    main()
