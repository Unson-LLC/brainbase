---
spec_id: oss-org-simple-project-ui-v1
story_id: story-oss-org-simple-project-ui-v1
status: draft
spec_maturity: implementation_ready
owner_repository: brainbase
---

# OSSプロジェクト画面の簡潔な表示Spec

## 一覧表示

- `.bb-pkw-directory-grid` は一列の一覧とする。
- `.bb-pkw-directory-card` は背景・角丸・四辺の囲みを外し、上辺の罫線と上下の余白で項目を分ける。最後の項目には下辺の罫線を置く。
- `.bb-pkw-graph-list` は一列の一覧とし、`.bb-pkw-graph-item` は透明な背景と上下の罫線で区切る。選択時は薄い緑の背景と左のアクセント線を表示し、フォーカスリングを残す。
- `.bb-pkw-evidence-item` は背景とカード枠を外し、上下の罫線と余白で根拠を区切る。
- `.bb-pkw-unknown` は角丸を外す。警告色、文言、状態判定は維持する。

## 変更しない表示

- Graphキャンバスは操作対象を囲む背景・境界線・高さを保つ。
- 概要の指標、テーブル、詳細、タブ、ボタン、入力部品、取得状態と警告の内容は変更しない。
- モバイルでは一覧を一列のまま保ち、既存の状態表示と遷移を壊さない。

## 回帰確認

- `tests/ui/project-workspace.test.mjs`
- `tests/ui/graph-projects-view.test.mjs`
- `npm run build`
