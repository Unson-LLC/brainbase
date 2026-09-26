---
id: story-knowledge-retrieval-continuation
title: 取得できなければ探し方を変え、出典のある回答へ進む
status: in_progress
---

# 取得できなければ探し方を変え、出典のある回答へ進む

利用者として、登録先を自分で説明し直さずに、AIが取得結果を見て切り口を変え、本文と出典のある回答か具体的な未確認点を返してほしい。

## 受け入れ条件

1. 対象名のヒントを認可範囲として使わず、検索・本文取得・関係探索をadapter経由で実行する。
2. 空振り・内容不足・通信障害・権限不足を区別し、失敗を不存在にしない。
3. AIが別の切り口を提案し、Hostが実取得、重複、世代番号、消費量を検査できる。
4. 検索候補だけで完了せず、必要項目を実取得した本文の出典と照合する。
5. 再開しても予算を戻さず、同じ検索と通信再試行を有限にする。
6. 公開パッケージのexportから利用でき、特定の組織・サービス・常駐Hostを必須にしない。

## 範囲

本repoは共通lookup契約と純粋な継続状態遷移を所有する。実行環境側が認証・本文の公開用投影・状態の永続化・モデル継続を接続する。既存MCPサーバーへの自動登録や全Hostへの有効化は本変更に含めない。

[Spec](../../specs/story-knowledge-retrieval-continuation-spec.md) / [Architecture](../../architecture/knowledge-retrieval-continuation.md)
