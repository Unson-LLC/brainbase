#!/usr/bin/env bash
# Wiki構造再編成スクリプト
# フラットな構造を _common/ + プロジェクト に整理する

set -euo pipefail

WIKI_ROOT="/Users/ksato/workspace/wiki"
DRY_RUN="${1:-}"

log() { echo "[reorg] $*"; }

do_cmd() {
    if [ "$DRY_RUN" = "--dry-run" ]; then
        echo "  [dry-run] $*"
    else
        eval "$@"
    fi
}

merge_prj() {
    local prj_id="$1"
    local target="$2"
    local src_dir="$WIKI_ROOT/$prj_id"

    [ -d "$src_dir" ] || return 0

    log "  統合: $prj_id → $target"

    # decisions内のSmokeテストデータを除去、残りをマージ
    if [ -d "$src_dir/decisions" ]; then
        for f in "$src_dir/decisions/"*.md; do
            [ -f "$f" ] || continue
            local filename
            filename=$(basename "$f")
            if head -1 "$f" | grep -qi "smoke"; then
                log "    削除(Smoke): $filename"
                do_cmd "rm '$f'"
                continue
            fi
            local target_dir="$WIKI_ROOT/$target/decisions"
            do_cmd "mkdir -p '$target_dir'"
            if [ ! -f "$target_dir/$filename" ]; then
                log "    移動: $filename → $target/decisions/"
                do_cmd "mv '$f' '$target_dir/$filename'"
            else
                log "    スキップ(既存): $filename"
            fi
        done
    fi

    # decisions以外のファイルもマージ
    for f in "$src_dir/"*.md; do
        [ -f "$f" ] || continue
        local filename
        filename=$(basename "$f")
        if [ ! -f "$WIKI_ROOT/$target/$filename" ]; then
            log "    移動: $filename → $target/"
            do_cmd "mv '$f' '$WIKI_ROOT/$target/$filename'"
        fi
    done

    # prj_* フォルダを削除
    if [ "$DRY_RUN" != "--dry-run" ]; then
        find "$src_dir" -type d -empty -delete 2>/dev/null || true
        [ -d "$src_dir" ] && rm -rf "$src_dir" && log "    削除: $prj_id/"
    fi
}

# ─── Step 1: 共通知識を _common/ に移動 ───
log "Step 1: 共通知識を _common/ 配下に移動"

do_cmd "mkdir -p '$WIKI_ROOT/_common'"

for dir in people orgs raci glossary customers contracts financials meta; do
    if [ -d "$WIKI_ROOT/$dir" ]; then
        log "  移動: $dir → _common/$dir"
        do_cmd "mv '$WIKI_ROOT/$dir' '$WIKI_ROOT/_common/$dir'"
    fi
done

# トップレベルの decisions → _common/decisions
if [ -d "$WIKI_ROOT/decisions" ]; then
    log "  移動: decisions → _common/decisions"
    do_cmd "mv '$WIKI_ROOT/decisions' '$WIKI_ROOT/_common/decisions'"
fi

# ─── Step 2: prj_* フォルダを正しいプロジェクトに統合 ───
log "Step 2: prj_* フォルダを正しいプロジェクトに統合"

merge_prj "prj_01KGBCB8REVV0EMGAAYF0ZFJ1C" "brainbase"
merge_prj "prj_01KGBERGYCMMPEVA1WXYT01239" "salestailor"
merge_prj "prj_01KGBERH10H0FYYDR3WJ0XNZTG" "techknight"
merge_prj "prj_01KGBERH4J0C55Y003Z424JD8B" "unson-os"
merge_prj "prj_01KGBERH4QMK1ZRBVHAT0FKP7D" "zeims"

# ─── Step 3: サマリー ───
log ""
log "=== 再編成後の構造 ==="

if [ "$DRY_RUN" != "--dry-run" ]; then
    echo ""
    echo "_common/:"
    ls -1 "$WIKI_ROOT/_common/" 2>/dev/null | sed 's/^/  /'
    echo ""
    echo "プロジェクト:"
    for d in "$WIKI_ROOT"/*/; do
        name=$(basename "$d")
        [ "$name" = "_common" ] && continue
        count=$(find "$d" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
        echo "  $name/ ($count files)"
    done
    echo ""
    echo "残存 prj_* フォルダ:"
    ls -1d "$WIKI_ROOT"/prj_* 2>/dev/null | sed 's/^/  /' || echo "  なし"
fi

log "完了!"
