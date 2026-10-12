---
story_id: story-judgment-resolution-contract-exit-v1
title: 判断の解決の共通部品（エラーの型・正規JSON・要求digest）をOSSの公開packageの出口に出す
status: in_progress
created_at: 2026-10-11
implementation_started: true
owner_repository: brainbase
depends_on: []
---

# 判断の解決の共通部品（エラーの型・正規JSON・要求digest）をOSSの公開packageの出口に出す

## 利用者成果

組織版に判断の解決の経路を移す開発者として、経路が使う `JudgmentResolutionError`・`canonicalJson`・`computeRequestDigest` を、unsonのファイルではなくOSSのnpmの公開版から読みたい。組織版の移設計画の段4の `judgment-resolution-host-mount`（unsonの `server/routes/judgment-resolution.js`）は、この3つだけをunsonの判断のサービスから読んでいるため、出口がないと組織版へ移せない。

## 背景

- 経路は、判断のサービス（`resolve`）が投げたエラーを受け取り、`instanceof JudgmentResolutionError` で応答の状態コードを振り分ける。経路だけが別の写しを読むと、エラーの型が別物になり、すべて500になる。そのため、この出口は「経路が読む」だけでなく、unsonの判断のサービスも同じクラスをここから読むことを前提にする。
- 判断のサービス本体は、所有台帳の項目 `judgment-harness` で移設先がOSSと決まっている。今回は、経路の移設に必要な3つ（と、それが使う `sha256Hex`）だけを先に出す。
- OSSにはすでに `canonicalJson` の非公開の写しが複数ある。そのうち `src/judgment-host.ts` の版だけがunsonの版と同じ（キーを符号位置の順に並べ、`undefined` を拒否する）。この写しは新しい出口から読む形にまとめる。ほかの写し（`judgment-history`・`judgment-autonomy`・`judgment-frame-read` など）は並べ方や `undefined` の扱いが違い、それぞれのdigestの互換に関わるので触らない。

## 受入条件

- [x] AC-01: `@unson/brainbase-mcp/judgment-resolution-contract` から `JudgmentResolutionError`・`canonicalJson`・`sha256Hex`・`computeRequestDigest` を取り込める。
- [x] AC-02: unsonの実装と同じ振る舞いをする。`canonicalJson` はキーを符号位置の順に並べ、有限でない数・`undefined`・関数などを拒否する。`computeRequestDigest` は正規JSONのSHA-256の16進。`JudgmentResolutionError` は `name`・`code`・`status`（既定400）・`message` を持ち、`toJSON` が同じ形を返す。
- [x] AC-03: unsonの実装と同じ入力に同じ出力（例外を含む）を返すことを、両方を並べた突き合わせで確かめる。
- [x] AC-04: `src/judgment-host.ts` の同じ写しを消し、新しい出口から読む。判断Hookの既存テストが通る。
- [x] AC-05: 公開の出口（`package.json` の `exports`）から、ビルド後の成果物として読み込める。
- [ ] AC-06: npmの公開版に入る（公開は佐藤さんの承認後）。

## 範囲外

- 判断のサービス本体（`judgment-resolution-service.js`）のOSSへの移設。台帳の `judgment-harness` として別に行う。
- 経路を組織版へ移すことと、unsonのサービスを新しい出口から読む形にすること。公開の後、unsonと組織版の別PRで行う。
- ほかの `canonicalJson` の写しの統合。

## 検証

- `npx vitest run tests/judgment-resolution-contract.test.ts tests/judgment-host.test.ts tests/judgment-host-autonomy.test.ts`
- `npm run build`（strictの型検査）
- `npm run docs:check`
