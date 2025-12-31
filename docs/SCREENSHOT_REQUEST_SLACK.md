# 📸 スクリーンショット撮影依頼（Slack/メール用）

---

小松原くんへ

お疲れ様です、佐藤です。

README全面刷新が完了しました🎉
フィードバックいただいた内容を全て反映し、125行→307行に拡充しました。

次のステップとして、**スクリーンショット3枚の撮影**をお願いしたいです。

## 📋 撮影対象

1. **デスクトップ版ダッシュボード** (`desktop-overview.png`)
   - 複数プロジェクトのタブ + Tasks/Schedule/Inbox が一画面で見える状態
   - 撮影方法: ブラウザでフルスクリーンキャプチャ

2. **モバイル版タスク一覧** (`mobile-tasks.png`)
   - スマホブラウザでアクセスした際の画面
   - 撮影方法: スマホのスクリーンショット機能

3. **セッション切り替えデモ** (`session-management.gif`)
   - プロジェクトタブをクリックして切り替える5-10秒の動画をGIF化
   - 撮影方法: Screen to GIF または QuickTime画面収録

## 📂 保存先

```
docs/screenshots/
├── desktop-overview.png
├── mobile-tasks.png
└── session-management.gif
```

## 📅 期日

**2025-01-03（金）まで**

## 📖 詳細手順

詳しい撮影手順・仕様は以下のドキュメントを参照してください:
`docs/SCREENSHOT_REQUEST.md`

## ✅ 提出方法

**推奨**: 直接コミット＆プッシュ
```bash
mkdir -p docs/screenshots
# ファイル配置後
git add docs/screenshots/
git commit -m "docs: README用スクリーンショット追加"
git push origin main
```

または、Slack/メールで送付でもOKです。

質問があれば #brainbase チャンネルまたはこのスレッドでお願いします！

よろしくお願いします🙏

---

**補足**: README.md の該当箇所（lines 23-35）
```markdown
## 📸 使用イメージ

### デスクトップ版
![Brainbase Desktop - Project Overview](docs/screenshots/desktop-overview.png)

### モバイル版
![Brainbase Mobile - On the Go](docs/screenshots/mobile-tasks.png)

### セッション管理
![Multi-session Support](docs/screenshots/session-management.gif)
```

これらの画像パスが正しく表示されるように撮影・配置をお願いします！
