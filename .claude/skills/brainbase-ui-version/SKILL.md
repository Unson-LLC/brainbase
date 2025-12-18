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

2. **index.html のバージョンを更新（2箇所）**
   - デスクトップ版: `<h3 id="app-version" class="app-version">v0.1.1</h3>`
   - モバイル版: `<h3 id="mobile-app-version" class="mobile-version-display">v0.1.1</h3>`
   - **重要**: HTMLに直接書かれているため、両方を手動で更新すること

3. **サーバーを再起動**
   ```bash
   # プロセスを停止して再起動
   ps aux | grep "node.*server.js" | grep -v grep | awk '{print $2}' | xargs kill
   cd /Users/ksato/workspace/brainbase-ui
   nohup node server.js > /tmp/brainbase-ui.log 2>&1 &
   ```

4. **コミットメッセージにバージョンを含める**
   ```
   feat(ui): 新機能追加 (v0.1.1)

   なぜ:
   - 変更理由

   🤖 Generated with [Claude Code](https://claude.com/claude-code)

   Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
   ```

5. **UIでバージョン確認**
   - デスクトップ: 左ナビ最上部に表示
   - モバイル: セッション一覧のヘッダーに表示
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

## 変更履歴

- **v0.1.8**: HTMLに直接バージョンを記載（動的読み込みからの変更）
- **v0.1.7**: セッションボトムシートのヘッダーをバージョンのみに簡素化
- **v0.1.6**: バージョン表示の初期値を動的読み込みに変更
- **v0.1.5**: モバイルでバージョン表示を追加
- **v0.1.4**: モバイルUI大幅改善（設定ボタン、アーカイブトグル、3点メニュー）
- **v0.1.3**: モバイルでボタン常時表示を削除
- **v0.1.2**: サーバー再起動機能追加
- **v0.1.1**: バージョン管理システム追加
- **v0.1.0**: 初期リリース

## 注意事項

- バージョン更新なしでの変更は**禁止**
- ブラウザキャッシュに注意（スーパーリロード: Cmd+Shift+R）
- 複数の変更がある場合は、最も大きな変更に合わせてバージョンを決定

---
最終更新: 2025-12-17
