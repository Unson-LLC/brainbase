# 対話型MCPの認証を統一する

Story: story-mcp-auth-context-1396
Issue: https://github.com/Unson-LLC/brainbase-unson/issues/1396

## 利用者の成果

対話型MCPでは判断と参照が同じ利用者の認証を使い、許可されたプロジェクトを参照できる。サービス実行は保存済み利用者の権限へ切り替わらない。

## 原因と設計判断

現在は同一接続内で通常ツールが環境変数トークンを優先し、判断・個人向けツールが保存済みトークンを使う。接続ごとに認証モードを選び、全ツールへ同じTokenManagerを渡す。認証失敗から別actorへのフォールバックは行わない。

## 受入条件

- 明示した対話型モードでは、環境変数のサービス認証が共存しても保存済み利用者認証を使う。
- サービスモードでは環境変数の認証だけを使い、欠落時も保存済み利用者認証へ切り替えない。
- 未指定時は環境変数認証があればサービス、それ以外は対話型とする。起動時に選択を固定し、不正なモードは拒否する。
- 判断、ナレッジ参照、プロジェクト一覧、個人向けツールの認証元を揃える。個人向けアクセスはAPIの所有者認可を維持する。
- トークン範囲と設定範囲の積集合、許可外拒否を維持する。
- 両トークン共存、トークン欠落、不正モード、認証元の一貫性を回帰テストする。
- 実APIでaitleの参照解決、actor、scopeを秘密値なしで確認する。

## 対象

code_refs: mcp/brainbase/src/auth/token-manager.ts, mcp/brainbase/src/server.ts

test_refs: mcp/brainbase/tests/auth/connection-token-manager.test.ts, mcp/brainbase/tests/auth/token-manager.test.ts, mcp/brainbase/tests/tools/knowledge-resolution-tools.test.ts

## 検証結果

- MCPビルド成功。認証・参照の対象テスト25件成功。
- 修正版のstdio接続から実APIを参照し、ユーザーactorと22プロジェクトの範囲を確認。Aitleの参照解決は `resolved`。
- 参照証跡: `kr_cec4ab65-38d7-4f47-953e-9bc696d6076f`。
