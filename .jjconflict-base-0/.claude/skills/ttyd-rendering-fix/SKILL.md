---
name: ttyd-rendering-fix
description: ttyd/xterm.jsの描画崩れ・Reconnectingループを診断・修復する手順。ポート競合・重複プロセス・tmuxバッファ破損・WebGLキャッシュ破損を体系的に解決。
metadata:
  short-description: ttyd描画崩れ即修復
---

# ttyd Rendering Fix

ブラウザ上のttydターミナルが描画崩れ（ドットパターン充填、文字化け）やReconnectingループに陥ったときの診断・修復手順。

## 症状パターン

| 症状 | 原因 | 修復レベル |
|------|------|-----------|
| 右側がドットパターンで埋まる | xterm.js WebGLレンダラー破損 | Chrome再起動 |
| Reconnecting連続（特定セッション） | tmuxセッション消失 or ttyd重複 | tmux再作成 or 重複削除 |
| Reconnecting連続（全セッション） | ttyd重複プロセス（サーバー再起動起因） | 全重複プロセス削除 + Chrome再起動 |
| Reconnecting連続（PTYリーク） | ttydのPTYファイルディスクリプタ蓄積 | stop + start API |
| リロードしても直らない | tmuxバッファ破損 + WebGLキャッシュ | ttyd再起動 + Chrome再起動 |

## 診断フロー（この順番で実行）

### Step 1: ポート競合・重複プロセス確認（最頻出原因）

```bash
# 全ttydプロセスのポート・セッション一覧
ps aux | grep ttyd | grep -v grep | while read line; do
  port=$(echo "$line" | grep -o '\-p [0-9]*' | awk '{print $2}')
  pid=$(echo "$line" | awk '{print $2}')
  session=$(echo "$line" | grep -o 'session-[0-9]*')
  echo "port:$port  pid:$pid  $session"
done | sort -t: -k2 -n

# 同一セッションに複数ttydが割り当てられてないか
ps aux | grep ttyd | grep -v grep | sed 's/.*-b \/console\///' | sed 's/ .*//' | sort | uniq -c | sort -rn | head -10
```

**2以上のカウントがあれば重複** → Step 3で修復。

### Step 1.5: tmuxセッション存在確認（Reconnecting時は必ず実施）

```bash
# 全アクティブセッションのtmux存在チェック（一括）
python3 -c "
import json, subprocess
with open('/Users/ksato/workspace/code/brainbase/var/state.json') as f:
    state = json.load(f)
active = [s for s in state['sessions'] if s.get('intendedState') == 'active']
result = subprocess.run(['tmux', 'list-sessions', '-F', '#{session_name}'], capture_output=True, text=True)
tmux_sessions = set(result.stdout.strip().split('\n')) if result.stdout.strip() else set()
for s in active:
    sid = s['id']
    name = s.get('name', '?')
    pid = s.get('ttydProcess', {}).get('pid', '?')
    pid_check = subprocess.run(['ps', '-p', str(pid), '-o', 'pid='], capture_output=True, text=True)
    pid_alive = pid_check.returncode == 0 and pid_check.stdout.strip()
    issues = []
    if sid not in tmux_sessions: issues.append('NO_TMUX')
    if not pid_alive: issues.append('DEAD_PID')
    status = 'OK' if not issues else ','.join(issues)
    print(f'{status:12s}  {name:40s} {sid}  pid:{pid}')
"
```

**NO_TMUX**: tmuxセッションが消失。ttydがlogin_script.shを実行してもtmux attachできず即終了→Reconnecting。
ブラウザで開き直せばlogin_script.shが新規tmux作成するが、既存の作業コンテキストは失われる。

**DEAD_PID**: ttydプロセスが死亡。brainbaseサーバーのrestore APIで復旧可能。

### Step 1.8: PTYリーク確認（最重要 — Reconnecting時は必ず実施）

ttydプロセスが蓄積した `/dev/ptmx` ファイルディスクリプタを確認。WebSocket再接続のたびにPTYが新規割当されるが、クリーンアップされないためリークする。

```bash
# 全アクティブセッションのPTYリーク一括スキャン
python3 -c "
import json, subprocess, re
with open('/Users/ksato/workspace/code/brainbase/var/state.json') as f:
    state = json.load(f)
active = [s for s in state['sessions'] if s.get('intendedState') == 'active']
print(f'{'STATUS':8s}  {'PTMX':>5s}  {'CHILDREN':>8s}  {'NAME':40s}  {'SESSION_ID':30s}  PID')
print('-' * 120)
for s in active:
    sid = s['id']
    name = s.get('name', '?')
    pid = s.get('ttydProcess', {}).get('pid', '?')
    if not isinstance(pid, int):
        print(f'{'NO_PID':8s}  {'?':>5s}  {'?':>8s}  {name:40s}  {sid:30s}  {pid}')
        continue
    # PTY count
    result = subprocess.run(f'lsof -p {pid} 2>/dev/null | grep -c ptmx', shell=True, capture_output=True, text=True)
    ptmx = int(result.stdout.strip()) if result.stdout.strip().isdigit() else 0
    # Children count
    result2 = subprocess.run(f'pgrep -P {pid} | wc -l', shell=True, capture_output=True, text=True)
    children = int(result2.stdout.strip())
    status = 'LEAK' if ptmx > 10 else 'WARN' if ptmx > 5 else 'OK'
    if children > 0:
        status = 'STUCK'
    print(f'{status:8s}  {ptmx:5d}  {children:8d}  {name:40s}  {sid:30s}  {pid}')
"
```

**判定基準**:
- **OK**: ptmx 0-5 → 正常
- **WARN**: ptmx 6-10 → 要注意（放置すると悪化）
- **LEAK**: ptmx 11以上 → 修復必須（Step 3dで修復）
- **STUCK**: 子プロセスあり → WebSocket即切断状態、修復必須（Step 3dで修復）

**発生メカニズム**: ブラウザリロード/セッション切替/ネットワーク断 → WebSocket切断 → ttyd内部の再接続 + brainbase TerminalReconnectManagerの再接続 → 二重再接続でPTY高速蓄積 → tmux子プロセスがスタック → 全新規WebSocket接続が即code 1006で切断 → 正のフィードバックループ

### Step 2: state.jsonと実プロセスの整合性確認

```bash
# 対象セッションIDを特定（例: session-XXXXX）
SESSION_ID="session-XXXXX"

# state.jsonが認識しているポート・PID
python3 -c "
import json
with open('/Users/ksato/workspace/code/brainbase/var/state.json') as f:
    state = json.load(f)
for s in state['sessions']:
    if s['id'] == '$SESSION_ID':
        t = s.get('ttydProcess', {})
        print(f'state.json -> port:{t.get(\"port\")}  pid:{t.get(\"pid\")}')
        break
"

# 実際にそのPIDが生きてるか
ps -p <PID> -o pid,command 2>/dev/null || echo "PID is DEAD"

# 実際にそのポートで何が動いてるか
lsof -i :<PORT> 2>/dev/null
```

**state.jsonのポートと実プロセスのポートが違う場合がReconnectingの原因。**

### Step 3: 修復

#### 3a: 重複ttydプロセスの一括削除

```bash
# 全重複ttydプロセスを検出して、state.jsonの正PID以外を殺す（一括版）
python3 -c "
import json, subprocess, re
with open('/Users/ksato/workspace/code/brainbase/var/state.json') as f:
    state = json.load(f)

# state.jsonの正PIDマップ: session_id -> pid
legit_pids = {}
for s in state['sessions']:
    if s.get('intendedState') == 'active':
        t = s.get('ttydProcess', {})
        if t.get('pid'):
            legit_pids[s['id']] = t['pid']

# 全ttydプロセスを取得
result = subprocess.run(['ps', 'aux'], capture_output=True, text=True)
stale_pids = []
for line in result.stdout.strip().split('\n'):
    if 'ttyd' not in line or 'grep' in line:
        continue
    parts = line.split()
    pid = int(parts[1])
    session_match = re.search(r'session-\d+', line)
    if session_match:
        sid = session_match.group()
        if sid in legit_pids and legit_pids[sid] != pid:
            stale_pids.append((pid, sid))
            print(f'STALE: pid={pid} {sid} (legit={legit_pids[sid]})')

if stale_pids:
    print(f'\nKilling {len(stale_pids)} stale processes...')
    for pid, sid in stale_pids:
        subprocess.run(['kill', str(pid)])
        print(f'  killed {pid} ({sid})')
else:
    print('No stale ttyd processes found.')
"
```

**重要**: state.jsonが指すPIDが「正」。brainbaseサーバーのin-memoryステートが正本であり、state.jsonを手動編集してもサーバー再起動時に上書きされる。

#### 3b: tmuxバッファリセット（描画崩れ対策）

```bash
SESSION_ID="session-XXXXX"

# Claude Code / Codexを終了
tmux send-keys -t $SESSION_ID C-c
sleep 0.5
tmux send-keys -t $SESSION_ID C-c
sleep 0.5
tmux send-keys -t $SESSION_ID "/exit" Enter
sleep 2

# バッファクリア + ターミナルリセット
tmux clear-history -t $SESSION_ID
tmux send-keys -t $SESSION_ID "reset" Enter
```

#### 3d: PTYリーク修復（stop + start API — 推奨）

PTYリークが検出されたセッションをAPI経由で再起動。tmuxは残るので作業内容は失われない。

```bash
# 単一セッションの修復（tmux保持）
SESSION_ID="session-XXXXX"
SERVER_PORT=31013  # brainbaseサーバーのポート

# 1. stop（preserveTmux=trueでtmuxを残してttydのみ停止）
curl -s -X POST http://localhost:${SERVER_PORT}/api/sessions/${SESSION_ID}/stop \
  -H 'Content-Type: application/json' \
  -d '{"preserveTmux": true}'

# 2. start（新規ttydプロセスを新ポートで起動、既存tmuxにattach）
curl -s -X POST http://localhost:${SERVER_PORT}/api/sessions/start \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\":\"${SESSION_ID}\"}"
```

```bash
# 全PTYリークセッションの一括修復（tmux保持版）
SERVER_PORT=31013
python3 << 'PYEOF'
import json, subprocess, time
with open('/Users/ksato/workspace/code/brainbase/var/state.json') as f:
    state = json.load(f)
active = [s for s in state['sessions'] if s.get('intendedState') == 'active']
leaked = []
for s in active:
    pid = s.get('ttydProcess', {}).get('pid')
    if not isinstance(pid, int):
        continue
    result = subprocess.run(f'lsof -p {pid} 2>/dev/null | grep -c ptmx', shell=True, capture_output=True, text=True)
    ptmx = int(result.stdout.strip()) if result.stdout.strip().isdigit() else 0
    if ptmx > 5:
        leaked.append((s['id'], s.get('name', '?'), ptmx))

print(f'Found {len(leaked)} leaked sessions')
for sid, name, ptmx in leaked:
    print(f'  Fixing {name} ({sid}) ptmx={ptmx}...')
    # stop with preserveTmux=true
    subprocess.run(['curl', '-s', '-X', 'POST',
        f'http://localhost:{SERVER_PORT}/api/sessions/{sid}/stop',
        '-H', 'Content-Type: application/json',
        '-d', '{"preserveTmux": true}'], capture_output=True)
    time.sleep(0.5)
    # start
    result = subprocess.run(['curl', '-s', '-X', 'POST',
        f'http://localhost:{SERVER_PORT}/api/sessions/start',
        '-H', 'Content-Type: application/json',
        '-d', json.dumps({'sessionId': sid})], capture_output=True, text=True)
    print(f'    -> {result.stdout.strip()}')
    time.sleep(0.3)
print('Done')
PYEOF
```

**重要**:
- `preserveTmux: true` を指定すると、ttydプロセスのみ停止してtmuxセッション（作業内容・スクロールバック）は保持される
- `preserveTmux` を省略（デフォルト: false）すると従来通りtmuxも削除される
- stop APIは`activeSessions` Mapのエントリを削除する。ttydを外部から`kill`しただけではMapに古いエントリが残り、`startTtyd()`が死んだプロセスのポートを返し続ける。必ずAPIを使うこと。

#### 3c: ttyd再起動（最終手段）

tmuxは残るので作業内容は失われない。

```bash
SESSION_ID="session-XXXXX"

# 1. state.jsonから正しいポート・パスを取得
python3 -c "
import json
with open('/Users/ksato/workspace/code/brainbase/var/state.json') as f:
    state = json.load(f)
for s in state['sessions']:
    if s['id'] == '$SESSION_ID':
        t = s.get('ttydProcess', {})
        print(f'PORT={t.get(\"port\")}')
        print(f'PID={t.get(\"pid\")}')
        print(f'ENGINE={s.get(\"engine\", \"claude\")}')
        print(f'PATH={s.get(\"path\", \"\")}')
        break
"

# 2. 古いttydを殺す
kill <PID>

# 3. 同じポートで再起動
ttyd -p <PORT> -W \
  -b /console/$SESSION_ID \
  -I /Users/ksato/workspace/code/brainbase/public/ttyd/custom_ttyd_index.html \
  -t disableLeaveAlert=true \
  -t enableClipboard=true \
  -t fontSize=14 \
  -t fontFamily=Menlo \
  -t scrollback=5000 \
  /Users/ksato/workspace/code/brainbase/scripts/login_script.sh $SESSION_ID <PATH> <ENGINE> &

# 4. state.jsonのPIDを更新
python3 -c "
import json
with open('/Users/ksato/workspace/code/brainbase/var/state.json') as f:
    state = json.load(f)
for s in state['sessions']:
    if s['id'] == '$SESSION_ID':
        s['ttydProcess']['pid'] = <NEW_PID>
        break
with open('/Users/ksato/workspace/code/brainbase/var/state.json', 'w') as f:
    json.dump(state, f, indent=2, ensure_ascii=False)
"
```

### Step 4: ブラウザ側（必須）

ttyd側を修復した後、**Chrome再起動**が必要。

- ページリロード（Cmd+R）ではxterm.jsのWebGLコンテキストがリセットされない
- Chrome自体を再起動すればWebGLキャッシュ + WebSocket接続プールが完全リセットされる

## 根本原因メモ

- **PTYリーク（最頻出）**: WebSocket切断→再接続のたびにttydが新PTY（`/dev/ptmx`）を割当するがクリーンアップしない。ttyd内部の再接続とbrainbase TerminalReconnectManagerの二重再接続が高速蓄積を引き起こす。PTY数が閾値を超えるとtmux子プロセスがスタック（`kill -9`でも死なない）し、全新規WebSocket接続がcode 1006で即切断される正のフィードバックループに陥る。15/21セッションで9-360個のPTYリーク実績あり
- **startTtyd()の生存チェック欠如**: `activeSessions` MapにエントリがあればPIDの生死を確認せず既存ポートを返す。ttydが死んでいてもMapに残っていると死んだポートを返し続け、新規起動に進まない
- **重複ttyd**: brainbaseサーバー再起動時（launchd KeepAlive）に`restoreActiveSessions`が新ポートでttydを起動するが、古いプロセスを殺さないケースがある。9個以上の重複が発生した実績あり
- **tmux消失**: Claude Code/Codex CLIが終了するとtmuxセッションが空になり、一定時間後にtmuxが自動破棄。ttydはまだ生きているが、login_script.shの`tmux attach`が失敗してReconnectingになる
- **描画崩れ**: Claude Code / Codex CLIのTUI出力（進捗バー、Unicode装飾文字）がxterm.jsのWebGLレンダラーを破損させる
- **Reconnecting（全セッション）**: 重複ttydプロセスが同一proxy経路で競合。Chrome側のWebSocket接続プールも汚染される
- **Reconnecting（特定セッション）**: tmuxセッション消失、PTYリーク、またはstate.jsonとttydプロセスのポート不一致
- **state.json手動編集が無効**: brainbaseサーバーはin-memoryでstate管理。state.jsonを直接編集しても、サーバーのステート保存タイミングで上書きされる

## 予防策（将来の改善候補）

- [x] `startTtyd()`にプロセス生存チェック追加（`_isProcessRunning()`で死んだプロセスを検知→Map削除→新規起動）
- [ ] `restoreActiveSessions`で古いttydプロセスをクリーンアップしてから再起動
- [ ] state.json更新時にin-memoryキャッシュも同期
- [ ] ttyd起動時にポート競合チェック追加
- [ ] tmux消失検知 → 自動再作成 or セッションステータス更新
- [ ] 二重再接続の抑制（ttyd内部の再接続 vs TerminalReconnectManagerの競合解消）
- [ ] 定期ヘルスチェックでPTYリーク検知 → 自動stop+start
