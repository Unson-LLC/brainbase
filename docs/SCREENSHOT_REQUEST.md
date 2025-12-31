# スクリーンショット撮影依頼

**依頼者**: 佐藤圭吾
**依頼先**: 小松原くん
**期日**: 2025-01-03（金）まで
**目的**: README.md の使用イメージセクションに掲載するスクリーンショット撮影

---

## 📋 撮影対象（3枚）

### 1. デスクトップ版ダッシュボード
**ファイル名**: `docs/screenshots/desktop-overview.png`

**撮影内容**:
- Brainbaseのメイン画面（ダッシュボード）
- 複数プロジェクトのタブが表示されている状態
- Tasks、Schedule、Inbox の3つのパネルが見える構成

**撮影手順**:
1. ローカルで Brainbase を起動 (`npm start`)
2. http://localhost:3000 にアクセス
3. 複数のセッション（プロジェクト）を作成
   - 例: brainbase, salestailor, tech-knight など
4. ダッシュボード画面を表示
5. ブラウザのスクリーンショット機能で全画面キャプチャ
   - Chrome: `Cmd + Shift + 5` (macOS) / `F12` → デバイスツール → スクリーンショット (Windows)
   - Firefox: 右クリック → "スクリーンショットを撮る"

**推奨解像度**: 1920x1080 以上

**ポイント**:
- タスク一覧、スケジュール、受信箱が一目で見渡せることを強調
- 「一元管理」の価値が伝わる画面構成

---

### 2. モバイル版タスク一覧
**ファイル名**: `docs/screenshots/mobile-tasks.png`

**撮影内容**:
- スマホブラウザでアクセスした際のタスク一覧画面
- レスポンシブデザインが適用されている状態

**撮影手順**:
1. スマホから http://<your-local-ip>:3000 にアクセス
   - ローカルIPアドレスの確認: `ifconfig | grep "inet "` (macOS/Linux)
   - 例: http://192.168.1.100:3000
2. タスク一覧画面を表示
3. スマホのスクリーンショット機能でキャプチャ
   - iPhone: 音量ボタン + 電源ボタン
   - Android: 音量ダウン + 電源ボタン

**推奨デバイス**: iPhone または Android スマートフォン

**ポイント**:
- モバイル対応（スマホ・タブレットから快適にアクセス）の強みを視覚化
- 外出先でもタスク確認・更新できることをアピール

---

### 3. セッション管理デモ（GIF）
**ファイル名**: `docs/screenshots/session-management.gif`

**撮影内容**:
- プロジェクトタブをクリックして切り替える様子
- セッションが即座に切り替わる動作

**撮影手順**:
1. 画面収録ツールを起動
   - macOS: QuickTime Player → "新規画面収録"
   - Windows: Xbox Game Bar (`Win + G`) → 録画
   - オンラインツール: [Screen to GIF](https://www.screentogif.com/)（推奨）
2. Brainbase のダッシュボードを表示
3. プロジェクトタブを2-3個クリックして切り替える動作を収録（5-10秒）
4. 収録停止
5. GIFに変換
   - macOS: `ffmpeg -i input.mov -vf "fps=10,scale=800:-1:flags=lanczos" -c:v gif output.gif`
   - オンライン: [CloudConvert](https://cloudconvert.com/mov-to-gif)

**推奨サイズ**: 800px幅、10fps、5-10秒

**ポイント**:
- セッション切り替えの高速性を強調
- git worktree による並行作業の利点を視覚化

---

## 📂 保存先

撮影したファイルを以下のディレクトリに配置してください:

```
docs/screenshots/
├── desktop-overview.png
├── mobile-tasks.png
└── session-management.gif
```

**ディレクトリ作成**:
```bash
mkdir -p docs/screenshots
```

---

## ✅ 提出方法

### Option 1: 直接コミット（推奨）
```bash
# ディレクトリ作成
mkdir -p docs/screenshots

# ファイルを配置後
git add docs/screenshots/
git commit -m "docs: README用スクリーンショット追加

- デスクトップ版ダッシュボード (desktop-overview.png)
- モバイル版タスク一覧 (mobile-tasks.png)
- セッション管理デモ (session-management.gif)

撮影者: 小松原"

git push origin main
```

### Option 2: Slack/メールで送付
- Slack: #brainbase チャンネルに投稿
- メール: keigo.sato@unson.co.jp

---

## 🎯 期待する成果物

1. ✅ 3枚のスクリーンショット（PNG 2枚、GIF 1枚）
2. ✅ `docs/screenshots/` に配置完了
3. ✅ README.md の画像パスが正しく表示される

---

## 📝 備考

### 画質・ファイルサイズについて
- PNG: 画質優先、ファイルサイズは気にしない（1-5MB程度）
- GIF: ファイルサイズ 2MB以下を推奨（GitHub表示の快適性）

### トラブルシューティング

**Q1: モバイルからアクセスできない**
- ファイアウォール設定でポート3000を開放
- ローカルIPアドレスが正しいか確認

**Q2: GIF変換がうまくいかない**
- Screen to GIF（Windows）または CloudConvert（オンライン）を使用
- ffmpegコマンドでも変換可能（上記参照）

**Q3: 撮影内容について質問がある**
- Slack: #brainbase チャンネルで質問
- メール: keigo.sato@unson.co.jp

---

## 🙏 お願い

- **期日厳守**: 2025-01-03（金）まで
- **確認**: 撮影後、README.md の該当箇所で画像が正しく表示されるか確認
  - README.md lines 23-35: 使用イメージセクション
- **フィードバック**: 撮影時に気づいた点があれば共有してください

よろしくお願いします！

---

**作成日**: 2025-12-31
**作成者**: 佐藤圭吾
**バージョン**: 1.0
