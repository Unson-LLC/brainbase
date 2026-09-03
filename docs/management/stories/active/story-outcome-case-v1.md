---
story_id: story-outcome-case-v1
title: OutcomeCase v1 組織成果の閉鎖判断
status: active
production_evidence: not_collected
done: false
---

# OutcomeCase v1 組織成果の閉鎖判断

## 利用者成果

組織は、成果を「HTTP 200・テスト成功・保存・デプロイ」で完了と取り違えず、技術証拠、既存 RunReceipt、外部読戻し、制約確認を分離して、閉鎖可否を再現可能に判断できる。

## 受け入れ条件

- [ ] AC-001: OutcomeCase は case_id、project_code、capability_id、利用者可観測成果、保護制約、非目標、authority、domain pack、評価、閉鎖状態、外部状態、各参照、不解決失敗境界、revision、時刻を保持する。
- [ ] AC-002: create/read/evaluate の最小 API だけを提供し、既存 RunReceipt v1 の schema・ingest・query 契約を変更しない。
- [ ] AC-003: `closed` は technical evidence が confirmed、全 RunReceipt 参照が既存照会で confirmed、external readback が confirm、constraints が satisfied の全条件を満たす場合に限る。
- [ ] AC-004: HTTP 応答、テスト、保存、デプロイはそれだけで close 判定へ変換されない。証拠未収集・参照不明・外部読戻し no_data は close しない。
- [ ] AC-005: Graph に未知の entity type を書き込まない。OutcomeCase は既存 project/capability への参照を持つ制御面 record とし、本 Story では本番 Graph 書込み・外部送信・deploy を実施しない。

## 非目標

KnowledgeEvent の自動昇格、汎用 workflow engine、RunReceipt v1 の変更、Graph ontology の active release 更新、本番 migration、外部送信、deploy。
