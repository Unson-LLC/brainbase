---
story_id: story-meeting-minutes-native-lifecycle-v1
title: 外部連携なしで会議と議事録を保存し、版と確認状態を管理できる
status: active
created_at: 2026-10-06
implementation_started: true
implementation_status: local_implementation_complete
verification_status: affected_tests_and_build_passed
owner_repository: brainbase
development_mode: SIMPLIFICATION
depends_on: []
---

# 外部連携なしで会議と議事録を保存し、版と確認状態を管理できる

会議を記録する利用者として、GoogleカレンダーやGitHubを接続せずに議事録を残し、後から同じ会議のどの版を確認したのか分かるようにしたい。

## 完成時の利用者成果

単一所有者のローカルWebで、会議作成 → 本文入力またはテキストファイル取込み → 保存 → 一覧・詳細から再表示 → 特定版の確認 → 訂正版作成まで完結する。アプリを再起動しても本文・版・確認履歴を読み戻せる。

## 受入条件

- [ ] AC-01: 外部アカウント、Calendarイベント、リポジトリの登録なしで会議と議事録を作成できる。会議日時や参加者は独立した情報として持ち、不明な項目を捏造しない。
- [ ] AC-02: 安定した会議ID・議事録ID・版IDで保存・取得する。同じ会議に複数の議事録を持てる。IDは外部providerのIDに依存しない。
- [ ] AC-03: 正本本文とメタデータの保存責任を明示し、保存成功は読み戻し一致で判定する。書込み失敗・不正データ・取得不能を成功や空一覧に変えない。
- [ ] AC-04: 保存済み版を上書きせず、訂正は新しい版を作る。古い画面からの更新競合は拒否し、再読込みと再試行ができる。
- [ ] AC-05: 下書きと確認済みを区別し、確認者・時刻・対象版を記録する。訂正後も旧版の確認履歴は残り、新版には確認を引き継がない。
- [ ] AC-06: 会議一覧、議事録詳細、版履歴、入力・確認の共通画面をOSSに置き、確認対象の版と本文を同じ場所で示す。
- [ ] AC-07: 外部連携なしの上記一連の操作を実画面と再起動後の読み戻しで検証する。確認操作だけで判断の採用やTask実行を発生させない。

## 範囲と境界

Brainbaseの既存local-firstデータ領域とEvidenceの識別・digest・provenance契約を再利用する。本文正本を新しいGraphコピーとの二重編集にしない。保存先portは後続で差し替えられる最小の境界にするが、汎用同期エンジンは作らない。

組織のmember・role・承認者ルール・tenant管理はorganization側の後続Story。音声認識、要約生成、録画、外部connector、既存台帳の一括移行、共同リアルタイム編集は今回の範囲外。

## 設計時に確定すること

保存レイアウト、版の作成単位、競合制御、確認の状態遷移とAPIを最小Specで固定する。本文の削除・保持方針も明示し、保持中の版の不変性と混同しない。

## 開発判断

全体の選択はSIMPLIFICATION。既存のEvidence・Knowledge・adoption契約は存在するが、議事録の本文正本と会議単位の利用者動線は未完成。連携なしで一つの保存・再表示経路を先に完成させる。既存機能の実利用者成果は未確認。

全体の分割と根拠: [Story分割計画](../../../brainbase-project/docs/architecture/brainbase-minutes-story-plan-2026-10-06.md)。
