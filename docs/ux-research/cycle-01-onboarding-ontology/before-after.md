# Before / After

同じconnected onboardingタスクとportable fixtureで比較した。

- Before (501d817以前のbaseline確認): startはidだけを返す一方、後続入力はrunIdを要求し、ingestのsource入れ子とreviewのactionsを利用者が推測する必要があった。Decision昇格後にtopic、supersedes、effectiveAt、rationale、tagsが失われ、推論ではlegacy decisionとして扱われた。
- After (501d817): startはrunIdと互換idを返し、tool説明とcopyable例が後続shapeと検索境界を明示する。Decision意味フィールドはcanonical SSOTに保持され、同一topicの旧Decisionを明示的にsupersedeできる。
- Evidence: tests/mcp-contract.test.ts、tests/import-extract.test.ts、tests/persona-onboarding-ux.test.ts。
- Limit: 人間の所要時間、実UI、実端末は未比較。
