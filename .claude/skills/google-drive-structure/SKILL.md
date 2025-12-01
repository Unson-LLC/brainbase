---
name: google-drive-structure
description: Google Drive共有ドライブのフォルダ構成とシンボリックリンク運用のガイド。プロジェクトのdrive/フォルダ設定、フォルダ命名規則、同期対象の判断に使用。
---

# Google Drive構成ガイド

Google Drive共有ドライブのフォルダ構成とシンボリックリンク運用のベストプラクティス。

## Instructions

### 1. シンボリックリンク方式の原則

各プロジェクトの `drive/` フォルダはシンボリックリンクでGoogle Drive共有ドライブに接続する。

**メリット**:
- ローカルからClaude Codeでファイル操作可能
- Google Driveストリーミングモードで容量節約
- 共有ドライブで権限管理が一元化

**制約**:
- Googleファイル(.gslides, .gsheet等)は同一アカウント内でのみ移動可能
- 異なるアカウント間では実ファイル(.pptx, .xlsx等)のみ移動可能

### 2. フォルダ構成の原則

| 分類 | 対象 | フォルダ構成 | 例 |
|------|------|-------------|-----|
| 法人共通 | unson/ | エンティティ軸 | バックオフィス, 契約書, 顧客, パートナー |
| 事業 | baao, zeims, senrigan, tech-knight, ncom | 機能軸 | 営業資料, 納品物, 稼働報告 |

**エンティティ軸**（法人共通向け）:
- 誰と（顧客/パートナー）、何を（契約書/バックオフィス）で分類
- 取引先ごとに紐づくファイルが多い場合に適切

**機能軸**（事業向け）:
- 業務プロセス（営業→納品→報告）で分類
- 事業運営フローに沿ったファイル整理

### 3. 共有ドライブ構成

**雲孫ドライブ** (info@unson.jp)
```
雲孫ドライブ/
├── unson/           # 法人共通（エンティティ軸）
│   ├── バックオフィス/  # 経理、社会保険、人事
│   ├── 契約書/
│   ├── 顧客/            # 顧客別フォルダ
│   ├── パートナー/      # パートナー別フォルダ
│   └── 稼働報告/
│
├── baao/            # BAAO事業（機能軸）
│   ├── 営業資料/
│   ├── 納品物/
│   └── 稼働報告/
│
├── zeims/           # Zeims事業（機能軸）
├── senrigan/        # Senrigan事業（機能軸）
├── tech-knight/     # Tech Knight事業（機能軸）
├── ncom/            # NTTドコモビジネス案件（機能軸）
│
└── _inbox/          # 未整理ファイル
```

**SalesTailor共有ドライブ** (k.sato@sales-tailor.jp)
```
SalesTailor/
├── CS/              # カスタマーサクセス
├── SALES/           # 営業
└── ENG/             # エンジニアリング
```

### 4. シンボリックリンク対応表

| ローカル | シンボリックリンク先 |
|----------|---------------------|
| `unson/drive/` | → `雲孫ドライブ/unson/` |
| `baao/drive/` | → `雲孫ドライブ/baao/` |
| `zeims/drive/` | → `雲孫ドライブ/zeims/` |
| `senrigan/drive/` | → `雲孫ドライブ/senrigan/` |
| `tech-knight/drive/` | → `雲孫ドライブ/tech-knight/` |
| `salestailor/drive/` | → `SalesTailor共有ドライブ/` |
| `ncom-catalyst/drive/` | → `雲孫ドライブ/ncom/` |
| `personal/drive/` | → `マイドライブ/personal/` (k0127s@gmail.com) |
| `workspace/_inbox/` | → `雲孫ドライブ/_inbox/` |

### 5. 同期対象外

以下はgit管理のみでDrive同期しない:
- `workspace/` (brainbase root)
- 各プロジェクトの `app/`, `web/` (コード)
- 各プロジェクトの `meetings/` (議事録)

### 6. 新規プロジェクト追加手順

新しいプロジェクトをGoogle Drive連携する場合:

```bash
# 1. 共有ドライブにフォルダ作成（雲孫ドライブの場合）
mkdir -p "/Users/ksato/Library/CloudStorage/GoogleDrive-info@unson.jp/共有ドライブ/雲孫ドライブ/<project>/{営業資料,納品物,稼働報告}"

# 2. ローカルにシンボリックリンク作成
ln -s "/Users/ksato/Library/CloudStorage/GoogleDrive-info@unson.jp/共有ドライブ/雲孫ドライブ/<project>" "/Users/ksato/workspace/<project>/drive"

# 3. .gitignoreに追加
echo "drive/" >> /Users/ksato/workspace/<project>/.gitignore
```

### 7. フォルダ命名規則

- **日本語を使用**: 営業資料, 納品物, 稼働報告, 顧客, パートナー
- **スペースは使わない**: 半角スペースの代わりにアンダースコアか日本語区切り
- **小文字英数字も可**: 顧客ID等はそのまま（例: nttcom/）

### 8. 検証チェックリスト

新規セットアップ後:
```
□ シンボリックリンクが正しく機能する（ls -la <project>/drive/）
□ Claude Codeからファイル読み書きできる
□ 共有ドライブのフォルダ構成が原則に従っている
□ .gitignoreにdrive/が追加されている
□ architecture_map.mdのシンボリックリンク対応表を更新した
```

## Examples

### 例1: 新規事業「foo」の追加

```bash
# 雲孫ドライブに機能軸フォルダ作成
mkdir -p "/Users/ksato/Library/CloudStorage/GoogleDrive-info@unson.jp/共有ドライブ/雲孫ドライブ/foo/{営業資料,納品物,稼働報告}"

# シンボリックリンク作成
ln -s "/Users/ksato/Library/CloudStorage/GoogleDrive-info@unson.jp/共有ドライブ/雲孫ドライブ/foo" /Users/ksato/workspace/foo/drive

# 確認
ls -la /Users/ksato/workspace/foo/drive/
```

### 例2: ファイル移動（Claude Code経由）

```bash
# _inboxからプロジェクトへ移動（mvを使う、cpは遅い）
mv /Users/ksato/workspace/_inbox/提案書.pdf /Users/ksato/workspace/baao/drive/営業資料/

# Googleファイルは同一アカウント内でのみ移動可能
# NG: 雲孫ドライブ → SalesTailor共有ドライブ（異なるアカウント）
# OK: 雲孫ドライブ/unson → 雲孫ドライブ/baao（同一アカウント）
```

### よくあるミス

**❌ cpを使ってしまう**
```bash
cp file.pdf /project/drive/  # 遅い（ダウンロード→アップロード）
```
→ **mvを使う**（メタデータ移動のみで高速）

**❌ 異なるアカウント間でGoogleファイルを移動**
```bash
mv 雲孫ドライブ/doc.gslides SalesTailor共有ドライブ/  # 失敗する
```
→ **実ファイル(.pptx等)に変換してから移動**、または**同一アカウント内で移動**

---

このガイドに従うことで、Google Drive連携が統一されたルールで運用できます。
