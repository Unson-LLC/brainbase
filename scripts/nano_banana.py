#!/Users/ksato/workspace/.venv/bin/python
"""
Nano Banana Pro (Gemini 3 Pro Image) 画像生成モジュール
インフォグラフィック生成に特化
"""

import os
import sys
from pathlib import Path
from datetime import datetime

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
    from google import genai
    from google.genai import types
except ImportError:
    print("Error: google-genai not installed. Run: pip install google-genai")
    sys.exit(1)


def generate_infographic(
    topic: str,
    points: list[str],
    style: str = "professional Japanese business infographic",
    output_path: str | None = None,
    resolution: str = "2k"  # 1k, 2k, 4k
) -> str:
    """
    Nano Banana Proでインフォグラフィックを生成

    Args:
        topic: メインテーマ
        points: 箇条書きポイント（3-5個推奨）
        style: スタイル指定
        output_path: 保存先パス（省略時は自動生成）
        resolution: 解像度 (1k, 2k, 4k)

    Returns:
        生成された画像のパス
    """
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GOOGLE_API_KEY not set")

    client = genai.Client(api_key=api_key)

    # インフォグラフィック用プロンプト構築
    points_text = "\n".join(f"- {p}" for p in points)

    prompt = f"""Create a {style} infographic with the following content:

Title: {topic}

Key Points:
{points_text}

Design Requirements:
- Clean, modern Japanese business style
- Blue and white color scheme with accent colors
- Clear visual hierarchy with numbered sections
- Icons for each key point
- Professional typography with Japanese text support
- Horizontal layout (16:9 aspect ratio)
- Include flow arrows connecting sections
- Each section should have a small icon representing the concept

Text must be rendered clearly and legibly in Japanese.
"""

    # 解像度設定
    config = {}
    if resolution == "4k":
        config["output_mime_type"] = "image/png"

    response = client.models.generate_content(
        model="gemini-3-pro-image-preview",  # Nano Banana Pro
        contents=prompt,
        config=types.GenerateContentConfig(
            response_modalities=["image", "text"],
        )
    )

    # 画像保存
    if output_path is None:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_dir = Path(__file__).parent.parent / "_codex" / "sns" / "images"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = str(output_dir / f"infographic_{timestamp}.png")

    for part in response.candidates[0].content.parts:
        if hasattr(part, "inline_data") and part.inline_data:
            with open(output_path, "wb") as f:
                f.write(part.inline_data.data)
            print(f"Image saved: {output_path}")
            return output_path

    raise RuntimeError("No image generated in response")


def generate_from_sns_content(
    title: str,
    body: str,
    output_path: str | None = None
) -> str:
    """
    SNS投稿内容からインフォグラフィックを生成

    Args:
        title: 投稿タイトル/フック
        body: 投稿本文
        output_path: 保存先

    Returns:
        生成された画像のパス
    """
    # 本文から箇条書きポイントを抽出
    lines = body.strip().split("\n")
    points = []
    for line in lines:
        line = line.strip()
        if line.startswith(("- ", "・", "├─", "└─", "1.", "2.", "3.", "4.", "5.")):
            # 記号を除去してポイント抽出
            clean = line.lstrip("-・├└─0123456789. ")
            if clean:
                points.append(clean)

    # ポイントが少なすぎる場合は本文全体から生成
    if len(points) < 3:
        points = [line.strip() for line in lines if line.strip() and not line.startswith("#")][:5]

    return generate_infographic(
        topic=title,
        points=points[:5],  # 最大5ポイント
        output_path=output_path
    )


if __name__ == "__main__":
    # テスト実行
    if len(sys.argv) > 1:
        topic = sys.argv[1]
        points = sys.argv[2:] if len(sys.argv) > 2 else ["ポイント1", "ポイント2", "ポイント3"]
    else:
        topic = "事業OSの3層構造"
        points = [
            "戦略層: project.mdで全体方針を定義",
            "運用層: サブプロジェクトで責任分担",
            "実行層: タスク管理とKPI追跡"
        ]

    try:
        path = generate_infographic(topic, points)
        print(f"Generated: {path}")
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
