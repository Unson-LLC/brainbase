---
story_id: story-meeting-minutes-storage-policy-v1
title: 会社の保存方針に合わせて既存議事録を同じ会議と版で扱える
status: active
created_at: 2026-10-06
updated_at: 2026-10-06
implementation_started: true
implementation_status: host_http_and_shared_ui_implementation_complete
verification_status: affected_tests_and_build_passed_gui_pending
implementation_commits: ["c5e72485a", "dd33e5280", "6051ecdcf", "991e90c90", "9028ff56f", "edf8a1e4c"]
technical_adapter_status: filesystem_read_only_adapter_verified
company_policy_status: unselected
host_ui_acceptance_status: pending
verification_evidence: "HTTP/core/filesystem integration: 7 files, 36 tests passed; npm run build passed; git diff --check passed"
owner_repository: brainbase
development_mode: SIMPLIFICATION
depends_on: ["story-meeting-minutes-native-lifecycle-v1"]
---

# 会社の保存方針に合わせて既存議事録を同じ会議と版で扱える

議事録の保存先を定める会社の管理者として、既存の保存先を維持しながら、Brainbaseから同じ会議・議事録・版として参照・管理したい。

## 完成時の利用者成果

Brainbase内保存と、実際の会社方針に沿って選んだ一つの外部保存先を、同じ会議・議事録の画面で扱える。原文への到達方法、編集可否、過去版の取得可否、権限と保持の責任が分かる。

## 受入条件

- [ ] AC-01: 本文正本の配置方針と、入力元、会議の補足情報を区別する。Calendarは任意の会議情報、GitHub/Drive等は任意の保存先であり、どれもドメインIDや利用開始の必須条件にしない。
- [ ] AC-02: native保存と一つの実外部adapterで、保存・取得・参照のみ・過去版取得・現行ACL・保持/削除のcapabilityを明示し、未対応操作は隠蔽せず説明する。
- [ ] AC-03: 外部本文はprovider locator・原文revision・digest・provenanceを持ち、取得時の権限を確認する。取得不能な過去版を現在の本文で代用しない。
- [ ] AC-04: 同じ原資料の再取込みは重複作成せず、原文変更は新しい版として扱う。外部正本とBrainbase内コピーを両方編集できる二重正本を作らない。
- [ ] AC-05: 保存方針や参照先を変更してもBrainbaseの会議・議事録IDと既存版の来歴を失わない。既存版の所在が移せない場合はその制約を示し、移行済みと偽らない。
- [ ] AC-06: native保存と一つの実外部保存先で、登録→取得→原文変更→再取込み→権限取消し/接続断を検証する。契約fakeだけで会社への対応完了とはしない。

## 依存と未確定事項

依存はstory-meeting-minutes-native-lifecycle-v1。**最初の実外部保存先と対象会社の方針は未選定**。Specでは利用可能な保存先を調査して一つ選び、正本・権限・保持・編集責任を固定してから実装する。全provider対応をこの1件に含めない。

共通の保存/参照契約はOSS、秘密情報・接続認証・組織の配置方針はorganizationの既存拡張境界、会社固有値は顧客設定が所有する。組織Webでの受容にはstory-organization-meeting-minutes-sharing-v1の動線を消費する。実adapterのowner repoはproviderの認証境界に応じてSpecに明示する。

## 範囲と開発判断

全体の選択はSIMPLIFICATION。GitHub repo型の登録を普遍的な要件にせず、既存Evidenceのlocator・revision・ACL契約を再利用する。既存台帳の一括移行、全サービス向けconnector、Calendar自動同期、汎用同期基盤の構築は範囲外。必要な保持方針は実adapterの受容条件に含める。

全体の分割と根拠: [Story分割計画](../../../brainbase-project/docs/architecture/brainbase-minutes-story-plan-2026-10-06.md)。

## 2026-10-06 統合・レビュー修正

共通host/API/画面へ接続し、外部本文は現行ACLを確認して本文領域へ表示する。拒否・取得不能・版切替・再配置時に本文を消去し、古い非同期応答で再表示しない。実filesystemと実hostで本文取得後の権限取消し、過去版取得不能を検証。修正前の統合8ファイル61テスト、native受容4テスト、修正後の影響4ファイル46テストとbuild/diff checkが成功。

ブラウザ接続不能のため実画面受容は未完了。filesystemは技術検証adapterであり、会社の保存先・ACL・保持方針は未選定。会社導入と全provider対応を完了扱いしない。
