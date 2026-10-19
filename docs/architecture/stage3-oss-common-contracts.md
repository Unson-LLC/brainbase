# Stage 3 OSS common contract architecture

## Decision

3cの実行記録と3dの会議自動化は、OSS package内の副作用を持たない契約モジュールとして先に公開する。consumerは`@unson/brainbase-mcp/run-receipt`または`@unson/brainbase-mcp/meeting-automation`をimportし、保存、Graph昇格、外部送信は別の認証済み境界で実行する。

3bは既存の`personal-knowledge`、`knowledge-promotion`、`personal-memory`、`routines`がcanonicalである。Personal KGはADR-003 D4に従い、旧vaultを新しい正本へ変更しない。

`onboarding-runtime` のcandidate distは実行時依存を同じpackへbundleする。consumerは`node_modules`の別配置で依存を補完せず、packを隔離したinstall treeへ展開して実ファイルをimportできることを確認する。

## Boundaries

- `src/run-receipt.ts`は入力を検証して、immutable payload、決定的identity、WMC projectionを返す。DB、HTTP、queue、provider呼び出しを持たない。
- `src/meeting-automation.ts`は候補の上限・長さ・aliasを検証し、review packageの必須出力とloop intentのscopeを検証する。`follow_up_draft`は常に人間承認待ちである。
- Graphの判断event、outcome、outbox、meeting judgment event adapterは別担当の3a境界であり、この変更から参照・移設しない。
- 既存のmeeting minutes/source syncはproviderと保存の契約であり、今回の会議候補・review package契約と混同しない。

## Flow

1. 外部consumerが純粋契約へ入力する。
2. 契約が不正入力、機密本文、scope不一致、外部送信前の未承認状態を拒否する。
3. consumerが検証済み値を既存のcanonical writerまたは人間レビューへ渡す。
4. production readbackで実際のimport・consumer・正本保存を確認するまで、移設状態は`migration_pending`とする。

## Compatibility and rollback

公開subpath追加は既存exportsを維持する。旧実装は削除せず、Phase Bでreadbackと同等テストを確認してから分離変更を提案する。readbackまたはconsumer検証が失敗した場合は新subpathの利用を止め、旧runtimeの契約を保持する。
