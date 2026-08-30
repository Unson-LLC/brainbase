# Story N4: AIが人間へ逃げる前にBrainbaseが代理判断する

## 背景

現在のJudgment Hookは、UserPromptSubmitで判断経路を固定し、PostToolUseでBrainbase参照を記録し、Stopで監査行とreceiptを検証する。一方、Stopは回答内容の意味を採点せず、AIが「テストしますか」「AとBのどちらにしますか」のような低リスク判断を人間へ返して作業を止めることを防げない。

Brainbaseのセンターピンは監査そのものではない。人間が既に持っている判断基準を具体的状況へ適用し、OK/NG、理由、代替指示をAIへ返すことで、人間が同じ意図説明と細かい承認を繰り返さなくてよい状態を作ることである。

## User Story

Brainbaseの所有者として、AIへ一度依頼した後は、既存の判断基準から答えられる途中判断をBrainbaseが代理し、AIが実行と検証まで続けてほしい。人間には、不可逆な外部影響、金銭・契約、実証済みの権限不足、または既存基準で解けない新しい価値判断だけを上げてほしい。

## 成功状態

1. 「テストを実行しますか」等の明白な低リスク確認はLLMを呼ばずStopで差し戻される。
2. 事業目的や優先順位の意味適用が必要なグレーゾーンだけ、独立した読み取り専用Codex Resolverへ送られる。
3. Resolverへ渡すPacketには、digest検証済みepisode、同一turnで成功したBrainbase MCP結果、利用可能なローカルSSOTのDecision・Judgmentが含まれる。
4. ResolverはBrainbase由来の既存source IDだけを根拠に使い、NGなら具体的な次の行動と完了条件を返す。
5. Resolverが利用不能、無効出力、架空根拠を返した場合、人間へ逃がさず、同じWorkerへ安全側の継続指示を返す。
6. 本番破壊、外部送信、購入・契約などの硬い人間境界は既存の監査Stopへ渡される。
7. 「権限がない」「秘密情報がない」というAIの自己申告だけでは、人間エスカレーションを許可しない。
8. 判断はepisode・state・policy snapshotへ束縛され、同一caseでは独立Resolverを重複実行しない。
9. Resolver subprocessからHookが再帰してもAutonomy層を再起動しない。
10. 既存のUserPromptSubmit、PostToolUse、Stop監査契約を壊さない。

## 非目標

- あらゆるハルシネーションを検出すること。
- Judgment receiptを外部送信、書込、本番変更の権限として扱うこと。
- Brainbase CoreへLLMを埋め込むこと。
- 全ツールの改ざん不能な証拠台帳をこのStoryだけで完成させること。
- AIが生成した判断を自動で人間由来のPhilosophyへ昇格すること。

## 評価指標

- 不要な人間エスカレーション率
- 一つの依頼を完了するまでの追加人間返信数
- Brainbase代理判断後の同一turn完遂率
- 架空basis IDの受理率（目標0%）
- 高リスク操作の誤自動承認率（目標0%）
