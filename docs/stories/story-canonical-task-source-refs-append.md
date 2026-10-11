# Story: 既存Taskの参照を保持して追加する

状態: 実装候補。公開版への反映と利用側検証は未完了。

Taskを利用する人として、既存の参照を上書きせずに新しい参照を追加し、同じ操作の再送で参照を重複させたくない。

## 受入条件

1. `CanonicalTaskService.updateTask`の任意入力`source_refs_append`で、現在の参照を保持して追加できる。
2. plain JSON objectの配列を受け付け、Unicodeを含むobjectキーの順序だけが違う同じ参照は追加を重複させない。既存の参照の順序と既存重複は維持する。
3. 同じoperationのキー順を変えた再送はversionを増やさず、同じ更新結果を返す。
4. 既存のpolicy、principal、scope、expected version、writer、監査を再利用する。不正入力とstale versionでは保存済みTaskを変更しない。
5. `source_refs`の置換更新と、追記を指定しない操作の既存fingerprintを維持する。置換と追記の同時指定は拒否する。
6. 特定の開発製品、組織サービス、ホストされたAPIを必須にせず、Brainbase単独で利用できる。

仕様: [Task参照の追記](../specs/canonical-task-source-refs-append.md)

本Storyの実装検証は共通serviceの範囲。HTTP/MCPの入口、実利用Taskへの認証付き保存・再取得、本番進捗送信、機能検収は利用側で別途確認する。
