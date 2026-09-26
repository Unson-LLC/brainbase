---
story_id: story-foundation-public-provider-v1
title: 同じ判断契約を公開GraphとMCPから確認できる
status: implemented
implementation_started: true
owner_repository: brainbase
---

# 同じ判断契約を公開GraphとMCPから確認できる

利用者として、公開入口でも目的・世界モデル・哲学の版と判断利用条件を同じ契約で確認したい。

## 受入条件

- [x] Foundationの公開定義を過去Ontologyの書換えなしに明示できる。
- [x] 認証済みcontextをHostが注入し、入力のprincipalやscopeで権限を偽装できない。
- [x] 公開の版読取・判断参照検証が共通store/providerを使い、不在・digest不一致・権限拒否を成功にしない。
- [x] provider未接続を未接続として返し、公開定義の存在を本番接続済みと誤認させない。

最小仕様: [foundation-public-provider-v1](../specs/foundation-public-provider-v1.md)。配備と本番readbackは別の検証とする。

## 検証

公開providerの実store・HTTP・MCPテスト7件が通過。既存MCP/HTTP/streamableの25件と公開モジュール読込も通過。外付け作業環境で既定5秒に達したため、公開経路テストは`--testTimeout=30000`で確認した。本番の配備・正本provider接続は別途readbackが必要。
