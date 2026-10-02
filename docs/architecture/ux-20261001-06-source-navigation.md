---
architecture_id: ux-20261001-06-source-navigation
status: decision_pending
story_id: story-ux-20261001-06-source-navigation
---

# UX-20261001-06 出典遷移の候補アーキテクチャ

## 判断対象

判断の見返し画面のbasisにある対象IDから、根拠の元情報へ安全に移るための契約を定める。UX-20261001-06の元記録にはsource descriptorがなく、元journalに根拠を追加する判断はこの文書からは行わない。

## 確認できている既存経路

- Personal WebのGraph画面は、hostの`/api/graph` read経路を通してGraph v2のentityを読む。
- Graph clientにはentity IDをencodeして`/entities/<id>`を読む経路がある。
- Graph画面はこの候補で`#graph?entity_id=<id>`を受け、readback後に対象を選択する。
- Graph entityのreadbackにはcontent digestがあるが、すべての応答にversion/revisionがあることは確認できていない。

## 候補A（このPRで具体化）

value-proofのbasisに、URLではなく次のtyped descriptorを記録する。

```ts
type BasisSource = {
  kind: "local_graph";
  entity_id: string;
  entity_type: "person" | "org" | "project" | "decision";
  version?: string | null;
  digest?: string | null;
};
```

host-owned readerだけがdescriptorを解決し、ID・種類・任意のdigest/versionをreadbackで照合する。照合できたときだけUIが同一オリジンGraph routeへの遷移リンクを表示する。404、重複ID、ACL拒否、通信失敗、照合不一致はリンクなし・未確認で閉じる。

### 境界

- UIは任意URLを受け取らない。
- UIはGraphの認可やsourceの存在を推測しない。hostのreader結果を表示するだけにする。
- source descriptorのない既存recordは変更せず、ID・版のテキスト表示を維持する。
- `source`の書込み、既存journalのbackfill、Graph以外のproviderは別判断である。

## 候補B（採用しない場合の案）

汎用provider registryとopaque source referenceを導入し、Graph以外の正本や外部読取先も同じUIに接続する。providerごとの認可、版照合、同一ID重複、エラー分類、外部遷移境界が必要になり、今回のGraph-only UXには過剰である。

## 決定待ち

この変更はpayload schemaとhost readerの境界を追加するため、アーキテクチャ変更である。候補Aを採用するか、候補Bを別Storyに送るか、人間の判断を待つ。判断が返るまでPRをマージしない。

## 検証証跡

出典ありのP1×S1を確認できるよう、架空の`project-atlas` Graph entityとsource-bearing value-proofをテストfixtureに置く。元journalのsource欠落は未確認のまま残し、fixtureの成功を実データの確認済みへ一般化しない。

## Inspector向け隔離Web確認手順

これは実journal・実Graphを読まない、期限付きのsynthetic fixtureである。PRのworktreeで次を実行する。

```sh
node tests/ui/ux06-source-fixture-server.mjs --duration 900 --port 31986
```

ブラウザで`http://127.0.0.1:31986/#today`を開き、P1×S1と同じ手順で次を確認する。

1. 「聞かずに進めた」から架空の「架空fixtureの設定を反映してよいですか？」を選ぶ。
2. 右レールの根拠に`project-atlas`と「出典を開く」が出ることを確認する。
3. 「出典を開く」を押し、URLが`#graph?entity_id=project-atlas`になり、「Atlas導入」のGraph詳細が表示されることを確認する。
4. 上部の「架空データ・実journal不使用」を確認し、この結果を元journalの出典確認済みとは扱わない。

サーバーは900秒で終了する（早く終える場合はCtrl-C）。確認対象はこのfixtureだけであり、常駐Webや実データへの反映ではない。
