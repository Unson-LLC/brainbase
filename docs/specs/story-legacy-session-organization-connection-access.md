# Spec: 旧セッションのtenant正規化

`requireAuth` は、検証済みJWTに `tenantId` があっても、それが正規 `ten_*` でなければ未解決として扱う。`organizationId` と既存のtenant resolverで正規tenantへ置き換え、後段の組織接続APIへ渡す。

resolverが失敗または不一致を返した場合は旧値を成功扱いせず、後段の正規ID検証で拒否する。DBやJWTは書き換えない。

