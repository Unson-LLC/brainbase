# 組織向け接続クライアントの配布候補

## Story

組織の利用者として、雲孫内部の設定・コード全量を受け取らず、自社設定を使って組織MCPへ接続したい。

## 最小Spec

- 非公開共通本体内の packages/organization-client に依存なしNodeクライアントを置く。会社別本体フォークは作らない。
- 会社設定は外部JSONで明示し、API URL・MCP URL・組織IDを必須とする。既定の雲孫/Growin接続先を持たない。
- 既存Backlogのdevice auth、token refresh、strict MCP起動の契約を再利用する。
- トークンは組織と接続先に結び付け、設定変更で別接続先へ送らない。秘密値・HTTPレスポンスをエラーへ出さない。
- 設定不正・未認証は安全に停止する。起動引数でstrict MCP設定を上書きできないようにする。
- 許可リストでpackageを生成し、会社情報、運用設定、会話、秘密情報、Git履歴を含めない。npm公開はしない。
- 新規ディレクトリへ展開して起動検査し、既存OSSや保存データを書き換えない。削除せず旧起動へ戻せる。
- ローカルfixtureでの接続・認証・起動確認と、Growin実利用者の受入は区別する。

### Windowsクライアント

- Windowsではシェル経由で起動せず、`CLAUDE_CODE_EXECUTABLE` の絶対パス、または shell-free の `where.exe claude.exe` 解決結果にあるネイティブ `claude.exe`だけを起動する。npmの `claude.cmd` は `cmd.exe` 経由の解釈を避けるため対象外とする。
- Windowsのトークンと一時MCP設定は、秘密を書き込む前に `icacls.exe` で継承を外し、現在の利用者・SYSTEM・Administratorsに限定したACLを設定する。読み取り時もACLを検査し、継承・拒否エントリ・Everyone等の広い主体があれば停止する。主体の判定はロケールに依存しないSIDを優先する。
- ACLの読み取りに使うlegacy Windows PowerShellは、PowerShell 7から継承した `PSModulePath` を使わず、Windows標準モジュールのパスだけを子プロセスへ渡す。これにより `Microsoft.PowerShell.Security` の解決を固定する。実行ポリシーは変更しない。
- POSIXのモードビットだけではWindowsの保護を表せないため、WindowsではACL、macOS/Linuxでは従来の0600/0700を使う。既存のトークン親ディレクトリは、認証保存のためだけに不用意にACLを書き換えず、作成した親とファイルを個別に保護する。
- Windows実機でのACL・子プロセス・一時秘密の削除は `tests/integration/organization-client-windows.test.mjs` で検証する。macOS/Linuxでの実行はskipとなり、実Windows確認の代替にはしない。

## 配布境界

今回の成果物は組織向け接続クライアントであり、組織版サーバーや全Skillsの配布・受入完了とは呼ばない。
共通Skillsの全量コピーはしない。会社設定と取得手順は既存Backlogに置く。
配布候補を隔離環境で検証した後に、実稼働版・取得認証・利用者経路の不足を確認する。
