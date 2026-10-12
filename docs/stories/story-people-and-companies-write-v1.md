---
story_id: story-people-and-companies-write-v1
title: 「人と会社」から人・会社を作り、所属を付け・終える（情報契約S3のOSS側）
status: in_progress
created_at: 2026-10-13
implementation_started: true
owner_repository: brainbase
---

# 「人と会社」から人・会社を作り、所属を付け・終える（情報契約S3のOSS側）

## 利用者成果

Personal Web を開く本人として、「人と会社」で所属未確認の人を見つけたら、その場で会社への所属を付けたい。会社や人がまだGraphに無ければ、その場で作りたい。辞めた人・終わった所属は、消さずに終了日で終えたい。保存した後は、正本から読み戻した内容で確かめたい。

## 背景

- brainbase-project の情報契約（`docs/architecture/people-and-companies-screen-contract.md`）§3・§5 は、S3 として OSS の訂正に `create_entity`（person・org のみ、理由と履歴つき）を足し、所属の付け外しを画面から行うと決めた。所属を付けるのは既存の `create_edge`（`member_of`）、外すのは既存の `update_edge` の終了日。消す操作は無い。
- 本番のGraphには人から会社への `member_of` が0件で、所属は人物の文字の属性 `org`（無ければ `organization`）にしか無い（情報契約§0）。文字から所属を自動で作らない（台帳P9）。2026-10-13、佐藤が「判断は推奨を採用」とし、所属未確認の人の行に、その文字を「記録上のメモ」とはっきり分かる表示で出すことにした（正本にはしない）。
- 書き込みのボタンは、ホストが渡す「書けるか」で出し分け、部品の中に役割名を書かない（台帳D8）。組織版は S2 で、この部品を読み取りのみで組み込んでいる（`canCorrect` を渡していない）。

## 受入条件

- [ ] AC-01: 訂正 `create_entity` は `{ kind: 'create_entity', reason, entity: { type, name, aliases?, summary?, validFrom? } }` を受け付け、`type` が `person`・`org` のときだけ記録を作る。ほかの種類は `correction_entity_type_not_allowed` で断り、Graphも履歴も変えない。`id`・`metadata`・`tags`・`validTo` など契約に無い項目は断る。
- [ ] AC-02: 作った記録は、Graph の変更と履歴の1行（`kind: 'create_entity'`、理由、`beforeDigest: null`、作った内容）を同じSSOTトランザクションで残し、保存後に正本から読み戻して digest が一致したときだけ保存できたと返す。記録には出どころ（`metadata.source: 'user_approved'`、`metadata.sourceId`: 訂正ID）を残す。
- [ ] AC-03: 同じ種類に、名前か別名が同じ（空白・大文字小文字・全角半角の違いを除く）記録が既にあるときは作らず、`entity_already_exists` の衝突として今の記録を返す。
- [ ] AC-04: `GET /api/graph/people-and-companies` は、人ごとに文字の属性 `org`（無ければ `organization`）を `orgNote`（無ければ null）として返す。所属（`companyIds`）・自社・社内社外の判定には使わない。
- [ ] AC-05: 画面「人と会社」は、ホストが `canCorrect: true` を渡したときだけ書き込みのボタンを出す。既定は読み取りのみで、ボタンを描かず、クライアントは送る前に断る。`correctionScope` の `createEntities: false` で作るボタンを、`createEdges: false` で所属を付けるボタンを、`edges: false` で所属を終えるボタンを出さない。部品に役割名は無い。
- [ ] AC-06: 書ける画面では、人の段に「人を加える」、会社の段に「会社を加える」を出す。保存すると読み戻した内容を示し、一覧を読み直して作った記録を右の欄で開く。
- [ ] AC-07: 人を開くと「所属を付ける」（相手は会社）、会社を開くと「所属する人を加える」（相手は人）を出し、`create_edge`（`member_of`）で保存する。有効な所属ごとに「所属を終える」を出し、`update_edge` で終了日（既定は今日）を入れる。消すボタンは無い。保存後は一覧と右の欄を正本から読み直し、読み戻せなかったときは「保存できた」と出さない。
- [ ] AC-08: 所属未確認の人の行と右の欄に、`orgNote` を「記録上のメモ: …（所属ではありません）」として出す。社内・社外の段の人には出さない。メモから所属を自動で作らない。
- [ ] AC-09: Personal Web は「人と会社」を書ける画面として開き、起動ごとのトークンを訂正に付ける。

## 範囲外

- 組織版の中継（保守の計画 `create_entity`・`upsert_edge` への中継と gm・ceo の制限）は brainbase-organization の S3-2。
- 名刺の表示と昇格（S4）。
- 会社の属性（`orgType`・`lifecycle_stage`・`deals`）の編集。

## 検証

- `tests/graph-web.test.ts`（create_entity・orgNote）、`tests/graph-web-http.test.ts`、`tests/ui/people-and-companies-view.test.mjs`、`tests/ui/graph-registry-view.test.mjs`、`tests/ui/local-web-shell.test.mjs`。
