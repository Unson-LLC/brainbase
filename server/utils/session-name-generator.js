/**
 * セッション名自動生成ユーティリティ（サーバー側）
 *
 * 命名規則: {project}-{MMDD}-{連番}
 * 例: brainbase-0216-1, salestailor-0216-2
 */

/**
 * パスからプロジェクト名を抽出（サーバー側用、簡易版）
 * @param {Object} session - セッションオブジェクト
 * @returns {string} プロジェクト名
 */
function getProjectFromSession(session) {
    if (session.project) return session.project;

    const sessionPath = session.path || session.worktree?.path || '';

    // worktreeパスからプロジェクト名を抽出
    const worktreeMatch = sessionPath.match(/\.worktrees\/session-\d+-(.+?)(?:\/|$)/);
    if (worktreeMatch) {
        const hint = worktreeMatch[1];
        if (hint === 'workspace') return 'general';
        return hint;
    }

    return 'general';
}

/** RegExp特殊文字をエスケープ */
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 既存セッション名を遡及リネーム（名前が空 or session-{ts} 形式のもの）
 * @param {Array} sessions - 全セッション配列
 * @returns {Array} 名前が更新されたセッション配列
 */
export function retroactiveRename(sessions) {
    const seqCounters = {};

    // createdAt 順にソート（古い順）
    const sorted = [...sessions].sort((a, b) => {
        const aTime = new Date(a.created || a.createdAt || 0).getTime();
        const bTime = new Date(b.created || b.createdAt || 0).getTime();
        return aTime - bTime;
    });

    const updatedMap = new Map();

    for (const session of sorted) {
        const name = session.name || '';
        const needsRename = !name || /^session-\d+$/.test(name);

        if (!needsRename) {
            // 連番追跡だけ更新
            const project = getProjectFromSession(session) || 'general';
            const created = new Date(session.created || session.createdAt || Date.now());
            const mm = String(created.getMonth() + 1).padStart(2, '0');
            const dd = String(created.getDate()).padStart(2, '0');
            const prefix = `${project}-${mm}${dd}`;
            const pattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`);
            const match = name.match(pattern);
            if (match) {
                const seq = parseInt(match[1], 10);
                seqCounters[prefix] = Math.max(seqCounters[prefix] || 0, seq);
            }
            updatedMap.set(session.id, session);
            continue;
        }

        // リネーム対象
        const project = getProjectFromSession(session) || 'general';
        const created = new Date(session.created || session.createdAt || Date.now());
        const mm = String(created.getMonth() + 1).padStart(2, '0');
        const dd = String(created.getDate()).padStart(2, '0');
        const prefix = `${project}-${mm}${dd}`;

        seqCounters[prefix] = (seqCounters[prefix] || 0) + 1;
        const newName = `${prefix}-${seqCounters[prefix]}`;

        updatedMap.set(session.id, { ...session, name: newName });
    }

    // 元の順序を保持して返す
    return sessions.map(s => updatedMap.get(s.id) || s);
}
