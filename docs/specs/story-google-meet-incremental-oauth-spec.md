---
story_id: story-google-meet-incremental-oauth
development_mode: SIMPLIFICATION
---

# Google Meet incremental OAuth Spec

## Scope boundary

- Login OAuth: `openid profile email`
- Meeting workflow OAuth: `https://www.googleapis.com/auth/meetings.space.readonly`, `https://www.googleapis.com/auth/calendar.readonly`, `https://www.googleapis.com/auth/documents.readonly`, and `https://www.googleapis.com/auth/gmail.compose`
- Provider token material belongs in the tenant credential store. `integration_accounts.credential_ref` contains only an opaque reference.
- This story does not grant write access to Calendar or Meet.
- Calendar event attachments are resolved only when their MIME type is Google Docs. Generic Drive/PDF attachments remain outside this OAuth grant rather than requesting broad `drive.readonly` access.
- Gmail is draft-only. The provider calls `users.drafts.create`; it does not request `gmail.send` and does not expose a send operation.

## Verification

- `GET /api/auth/google/meet/start` and callback require an authenticated Brainbase organization context.
- Missing credential-store configuration keeps the Meet connection route fail-closed with `503`.

- `tests/unit/google-workspace-auth-provider.test.js`
  - login scope regression
  - incremental authorization parameters
  - integration code exchange redirect binding
  - refresh grant
  - Meet conference-record read request
  - Calendar event attachment metadata read request
  - attached Google Docs meeting-note read request
  - Meet transcript and transcript-entry read requests
  - Gmail draft create request and send-scope exclusion
- `tests/server/services/auth/google-meet-connection-service.test.js`
  - token本文をtenant credential storeだけへ渡す
  - `integration_accounts`相当のaccount recordにはopaque参照だけを保存する
  - account登録失敗時に孤立credentialをrevokeする
- `tests/server/services/auth/google-meeting-workflow-adapter.test.js`
  - opaque credential refを各provider callの間だけmaterializeする
  - Calendar、Meet、Docs、Gmailの応答へtoken本文を混ぜない

The trusted workflow adapter materializes the opaque credential reference only for one provider call. It must not return credential material to the Growin orchestrator or persist it in workflow state.
