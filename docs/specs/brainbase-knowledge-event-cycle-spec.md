# Brainbase knowledge_event.v1 Spec

## 公開API

- `POST /api/knowledge/events`: イベント登録
- `POST /api/knowledge/feedback`: 採用、訂正、却下、役に立たなかった結果の記録
- `GET /api/knowledge/cycles/:eventId`: 現在段階、意味状態、失敗理由、検索可能時刻を返す

すべて既存の`/api/knowledge`認証境界を使い、要求された`project_code`が`req.access.projectCodes`に含まれない場合は拒否する。

## knowledge_event.v1

必須項目:

- `schema_version = knowledge_event.v1`
- `event_id`
- `occurred_at`
- `captured_at`
- `source`
- `subject`
- `decision_authority`
- `applicability_scope`
- `permission_snapshot`
- `source_pointer`
- `body_hash`
- `parent_episode_id`

同一`event_id`の再送は、`body_hash`、`source_pointer`、`subject`、`decision_authority`、`applicability_scope`、`permission_snapshot`、`parent_episode_id`がすべて一致する場合だけ同じ結果を返す。いずれかが異なる場合は`409 knowledge_event_conflict`とする。

## Decision自動反映

以下をすべて満たす場合だけ保存先を`graph`にする。

- `subject.type = decision`かつ安定した`subject.id`がある
- 明示的な決定文がある
- `decision_authority.authorized = true`で、決定権者IDと判断領域がある
- `applicability_scope.project_code`と適用範囲がある
- `source_pointer`と`body_hash`がある
- 個人情報フラグ、既存状態との未解決競合がない

不足または競合があれば候補の意味状態を`quarantined`とし、理由コードを残す。Graph書込みは行わない。

Graph payloadには現在有効なDecisionの要約、適用範囲、決定権者、発生日、`derived_from_event_id`、`derived_from_candidate_id`、`source_pointer`を保存し、議事録全文は保存しない。

## 処理状況

処理段階は`received -> queued -> extracted -> resolved -> indexed -> retrievable`の順で履歴を追記する。`knowledge_cycle_receipt.v1`はこの履歴と候補状態から都度生成する。

## Feedback

- `adopt`: 使用結果を追記する
- `correct`: 新しい`knowledge_event.v1`を必須とし、旧情報を`superseded`へ移す
- `reject`: 旧情報を`retracted`へ移し、現在の検索対象から外す
- `not_useful`: 使用結果を追記し、状態変更は登録ポリシーに委ねる

訂正イベントは`corrects_event_id`、却下は対象`event_id`を必須とする。

`feedback_id`の再送も同じ不変identityの場合だけ冪等に扱う。対象イベント、操作、理由、訂正イベントが異なる場合は`knowledge_feedback_identity_conflict`とする。

## Meeting Review Package

会議ソース、Review Package、Cloudflare/computer結果は共通の`parent_episode_id`を使う。Decision候補または必須結果が欠落した場合はEpisodeを`partial`または`blocked`にし、成功として確定しない。タスクは候補だけを保存し、外部システムへ起票しない。
