---
description: "note.comの記事編集画面で画像を挿入する（macOS専用）"
---

# note画像挿入スキル

note.comの記事編集画面で画像を挿入する。

## 前提条件

- macOS環境
- Google Chrome（note.comにログイン済み）
- Claude in Chrome拡張機能（ブラウザ操作用）

## 使い方

```
/note-image <画像ファイルのフルパス>
```

## 手順

1. 挿入位置の「+」ボタンをクリック
2. メニューから「画像」をクリック
3. ファイルダイアログが開いたら（不可視）、以下のosascriptを実行：

```bash
osascript -e '
tell application "Google Chrome"
    activate
end tell
delay 0.5
tell application "System Events"
    key code 102
    delay 0.3
    keystroke "g" using {command down, shift down}
    delay 1.0
    keystroke "<画像ファイルのフルパス>"
    delay 0.5
    keystroke return
    delay 1.0
    keystroke return
end tell
'
```

4. アップロード完了を待つ（4秒程度）

## osascriptの解説

| コード | 説明 |
|--------|------|
| `key code 102` | 英数キー（日本語入力を防ぐ） |
| `Cmd+Shift+G` | フォルダへ移動ダイアログを開く |
| `keystroke return` × 2 | パス確定 → ファイル選択確定 |

## 注意

- **macOS専用**: Windowsは別の方法が必要
- **フルパス必須**: `/Users/...` から始まる絶対パス
- **key code 102**: 日本語入力モードだとパス入力が壊れるため必須
- **Chrome前提**: Safariでは動作確認していない

## 使用例

```bash
# 単一画像を挿入
/note-image /tmp/generated_image.png

# 複数画像を順番に挿入
/note-image /tmp/image1.png
/note-image /tmp/image2.png
```

## トラブルシューティング

| 症状 | 原因 | 対策 |
|------|------|------|
| パスが文字化け | 日本語入力モード | key code 102を追加 |
| ダイアログが開かない | Chrome非アクティブ | activate追加 |
| ファイルが見つからない | 相対パス使用 | フルパスに変更 |
