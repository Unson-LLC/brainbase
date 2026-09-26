---
story_id: story-personal-value-proof-review-web-v1
title: ローカルWebで判断を見返し、評価を付けられる
status: active
created_at: 2026-09-24
implementation_started: true
owner_repository: brainbase
depends_on: ["story-personal-value-proof-review-v1"]
external_dependencies: []
---

# ローカルWebで判断を見返し、評価を付けられる

## 利用者成果

単独所有者として、CodexやClaude Codeで進めた仕事のあとにブラウザを開き、Brainbaseが最近、何を自分に聞かずに進め、何を自分に戻し、何が止まっているかを見て、一件ずつ評価を付けたい。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: OSS単独で動くローカルWebホスト（`brainbase review:serve`）と、共通UI部品`ui/value-proof-review`

外部サービス、組織、メンバー、承認を必須にしない。仕事の依頼・実行の入力手順はWebに複製しない。

## 受入条件

- [ ] AC-01: `brainbase review:serve`は`127.0.0.1`だけで待ち受け、画面、起動用スクリプト、UI部品2ファイル、判断の見返しAPIだけを返す。journalの場所は`--journal`、環境変数`BRAINBASE_JUDGMENT_JOURNAL_DIR`、既定値の順に決める。
- [ ] AC-02: ホームは「あなたの判断が必要」「止まっている」「聞かずに進めた」の3区分と、記録の範囲（対象、保存済みの件数、最終記録、記録が止まっている可能性、読めない記録）を表示する。journalが利用できない場合や応答が不正な場合を0件として表示しない。
- [ ] AC-03: 判断カードは、扱い → 判断 → 仕事への影響 → 根拠 → 過去の学習の再利用 → 実行 → 成果の確認 → 評価の順に表示する。intent IDやdecision attempt IDは監査詳細にだけ出す。
- [ ] AC-04: 評価の保存には、起動ごとのトークンと同一オリジンを要求する。journalに無い判断への評価は拒否する。「訂正」「取り消し」は理由の1文を必須とする。保存後は読み戻して反映を確かめ、失敗したら入力を残して理由を示す。
- [ ] AC-05: 「Codexで相談する」で、decision attempt IDを含む依頼文をコピーできる。
- [ ] AC-06: ホストは、Hostが`127.0.0.1`・`localhost`・`[::1]`と待ち受け中のポートの組でない要求を、画面・API・評価のいずれにも応えず拒否する。ログインを持たないため、DNSリバインディングで別サイトからトークンや判断を読まれたり、評価を書かれたりしないようにする。
- [ ] AC-07: 共通UI部品`ui/value-proof-review`は、ローカルのjournalを読めないホスト（組織版など）が、journalに接続できないときの見出しと案内文を差し替えられる。差し替えても0件としては扱わず、理由を表示する。既定の案内はローカルの`--journal`と環境変数のまま。

## 対象外

根拠の対象名をGraphから解決すること（現状は適用内容を表示し、対象IDは監査詳細に出す）。評価から判断基準の改訂候補を作る接続。判断表示（`judgment-view`）への導線。

## 検証と完了

HTTPは実際にホストを起動して、トークン・オリジン・存在しない判断・journalの不変を反例として確認する。UIは簡易DOMで表示順と失敗表示を確認し、実ブラウザで表示と評価の保存を確認する。
