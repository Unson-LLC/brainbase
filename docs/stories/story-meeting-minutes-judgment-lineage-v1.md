---
story_id: story-meeting-minutes-judgment-lineage-v1
title: 議事録の特定版から採用した判断とTask、訂正の影響を追える
status: in_progress
created_at: 2026-10-06
implementation_started: true
owner_repository: brainbase
development_mode: SIMPLIFICATION
depends_on: ["story-meeting-minutes-native-lifecycle-v1"]
---

# 議事録の特定版から採用した判断とTask、訂正の影響を追える

会議の決定を仕事へ引き継ぐ利用者として、どの議事録のどの版を根拠に判断やTaskを採用したかを辿り、後の訂正で何を再確認すべきか知りたい。

## 完成時の利用者成果

特定版から判断・Task候補を確認し、既存の採用手順で採用する。議事録→採用対象、採用対象→根拠の双方向に辿れる。訂正版が出たら影響する採用対象を再確認でき、過去の判断履歴も失われない。

## 受入条件

- [ ] AC-01: 候補は会議ID・議事録ID・版ID・根拠箇所・digest/provenanceに結び付く。未確認の推測と本文由来の事実を区別する。
- [ ] AC-02: 議事録の確認済み状態と、判断/Taskの採用、外部実行、結果受容を別の状態として扱う。確認だけで採用や実行を発生させない。
- [ ] AC-03: 既存のKnowledge promotion・learning adoption・Task/receipt契約を使い、採用者・対象版・採用先を記録する。再試行で判断やTaskを重複作成しない。
- [ ] AC-04: 採用された判断/Taskから根拠の特定版を開き、議事録から採用先を辿れる。根拠が取得不能・権限不足なら明示し、現在の版を過去の根拠として差し替えない。
- [ ] AC-05: 訂正・撤回は元版と採用履歴を保存する。影響を受ける判断/Taskを再確認対象として示し、採用済み事実の無断上書きやTaskの自動取消し・再実行をしない。
- [ ] AC-06: 一つの議事録版から判断とTaskを各一件採用し、再試行と訂正後の影響表示まで実画面・canonical readbackで検証する。

## 範囲と境界

依存はstory-meeting-minutes-native-lifecycle-v1。手動で選択する候補を最小の完成経路とし、AIによる自動抽出・全文書への波及解析・外部実行は範囲外。議事録由来の情報を無条件でcanonical factへ昇格させない。

共通lineageと画面はOSS。組織での採用権限・scope promotionは既存organization境界で制御し、組織Webへの接続はstory-organization-meeting-minutes-sharing-v1を消費する。

## 開発判断

全体の選択はSIMPLIFICATION。既存Evidence、adoptionとreceiptをつなぎ、別の判断モデルや議事録専用Taskエンジンを作らない。既存の契約検証と実利用者が履歴を追えたという成果を区別する。

全体の分割と根拠: [Story分割計画](../../../brainbase-project/docs/architecture/brainbase-minutes-story-plan-2026-10-06.md)。

## 実装・検証状況（2026-10-06）

共通host/UIへの接続を含む実装済み。関連15ファイル89テスト、build、diff check成功。現在の参照先権限・実行結果を再取得し、取得不能時は完了と表示しない。実画面とcanonical readbackによるAC-06は最終確認中。npm公開・本番反映は未実施。
