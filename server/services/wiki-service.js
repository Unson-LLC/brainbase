import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import crypto from 'crypto';
import { ulid } from 'ulid';
import { logger } from '../utils/logger.js';

const ROLE_RANK = { member: 1, gm: 2, ceo: 3 };

export class WikiService {
    /**
     * @param {Object} options
     * @param {string} options.wikiRoot - wiki/ ディレクトリの絶対パス
     * @param {import('pg').Pool|null} options.pool - PostgreSQL接続プール
     */
    constructor({ wikiRoot, pool }) {
        this.wikiRoot = wikiRoot;
        this.pool = pool;
        this._projectIdToSlug = null; // lazy-loaded cache: ULID → slug
    }

    // ────────────────── helpers ──────────────────

    /**
     * Load project ULID → slug mapping (cached)
     * Auth system uses slugs (salestailor, zeims), DB uses ULIDs (prj_01KG...)
     */
    async _getProjectSlugMap() {
        if (this._projectIdToSlug) return this._projectIdToSlug;
        this._projectIdToSlug = new Map();
        if (!this.pool) return this._projectIdToSlug;
        try {
            const { rows } = await this.pool.query(
                `SELECT id, payload->>'name' as name FROM graph_entities WHERE entity_type = 'project'`
            );
            const NAME_TO_SLUG = {
                'salestaylor': 'salestailor', 'SalesTailor': 'salestailor',
                'Tech Knight': 'tech-knight',
                'ncom (NTT Com DialogAI)': 'dialogai',
                'DetectiveAI（探偵業界向けAI報告書作成プラットフォーム）': 'detectiveai',
                'Postio（ポスティオ）': 'postio',
            };
            for (const row of rows) {
                const name = row.name || '';
                const slug = NAME_TO_SLUG[name] || name.toLowerCase().replace(/\s+/g, '-');
                this._projectIdToSlug.set(row.id, slug);
            }
        } catch (e) {
            logger.warn('Failed to load project slug map', { error: e.message });
        }
        return this._projectIdToSlug;
    }

    _normalizePath(rawPath) {
        // Remove leading/trailing slashes, .md extension
        let p = rawPath.replace(/^\/+|\/+$/g, '');
        if (p.endsWith('.md')) p = p.slice(0, -3);
        return p;
    }

    _toFilePath(wikiPath) {
        return path.join(this.wikiRoot, `${wikiPath}.md`);
    }

    _checkAccess(pageAccess, requesterAccess) {
        const requesterRole = requesterAccess?.role || 'member';
        const requesterClearance = requesterAccess?.clearance || [];

        const pageRoleMin = pageAccess?.role_min || 'member';
        const pageSensitivity = pageAccess?.sensitivity || 'internal';

        // Role check
        if ((ROLE_RANK[requesterRole] || 0) < (ROLE_RANK[pageRoleMin] || 0)) {
            return false;
        }

        // Sensitivity check: restricted/finance/hr/contract require matching clearance
        if (pageSensitivity !== 'internal') {
            if (!requesterClearance.includes(pageSensitivity)) {
                return false;
            }
        }

        // Project-based access control
        // project_id = NULL → all authenticated users can access
        const pageProjectId = pageAccess?.project_id;
        if (pageProjectId) {
            const requesterProjects = requesterAccess?.projectCodes || [];
            // projectCodes are slugs (salestailor), project_id is ULID (prj_01KG...)
            // Check both directly and via slug mapping
            const pageSlug = this._projectIdToSlug?.get(pageProjectId);
            if (!requesterProjects.includes(pageProjectId) &&
                !(pageSlug && requesterProjects.includes(pageSlug))) {
                return false;
            }
        }

        return true;
    }

    _extractTitle(content) {
        const match = content.match(/^#\s+(.+)$/m);
        return match ? match[1].trim() : null;
    }

    // ────────────────── DB helpers ──────────────────

    async _getPageAccess(wikiPath) {
        if (!this.pool) return null;
        try {
            const { rows } = await this.pool.query(
                'SELECT role_min, sensitivity, project_id FROM wiki_pages WHERE path = $1',
                [wikiPath]
            );
            return rows[0] || null;
        } catch (error) {
            logger.warn('Wiki DB query failed, using defaults', { error: error.message });
            return null;
        }
    }

    async _upsertPageAccess(wikiPath, { title, roleMin, sensitivity, projectId }) {
        if (!this.pool) return;
        const id = `wiki_${ulid()}`;
        await this.pool.query(
            `INSERT INTO wiki_pages (id, path, title, role_min, sensitivity, project_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
             ON CONFLICT (path)
             DO UPDATE SET
               title = COALESCE(NULLIF($3, ''), wiki_pages.title),
               role_min = COALESCE($4, wiki_pages.role_min),
               sensitivity = COALESCE($5, wiki_pages.sensitivity),
               project_id = COALESCE($6, wiki_pages.project_id),
               updated_at = NOW()`,
            [id, wikiPath, title || wikiPath.split('/').pop(), roleMin || 'member', sensitivity || 'internal', projectId || null]
        );
    }

    async _deletePageAccess(wikiPath) {
        if (!this.pool) return;
        await this.pool.query('DELETE FROM wiki_pages WHERE path = $1', [wikiPath]);
    }

    async _getAllPageAccess() {
        if (!this.pool) return new Map();
        try {
            const { rows } = await this.pool.query('SELECT path, role_min, sensitivity, project_id FROM wiki_pages');
            const map = new Map();
            for (const row of rows) {
                map.set(row.path, row);
            }
            return map;
        } catch (error) {
            logger.warn('Wiki DB query failed', { error: error.message });
            return new Map();
        }
    }

    // ────────────────── file helpers ──────────────────

    async _collectMdFiles(dir, prefix = '') {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const results = [];
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                results.push(...await this._collectMdFiles(fullPath, relPath));
            } else if (entry.name.endsWith('.md')) {
                results.push(relPath.slice(0, -3)); // Remove .md
            }
        }
        return results;
    }

    // ────────────────── public API ──────────────────

    /**
     * ページ一覧を取得（権限フィルタ済み）
     */
    async listPages(access) {
        if (!existsSync(this.wikiRoot)) {
            return [];
        }

        await this._getProjectSlugMap(); // ensure slug map is loaded
        const filePaths = await this._collectMdFiles(this.wikiRoot);
        const accessMap = await this._getAllPageAccess();

        const pages = [];
        for (const wikiPath of filePaths) {
            const pageAccess = accessMap.get(wikiPath) || { role_min: 'member', sensitivity: 'internal' };
            if (!this._checkAccess(pageAccess, access)) continue;

            // Read first line for title
            const filePath = this._toFilePath(wikiPath);
            let title = wikiPath.split('/').pop();
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                const extracted = this._extractTitle(content);
                if (extracted) title = extracted;
            } catch { /* use default title */ }

            pages.push({
                path: wikiPath,
                title,
                role_min: pageAccess.role_min,
                sensitivity: pageAccess.sensitivity,
                project_id: pageAccess.project_id || null
            });
        }

        return pages.sort((a, b) => a.path.localeCompare(b.path));
    }

    /**
     * ページ取得（権限チェック付き）
     */
    async getPage(access, rawPath) {
        await this._getProjectSlugMap();
        const wikiPath = this._normalizePath(rawPath);
        const filePath = this._toFilePath(wikiPath);

        // 権限チェック
        const pageAccess = await this._getPageAccess(wikiPath) || { role_min: 'member', sensitivity: 'internal' };
        if (!this._checkAccess(pageAccess, access)) {
            return { error: 'forbidden', status: 403 };
        }

        // ファイル読み込み
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const title = this._extractTitle(content) || wikiPath.split('/').pop();
            return {
                path: wikiPath,
                title,
                content,
                role_min: pageAccess.role_min,
                sensitivity: pageAccess.sensitivity,
                project_id: pageAccess.project_id || null
            };
        } catch (error) {
            if (error.code === 'ENOENT') {
                return { error: 'not_found', status: 404 };
            }
            throw error;
        }
    }

    /**
     * ページ作成/更新
     */
    async savePage(access, rawPath, content) {
        await this._getProjectSlugMap();
        const wikiPath = this._normalizePath(rawPath);
        const filePath = this._toFilePath(wikiPath);

        // 権限チェック（既存ページの場合）
        const existingAccess = await this._getPageAccess(wikiPath);
        if (existingAccess && !this._checkAccess(existingAccess, access)) {
            return { error: 'forbidden', status: 403 };
        }

        // ディレクトリ作成
        await fs.mkdir(path.dirname(filePath), { recursive: true });

        // ファイル書き込み
        await fs.writeFile(filePath, content, 'utf-8');

        // DB更新
        const title = this._extractTitle(content) || wikiPath.split('/').pop();
        await this._upsertPageAccess(wikiPath, { title });

        return { path: wikiPath, title, success: true };
    }

    /**
     * ページ削除
     */
    async deletePage(access, rawPath) {
        await this._getProjectSlugMap();
        const wikiPath = this._normalizePath(rawPath);
        const filePath = this._toFilePath(wikiPath);

        // 権限チェック
        const pageAccess = await this._getPageAccess(wikiPath) || { role_min: 'member', sensitivity: 'internal' };
        if (!this._checkAccess(pageAccess, access)) {
            return { error: 'forbidden', status: 403 };
        }

        try {
            await fs.unlink(filePath);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return { error: 'not_found', status: 404 };
            }
            throw error;
        }

        await this._deletePageAccess(wikiPath);
        return { success: true };
    }

    /**
     * ページ権限設定（管理者用）
     */
    async setPageAccess(rawPath, { roleMin, sensitivity, projectId }) {
        const wikiPath = this._normalizePath(rawPath);
        await this._upsertPageAccess(wikiPath, { roleMin, sensitivity, projectId });
        return { success: true, path: wikiPath };
    }

    // ────────────────── sync API ──────────────────

    /**
     * Get manifest of all accessible pages with content hashes
     */
    async getManifest(access) {
        await this._getProjectSlugMap();
        if (!existsSync(this.wikiRoot)) {
            return [];
        }

        const filePaths = await this._collectMdFiles(this.wikiRoot);
        const accessMap = await this._getAllPageAccess();

        const manifest = [];
        for (const wikiPath of filePaths) {
            const pageAccess = accessMap.get(wikiPath) || { role_min: 'member', sensitivity: 'internal' };
            if (!this._checkAccess(pageAccess, access)) continue;

            const filePath = this._toFilePath(wikiPath);
            try {
                const stat = await fs.stat(filePath);
                const content = await fs.readFile(filePath, 'utf-8');
                const contentHash = crypto.createHash('sha256').update(content).digest('hex');

                manifest.push({
                    path: wikiPath,
                    content_hash: contentHash,
                    size_bytes: stat.size,
                    updated_at: stat.mtime.toISOString(),
                    project_id: pageAccess.project_id || null
                });
            } catch {
                // Skip files that can't be read
            }
        }

        return manifest.sort((a, b) => a.path.localeCompare(b.path));
    }

    /**
     * Bulk get pages (for sync pull)
     */
    async bulkGetPages(access, paths) {
        const results = [];
        for (const rawPath of paths) {
            const result = await this.getPage(access, rawPath);
            if (!result.error) {
                // Add content_hash for sync
                const contentHash = crypto.createHash('sha256').update(result.content).digest('hex');
                results.push({ ...result, content_hash: contentHash });
            }
            // Skip forbidden/not_found silently in bulk operations
        }
        return results;
    }

    /**
     * Bulk save pages (for sync push) with conflict detection
     */
    async bulkSavePages(access, pages) {
        await this._getProjectSlugMap();
        const results = [];
        for (const { path: rawPath, content, if_unmodified_since } of pages) {
            const wikiPath = this._normalizePath(rawPath);
            const filePath = this._toFilePath(wikiPath);

            // Permission check
            const existingAccess = await this._getPageAccess(wikiPath);
            if (existingAccess && !this._checkAccess(existingAccess, access)) {
                results.push({ path: wikiPath, error: 'forbidden' });
                continue;
            }

            // Conflict detection via timestamp
            if (if_unmodified_since) {
                try {
                    const stat = await fs.stat(filePath);
                    const serverMtime = stat.mtime.getTime();
                    const clientMtime = new Date(if_unmodified_since).getTime();
                    if (serverMtime > clientMtime) {
                        const serverContent = await fs.readFile(filePath, 'utf-8');
                        results.push({
                            path: wikiPath,
                            error: 'conflict',
                            server_updated_at: stat.mtime.toISOString(),
                            server_content: serverContent
                        });
                        continue;
                    }
                } catch (e) {
                    // File doesn't exist yet, no conflict
                    if (e.code !== 'ENOENT') throw e;
                }
            }

            // Save the page
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, content, 'utf-8');

            const title = this._extractTitle(content) || wikiPath.split('/').pop();
            const contentHash = crypto.createHash('sha256').update(content).digest('hex');
            const sizeBytes = Buffer.byteLength(content, 'utf-8');

            await this._upsertPageMeta(wikiPath, { title, contentHash, sizeBytes });

            results.push({ path: wikiPath, success: true, content_hash: contentHash });
        }
        return results;
    }

    /**
     * Upsert page metadata including sync fields
     */
    async _upsertPageMeta(wikiPath, { title, roleMin, sensitivity, projectId, contentHash, sizeBytes }) {
        if (!this.pool) return;
        const id = `wiki_${ulid()}`;
        await this.pool.query(
            `INSERT INTO wiki_pages (id, path, title, role_min, sensitivity, project_id, content_hash, size_bytes, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
             ON CONFLICT (path)
             DO UPDATE SET
               title = COALESCE(NULLIF($3, ''), wiki_pages.title),
               role_min = COALESCE($4, wiki_pages.role_min),
               sensitivity = COALESCE($5, wiki_pages.sensitivity),
               project_id = COALESCE($6, wiki_pages.project_id),
               content_hash = COALESCE($7, wiki_pages.content_hash),
               size_bytes = COALESCE($8, wiki_pages.size_bytes),
               updated_at = NOW()`,
            [id, wikiPath, title || wikiPath.split('/').pop(), roleMin || 'member', sensitivity || 'internal', projectId || null, contentHash || null, sizeBytes || null]
        );
    }
}
