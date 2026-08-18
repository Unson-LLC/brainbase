---
spec_id: spec-ten-minute-world-onboarding
story_id: story-ten-minute-world-onboarding
title: Ten-minute world onboarding specification
status: active
created_at: 2026-08-02
updated_at: 2026-08-18
---

# 10分オンボーディング Spec

## Invariants

- INV-001: オンボーディング完了は `first_value_answer_reviewed` であり、connector/import/render 完了ではない。
- INV-002: candidate graph と Graph SSOT は別 source class、別 lifecycle とする。
- INV-003: source pointer、evidence hash、scope のない候補は review/promotion へ進めない。
- INV-004: `observation_class=inferred` の entity/edge は自動選択も自動 promotion もしない。
- INV-005: Graph promotion は既存 Memory Promotion Kernel の単調状態遷移と監査を通る。
- INV-006: first-value answer は Graph SSOT の承認済み context だけを使い、未承認 candidate を混ぜない。
- INV-007: UI は Graph SSOT、candidate、Personal KG、AI context を source class で区別する。
- INV-008: raw source body、credential、token、secret は Graph SSOT と onboarding receipt に保存しない。
- INV-009: owner/org/project scope は入力、候補表示、promotion、context retrieval の全段で引き継ぐ。
- INV-010: unavailable/partial/timeout は空データまたは成功に変換しない。
- INV-011: 標準入力は接続済み MCP、Drive、Gmail、local folder であり、単一文章ファイルは connector を使わない場合の fallback とする。
- INV-012: source は metadata-first に棚卸しし、問いに必要な content だけを明示 scope 内で取得する。
- INV-013: OAuth token、MCP credential、provider secret を onboarding 入力として貼り付けさせず、既存の認証・secret authority を参照する。
- INV-014: connector inventoryは実際にtoolを呼べるhost agentが作り、Brainbase serverは兄弟MCP/app connectorの接続状態を捏造または複製しない。
- INV-015: first-value answerの初期表示は、短い箇条書きによる`覚えていたこと`、`つながったこと`、`次にできること`の3節とし、確認済み事実と未確認事項を分ける。表、entity ID、digest、tool traceは初期表示に置かず、技術詳細として分離する。
- INV-016: CLIサンプル、合成ペルソナ、処理時間は改善の検証材料であって、利用者本人の`useful|not_useful` reviewを置き換えない。

## Slice 0 Contracts

### C-001: Onboarding run

`onboarding_run_id`, `value_target`, `scope`, `source_mode`, `source_readiness`, `started_at`, `source_ready_at` を持つ。10分の budget は `source_ready_at` から first-value review までに適用する。

### C-002: Source catalog entry

製品の source catalog は `source_id`, `source_system`, `connector_type`, `account_or_root`, `readiness`, `authorization_status`, `available_scopes`, `health_checked_at` を返す。Slice 0a の host inventory normalizer は account/root を provider 固有の `available_scopes`（`account_id` または `root`）に保持し、曖昧な `account_or_root` を重複出力しない。未確認の source を `ready` にしない。

### C-003: Source selection

利用者が選んだ `account_ids`, `folder_ids`, `project_ids`, `query`, `date_range`, `file_type_allowlist`, `retention_policy` のうち provider に必要な項目を run に固定する。UI と adapter は scope 外を取得しない。inventory contract の `date_range` は `YYYY-MM-DD/YYYY-MM-DD` の実在する昇順 UTC 日付区間とし、それ以外は `unconfirmed` へ fail closed にする。

### C-004: Source receipt

各 source は `source_system`, `source_event_id`, `evidence_ref`, `content_hash`, `permission_snapshot`, `retention_policy`, `collection_status` を返す。

### C-005: Candidate world item

各 node/edge は次を持つ。

- `candidate_id`
- `entity_type` または `edge_type`
- `source_class=candidate_store`
- `observation_class=observed|inferred`
- `confidence`
- `evidence_ids`
- `scope`
- `resolution`: `new|matched|ambiguous|conflict`
- `review_status`: `pending|approved|edited|rejected|merged`

### C-006: First-value answer receipt

回答 receipt は `value_target`, `used_graph_entity_ids`, `used_edge_ids`, `missing_context`, `generated_at`, `presentation_contract_version=first_value_clarity.v1`, `presented_sections=[覚えていたこと,つながったこと,次にできること]`, `review=useful|not_useful|unreviewed` を返す。回答本文は保存せず、表示契約に従ったことと回答hashだけを証跡化する。

### C-007: Host source inventory normalization

host agentはcredentialと本文を除いたsource inventoryを `scripts/normalize-onboarding-source-inventory.mjs` へ渡す。CLI は配列または唯一のfieldが `sources` であるwrapper objectだけを受理し、wrapperの未知fieldや秘密値も黙って破棄せず全sourceを `unconfirmed` へ降格する。`readiness=ready` は provider 固有の `available_scopes`、`authorization_status`、実行時刻から15分以内（最大5分の未来skewを許容）の ISO timestamp である `health_checked_at`、秘密値を含まない追跡可能な `evidence_ref` が揃う時だけ保持する。readinessにかかわらず認可・health・evidenceの不正値は監査issueを残して `unconfirmed` へ降格し、不足・秘密値・重複 source ID も fail closed にする。readyな一次sourceがあれば `single_document` を推奨sourceにしない。`can_start_warm_path` は一次 connector に限定し、fallback は `can_start_fallback_path`、いずれかで開始可能かは `can_start_onboarding` で返す。

## Scenarios

- S-001: 認可済み MCP がある時、利用者は server/resource/project scope を選び、source ready から10分以内に candidate world と first-value answer review へ到達する。
- S-002: Drive を選んだ時、folder/file metadata を先に表示し、選択 scope 内の必要文書だけを取得する。
- S-003: Gmail を選んだ時、account/query/date range 内の thread metadata を先に取得し、問いに不要な本文や scope 外 message を読まない。
- S-004: local folder を選んだ時、明示 root の allowlist 内だけを走査し、secret、VCS metadata、build output、scope 外 path を候補化しない。
- S-005: connector を使わない利用者が単一文章ファイルを選んだ時、同じ evidence/review/promotion 契約で candidate world を作る。
- S-006: OAuth または管理者承認が未完了の時、`waiting_for_source_authorization` を表示し、source-ready 後の10分 SLA と待ち時間を混ぜない。利用者は file fallback を選べる。
- S-007: 一つの source から observed relation と inferred relation が出た時、両者は別表示され inferred は初期非選択になる。
- S-008: 候補名が Graph alias に一意一致した時、新規 entity を作らず matched entity への edit/merge proposal になる。
- S-009: 候補が曖昧な時、Graph を勝手に更新せず `ambiguous` として人の選択を待つ。
- S-010: 利用者が reject した候補は監査に残るが Graph context へ入らない。
- S-011: source collection が失敗した時、画面は `failed_source_collection` を示し「情報なし」や onboarding success を表示しない。
- S-012: Graph が unavailable の時、新規 entity promotion と first-value answer を止め、復旧可能な run state を残す。
- S-013: 権限外 source/entity は candidate world と first-value answer の両方から除外され、warning と denial reason を返す。

## Verification Gate

### Slice 0a（今回）

- provider 別 valid/invalid scope、failure state、秘密値、重複 source ID を unit fixture で検証する。
- stdin 配列と file の `{sources}` object が同じ正規化契約を通ることを検証する。
- doc trace と Graph SSOT 境界検査を通し、live connector / candidate-to-Graph / production E2E は未確認と明記する。

### Product outcome（後続 slice）

- Story AC と Spec INV/S の対応表を実装 Story で作る。
- MCP / Drive / Gmail / local folder / single document の deterministic adapter fixture を用意する。
- source-ready marker から answer review まで `<= 600 seconds` を記録し、cold authorization の所要時間は別記録にする。
- unit tests で provenance、scope、inferred 非昇格、Graph/candidate isolation を検証する。
- network-aware E2E で source intake -> review -> promotion -> Graph context -> answer receipt を通す。
- merge、deploy、production run receipt を別々に記録し、merge だけで利用可能と報告しない。

## Anti-patterns

- AP-001: candidate JSON を最初のユーザー向けレビュー面にする。
- AP-002: graph を描けたことを first value とする。
- AP-003: connector の接続完了や resource 列挙だけを first value とする。
- AP-004: LLM の抽出結果を直接 Graph writer へ渡す。
- AP-005: inferred edge を observed fact と同じ線・初期選択状態で見せる。
- AP-006: runtime 未確認の設計やローカルテストを production outcome と表明する。
- AP-007: connector の待ち時間を隠すため、標準経路を手入力や一文書へ置き換える。
- AP-008: Gmail 全文、Drive 全件、local folder 全階層を scope 選択なしで初回取得する。
- AP-009: CLIサンプル、合成評価、応答時間だけを「利用者が価値を感じた」証拠として扱う。
