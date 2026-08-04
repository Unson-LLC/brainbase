---
story_id: story-brainbase-portable-connected-world-onboarding
title: 既存の仕事ソースから10分で自分の世界を立ち上げる
status: active
period: 2026Q3
horizon: quarter
view: business
category: product
spec: docs/specs/story-brainbase-portable-connected-world-onboarding.md
architecture: docs/architecture/story-brainbase-portable-connected-world-onboarding.md
business_metric: first-value review completion within 600 seconds of first ready source
created_at: 2026-08-04
updated_at: 2026-08-04
---

# 既存の仕事ソースから10分で自分の世界を立ち上げる

## 背景

公開版Brainbaseには、手入力とファイルimportを中心にした個人オンボーディングはある。しかし、ホストエージェントが実際に呼び出せるMCP、Drive、Gmail、限定ローカルフォルダ、単一ドキュメントを棚卸しし、最小範囲の証拠候補を人間レビューへつなぎ、承認済み事実だけで最初の価値を返す一続きの実行契約はない。

## ユーザーストーリー

Brainbaseを初めて使う人として、既に接続できる仕事ソースを追加の設定なしで棚卸しし、使える最小範囲だけから候補を確認し、承認した事実だけを使った最初の回答を10分以内に評価したい。そうすることで、大量の初期入力や不透明な自動学習なしにBrainbaseの価値を理解できる。

## 受け入れ基準

- [ ] AC-1: run開始時に、最初に得たい価値と、`mcp`、`drive`、`gmail`、`local_folder`、`single_document`の実在する接続状態を受け取る。
- [ ] AC-2: source inventoryは`ready`、`waiting_for_authorization`、`unavailable`、`error`、`unconfirmed`を区別し、取得失敗を0件やreadyへ変換しない。
- [ ] AC-3: ready sourceが複数ある場合はwarm pathを、ない場合は明示された単一ドキュメントfallbackだけを選び、全Driveやhome directoryを走査しない。
- [ ] AC-4: source receiptはpointer、content hash、permission snapshot、収集状態だけを保持し、本文、回答本文、credential、token、password、secretを永続化しない。
- [ ] AC-5: evidence candidateはsource receiptと双方向に追跡でき、`observed`と`inferred`を区別する。
- [ ] AC-6: `approve`、`edit`、`reject`、`merge`を候補単位で実行できる。`inferred`候補は直接approveできない。
- [ ] AC-7: review入力全体を事前検証し、不正な1件があればcanonical SSOTを一切変更しない。
- [ ] AC-8: approve/edit/mergeされた候補だけをOntology validation経由で昇格し、canonical 4ファイルとreview ledgerを同じrecovery可能なSSOT transactionでpublishする。rejectは監査履歴を残すがcanonical IDを持たない。
- [ ] AC-9: retryは同じsource/candidateを重複作成せず、source identityを後から別pointer/hashへ差し替えられない。
- [ ] AC-10: first-value receiptは昇格済みcanonical IDだけを根拠として記録し、回答本文を保存せず、`useful`または`not_useful`と不足文脈を記録できる。
- [ ] AC-11:最初のready sourceからfirst-value reviewまでの経過時間を記録し、600秒以内かを機械判定できる。
- [ ] AC-12: 公開Skillが、実際のconnector棚卸し、最小範囲fetch、5つのonboarding MCP tool、人間レビュー、失敗状態をホストエージェントへ明示する。
- [ ] AC-13: MCP stdioを通るfixture E2Eでstart→ingest→review→first value→verdictとcanonical検索を確認する。

## 境界

- connector自身の認証、Gmail/Drive API実装、クラウドbackendは提供しない。ホストが実際に呼べるconnectorの状態と、取得済みのbounded evidenceを受け取る。
- 生データの自動収集や全アカウント・全フォルダscanは行わない。
- candidateはcanonical memoryではない。人間の明示reviewなしに昇格しない。
- ローカルMCP processと選択されたPersonal OS directoryをauthority境界とし、存在しない組織・project認証モデルを捏造しない。

## Done evidence

現在HEADに結び付いたunit、MCP contract、fixture E2E、full test、typecheck/build、VibePro Gateとrequired reviewがすべて成功した時に完了とする。mergeとnpm公開は実装完了とは別のrelease判断として証跡を分離する。
