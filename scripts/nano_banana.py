#!/Users/ksato/workspace/.venv/bin/python
"""
Nano Banana Pro (Gemini 3 Pro Image) 画像生成モジュール
複数のプロンプトテンプレートに対応
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


# プロンプトテンプレート定義
PROMPT_TEMPLATES = {
    "infographic": {
        "name": "ビジネスインフォグラフィック",
        "description": "青白基調のビジネス向け図解。フロー説明・ポイント整理に最適",
        "prompt": """Create a professional Japanese business infographic with the following content:

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

Text must be rendered clearly and legibly in Japanese."""
    },

    "exploded": {
        "name": "分解図インフォグラフィック",
        "description": "3D CADスタイルの分解図。システム構造・アーキテクチャ説明に最適",
        "prompt": """Ultra-detailed exploded technical infographic of '{topic}', shown in a 3/4 front isometric view. The object is partially transparent and opened, with its key internal and external components separated and floating around the main body in a clean exploded-view layout.

Show all major parts as labeled floating modules:
{points_text}

Use thin white callout leader lines and numbered labels in a minimalist sans-serif font. Background: smooth dark gray studio backdrop. Lighting: soft, even, high-end product render lighting with subtle reflections. Style: photoreal 3D CAD render, industrial design presentation, high contrast, razor-sharp, 8K, clean composition, no clutter.

Negative: no people, no messy layout, no extra components, no brand logos, no text blur, no cartoon, no low-poly, no watermark, no distorted perspective, no heavy noise"""
    },

    "dashboard": {
        "name": "ダッシュボード風",
        "description": "KPI・メトリクス表示向け。数値・進捗の可視化に最適",
        "prompt": """Create a modern dark-themed dashboard visualization with the following content:

Title: {topic}

Metrics/Data Points:
{points_text}

Design Requirements:
- Dark background (#1a1a2e or similar)
- Neon accent colors (cyan, purple, green)
- Card-based layout with subtle shadows
- Clean data visualization elements (charts, gauges, progress bars)
- Minimalist sans-serif typography
- Futuristic tech aesthetic
- Horizontal layout (16:9 aspect ratio)

Style: UI/UX dashboard mockup, high contrast, clean, modern tech startup aesthetic."""
    },

    "framework": {
        "name": "フレームワーク図",
        "description": "概念・フレームワーク説明向け。抽象的な構造の可視化に最適",
        "prompt": """Create a conceptual framework diagram with the following content:

Central Concept: {topic}

Components:
{points_text}

Design Requirements:
- Clean, minimalist design with ample whitespace
- Geometric shapes (circles, rectangles, hexagons)
- Connecting lines showing relationships
- Subtle gradient backgrounds
- Professional color palette (blues, grays, one accent color)
- Clear hierarchy from center outward
- Icons or symbols for each component
- Horizontal layout (16:9 aspect ratio)

Style: Strategic consulting presentation, McKinsey/BCG style, professional, abstract."""
    }
}


def list_templates():
    """利用可能なテンプレート一覧を表示"""
    print("\n利用可能なテンプレート:")
    print("-" * 50)
    for key, template in PROMPT_TEMPLATES.items():
        print(f"  {key:12} - {template['name']}")
        print(f"               {template['description']}")
    print()


def generate_image(
    topic: str,
    points: list[str],
    template: str = "infographic",
    output_path: str | None = None,
) -> str:
    """
    Nano Banana Proで画像を生成

    Args:
        topic: メインテーマ
        points: 箇条書きポイント（3-5個推奨）
        template: テンプレート名 (infographic, exploded, dashboard, framework)
        output_path: 保存先パス（省略時は自動生成）

    Returns:
        生成された画像のパス
    """
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GOOGLE_API_KEY not set")

    if template not in PROMPT_TEMPLATES:
        raise ValueError(f"Unknown template: {template}. Available: {list(PROMPT_TEMPLATES.keys())}")

    client = genai.Client(api_key=api_key)

    # ポイントをテキスト化
    points_text = "\n".join(f"- {p}" for p in points)

    # テンプレートからプロンプト生成
    prompt = PROMPT_TEMPLATES[template]["prompt"].format(
        topic=topic,
        points_text=points_text
    )

    response = client.models.generate_content(
        model="gemini-3-pro-image-preview",
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
        output_path = str(output_dir / f"{template}_{timestamp}.png")

    for part in response.candidates[0].content.parts:
        if hasattr(part, "inline_data") and part.inline_data:
            with open(output_path, "wb") as f:
                f.write(part.inline_data.data)
            print(f"Image saved: {output_path}")
            return output_path

    raise RuntimeError("No image generated in response")


# 後方互換性のためのエイリアス
def generate_infographic(topic, points, style=None, output_path=None, resolution=None):
    """後方互換性のためのラッパー"""
    return generate_image(topic, points, template="infographic", output_path=output_path)


def generate_from_sns_content(
    title: str,
    body: str,
    template: str = "infographic",
    output_path: str | None = None
) -> str:
    """
    SNS投稿内容から画像を生成

    Args:
        title: 投稿タイトル/フック
        body: 投稿本文
        template: テンプレート名
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
            clean = line.lstrip("-・├└─0123456789. ")
            if clean:
                points.append(clean)

    # ポイントが少なすぎる場合は本文全体から生成
    if len(points) < 3:
        points = [line.strip() for line in lines if line.strip() and not line.startswith("#")][:5]

    return generate_image(
        topic=title,
        points=points[:5],
        template=template,
        output_path=output_path
    )


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Nano Banana Pro 画像生成")
    parser.add_argument("topic", nargs="?", help="メインテーマ")
    parser.add_argument("points", nargs="*", help="ポイント（複数可）")
    parser.add_argument("-t", "--template", default="infographic",
                        choices=list(PROMPT_TEMPLATES.keys()),
                        help="テンプレート選択")
    parser.add_argument("-l", "--list", action="store_true", help="テンプレート一覧表示")
    parser.add_argument("-o", "--output", help="出力先パス")

    args = parser.parse_args()

    if args.list:
        list_templates()
        sys.exit(0)

    if not args.topic:
        # デフォルト値
        topic = "事業OSの3層構造"
        points = [
            "戦略層: project.mdで全体方針を定義",
            "運用層: サブプロジェクトで責任分担",
            "実行層: タスク管理とKPI追跡"
        ]
    else:
        topic = args.topic
        points = args.points if args.points else ["ポイント1", "ポイント2", "ポイント3"]

    try:
        path = generate_image(topic, points, template=args.template, output_path=args.output)
        print(f"Generated: {path}")
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
