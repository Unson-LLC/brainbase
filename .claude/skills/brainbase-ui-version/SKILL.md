---
name: brainbase-ui-version
description: brainbase-uiのバージョン管理ルール。変更時の必須手順とバージョン番号の形式を定義。
scope: project
tags:
  - brainbase
  - ui
  - version
  - development
---

# brainbase-ui バージョン管理ルール

## バージョン形式

```
v0.0.0
```

- **v** プレフィックス必須
- **セマンティックバージョニング**: MAJOR.MINOR.PATCH

## バージョン更新ルール

brainbase-uiのコードを変更した場合、**必ずバージョンを更新する**こと。

### 更新基準

| 変更内容 | バージョン更新 | 例 |
|---------|--------------|-----|
| 破壊的変更 | MAJOR | v0.1.0 → v1.0.0 |
| 新機能追加 | MINOR | v0.1.0 → v0.2.0 |
| バグ修正・小さな改善 | PATCH | v0.1.0 → v0.1.1 |

### 更新手順

1. **package.json のバージョンを更新**
   ```json
   {
     "version": "0.1.1"
   }
   ```

2. **コミットメッセージにバージョンを含める**
   ```
   feat(ui): 新機能追加 (v0.1.1)

   なぜ:
   - 変更理由

   🤖 Generated with [Claude Code](https://claude.com/claude-code)

   Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
   ```

3. **UIでバージョン確認**
   - 左ナビの「Sessions」の横に表示される
   - `/api/version` エンドポイントで取得可能

## バージョン表示システム

### 実装場所

- **package.json**: バージョン番号の正本
- **server.js**: `/api/version` エンドポイント
- **index.html**: `<span id="app-version">` 要素
- **app.js**: `loadVersion()` 関数
- **style.css**: `.app-version` スタイル

### 確認方法

```bash
# ローカルで確認
curl http://localhost:3000/api/version

# ブラウザで確認
左ナビの「Sessions v0.1.1」を目視確認
```

## 変更履歴の例

- **v0.1.1**: モバイルでアクションボタンが表示されない問題を修正、バージョン管理システム追加
- **v0.1.0**: 初期リリース

## 注意事項

- バージョン更新なしでの変更は**禁止**
- ブラウザキャッシュに注意（スーパーリロード: Cmd+Shift+R）
- 複数の変更がある場合は、最も大きな変更に合わせてバージョンを決定

---
最終更新: 2025-12-17
