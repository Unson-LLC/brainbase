# Story: Meeting Source Runtime Sync Policy

## User Story

Mac CompanionからTactiq/Plaudの同期を確認する利用者として、同期頻度と同期範囲をMac側で入力・保存せず、Brainbase runtimeが保持する同期ポリシーに従って再同期プレビューが動いてほしい。

## Background

Meeting Source MCPの設定UIはMac Companionにあるが、実際の同期worker、cursor、backfill範囲、重複取得窓はBrainbase runtime側の責務である。Macが `updated_since` を生成すると、同期範囲の正本がUIに分散し、Tactiq/Plaudをcron workerで継続同期する設計と矛盾する。

## Acceptance Criteria

- `GET /api/settings/meeting-sources/mcp-providers` はTactiq/Plaudの接続状態に加えて、Brainbase runtimeが使う `sync_policy` を返す。
- `POST /api/settings/meeting-sources/resync-preview` は `providers` だけでも成功し、runtime policyから `updated_since` を解決する。
- 初回またはcursor未設定時は `2026-06-25T00:00:00.000Z` 以降を対象にする。
- cursorがある場合は `cursor.updated_since` から24時間戻した範囲を使う。ただし初回backfill開始日より前には戻さない。
- デフォルトの同期worker頻度は5分である。
- カレンダーは補助文脈であり、同期対象のSSOTではない。

