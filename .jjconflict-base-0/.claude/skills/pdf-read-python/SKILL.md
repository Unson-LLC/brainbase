---
name: pdf-read-python
description: PDF読み込みの正しい方法。ReadツールでPDFを直接読むとエラーになるため、必ずPythonのpdfplumberライブラリを使用。インストール方法、基本的な使い方、ページ単位でのテキスト抽出を含む。PDF読み込み時に使用。
---

# PDF読み込み（Python必須）

Claude CodeでPDFファイルを読み込む際の正しい方法。ReadツールでPDFを直接読むとエラーになるため、必ずPythonのpdfplumberライブラリを使用する。

## Triggers

以下の状況で使用：
- PDFファイルを読み込む必要があるとき
- ReadツールでPDFを読もうとしてエラーが発生したとき
- PDF内のテキストを抽出したいとき

## 重要な原則

**絶対にReadツールでPDFを直接読まない**

- ReadツールでPDFを読むとエラーになることが多い
- 必ずPythonのpdfplumberライブラリを使用する
- この方法なら確実にPDFの内容を抽出できる

## Python環境（重要）

**brainbaseでは共通の仮想環境を使用する**

| 項目 | パス |
|------|------|
| 共通仮想環境 | `/Users/ksato/workspace/.venv` |
| Python | 3.13.11 |
| 用途 | すべてのPythonツール・スクリプトで使用 |

**理由**:
- Python環境の散らばりを防ぐ
- パッケージ管理を一元化
- バージョン競合を回避

## 手順

### 1. 共通仮想環境の使用（推奨）

pdfplumberは既に共通仮想環境にインストール済みです。Bashツールで実行する際は、仮想環境をアクティベートしてから実行します。

```bash
source /Users/ksato/workspace/.venv/bin/activate && python << 'EOF'
import pdfplumber
# ... PDFを読み込むコード ...
EOF
```

または、仮想環境のPythonを直接指定：

```bash
/Users/ksato/workspace/.venv/bin/python << 'EOF'
import pdfplumber
# ... PDFを読み込むコード ...
EOF
```

### 2. ライブラリの追加インストール（必要な場合）

新しいパッケージが必要な場合は、共通仮想環境にインストールします。

```bash
source /Users/ksato/workspace/.venv/bin/activate
pip install <package-name>
deactivate
```

### 2. Pythonスクリプトでの読み込み

#### 基本的な使い方

```python
import pdfplumber

pdf_path = '/path/to/your/file.pdf'

with pdfplumber.open(pdf_path) as pdf:
    # 総ページ数の取得
    print(f"総ページ数: {len(pdf.pages)}")

    # 全ページのテキスト抽出
    for i, page in enumerate(pdf.pages):
        text = page.extract_text()
        print(f"--- ページ {i+1} ---")
        print(text)
```

#### 特定のページのみ抽出

```python
import pdfplumber

pdf_path = '/path/to/your/file.pdf'

with pdfplumber.open(pdf_path) as pdf:
    # 最初の3ページのみ
    for i, page in enumerate(pdf.pages[:3]):
        text = page.extract_text()
        print(f"--- ページ {i+1} ---")
        print(text)
```

### 3. Bashツールでの実行例（共通仮想環境使用）

**必ず共通仮想環境のPythonを使用してください。**

```bash
/Users/ksato/workspace/.venv/bin/python << 'EOF'
import pdfplumber

pdf_path = '/Users/ksato/Downloads/example.pdf'

try:
    with pdfplumber.open(pdf_path) as pdf:
        print(f"総ページ数: {len(pdf.pages)}")
        print(f"\n{'='*60}")
        print("最初の3ページの内容:")
        print(f"{'='*60}\n")

        # 最初の3ページを表示
        for i, page in enumerate(pdf.pages[:3]):
            print(f"\n--- ページ {i+1} ---\n")
            text = page.extract_text()
            if text:
                print(text)
            else:
                print("(テキストが抽出できませんでした)")
            print(f"\n{'='*60}\n")

except Exception as e:
    print(f"エラーが発生しました: {type(e).__name__}: {e}")
EOF
```

**注意**: `python3` ではなく `/Users/ksato/workspace/.venv/bin/python` を使用することで、共通仮想環境を確実に使用できます。

## pdfplumberの特徴

| 特徴 | 説明 |
|------|------|
| テキスト抽出 | PDFからテキストを正確に抽出 |
| ページ単位処理 | ページごとに処理が可能 |
| テーブル抽出 | `page.extract_tables()` でテーブルも抽出可能 |
| メタデータ取得 | PDFのメタデータも取得可能 |

## その他の便利な機能

### テーブルの抽出

```python
with pdfplumber.open(pdf_path) as pdf:
    page = pdf.pages[0]
    tables = page.extract_tables()
    for table in tables:
        print(table)
```

### メタデータの取得

```python
with pdfplumber.open(pdf_path) as pdf:
    metadata = pdf.metadata
    print(metadata)
```

## トラブルシューティング

### pdfplumberがインストールできない場合

**共通仮想環境にインストールしてください。**

```bash
source /Users/ksato/workspace/.venv/bin/activate
python -m pip install --upgrade pip
pip install pdfplumber
deactivate
```

### テキストが抽出できない場合

- スキャンされた画像PDFの場合、OCRが必要
- その場合は `pdf2image` と `pytesseract` を共通仮想環境にインストール

```bash
source /Users/ksato/workspace/.venv/bin/activate
pip install pdf2image pytesseract
deactivate
```

## チェックリスト

PDF読み込み時は以下を確認：

```
- [ ] ReadツールではなくPythonを使用
- [ ] 共通仮想環境（/Users/ksato/workspace/.venv）のPythonを使用
- [ ] pdfplumberライブラリがインストール済み
- [ ] Bashツールで `/Users/ksato/workspace/.venv/bin/python` を実行
- [ ] エラーハンドリング（try-except）を含む
```

---

最終更新: 2025-12-25
