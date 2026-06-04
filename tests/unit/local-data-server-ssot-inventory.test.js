// @ts-check
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    collectLocalInventory,
    compareWithServer,
    sha256
} from '../../scripts/local-data-server-ssot-inventory.js';

let tmp;

function write(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
}

describe('local data server SSOT inventory', () => {
    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ssot-inventory-'));
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('classifies local codex, wiki, and conversation sources without writing', () => {
        const codexRoot = path.join(tmp, '_codex');
        const wikiRoot = path.join(tmp, 'wiki');
        const homeDir = path.join(tmp, 'home');
        write(path.join(codexRoot, 'common/meta/people/ota_shi.md'), '# 大田氏\n');
        write(path.join(codexRoot, 'common/meta/customers/hotel_m.md'), '# HOTEL m\n');
        write(path.join(codexRoot, 'sns/drafts/post.md'), '# draft\n');
        write(path.join(codexRoot, 'projects/brainbase/01_strategy.md'), '# Strategy\n');
        write(path.join(wikiRoot, 'brainbase/page.md'), '# Wiki Page\n');
        write(path.join(homeDir, '.codex/history.jsonl'), '{"text":"GraphSSOTを綺麗にする"}\n');

        const items = collectLocalInventory({ codexRoot, wikiRoots: [wikiRoot], homeDir, includeWorkspaceContent: false });

        expect(items).toEqual(expect.arrayContaining([
            expect.objectContaining({ source_path: 'common/meta/people/ota_shi.md', target_table: 'graph_entities', target_type: 'person', migration_status: 'local_only' }),
            expect.objectContaining({ source_path: 'common/meta/customers/hotel_m.md', target_table: 'graph_entities', target_type: 'customer', migration_status: 'local_only' }),
            expect.objectContaining({ source_path: 'sns/drafts/post.md', target_table: 'graph_entities', target_type: 'document', source_subtype: 'sns_draft_document' }),
            expect.objectContaining({ source_path: 'projects/brainbase/01_strategy.md', target_table: 'graph_entities', target_type: 'document' }),
            expect.objectContaining({ source_path: 'brainbase/page', target_table: 'wiki_pages', target_type: 'wiki_page' }),
            expect.objectContaining({ source_path: '.codex/history.jsonl', target_table: 'memory_candidates', target_type: 'personal_kg_candidate', migration_status: 'needs_extraction' })
        ]));
        expect(items.every((item) => item.content_hash || item.migration_status === 'needs_extraction')).toBe(true);
    });

    it('compares local items to server rows without delete states', () => {
        const items = [
            { source_path: 'projects/brainbase/01_strategy.md', target_table: 'graph_entities', target_type: 'document', content_hash: sha256('same'), migration_status: 'local_only' },
            { source_path: 'brainbase/page', target_table: 'wiki_pages', target_type: 'wiki_page', content_hash: sha256('new'), migration_status: 'local_only' },
            { source_path: 'sns/drafts/post.md', target_table: 'graph_entities', target_type: 'document', content_hash: sha256('draft'), migration_status: 'local_only' },
            { source_path: '.codex/history.jsonl', target_table: 'memory_candidates', target_type: 'personal_kg_candidate', content_hash: sha256('log'), migration_status: 'needs_extraction' }
        ];
        const compared = compareWithServer(items, [
            { source_path: 'projects/brainbase/01_strategy.md', target_table: 'graph_entities', target_type: 'document', content_hash: sha256('same'), target_id: 'doc_1' },
            { source_path: 'brainbase/page', target_table: 'wiki_pages', target_type: 'wiki_page', content_hash: sha256('old'), target_id: 'wiki_1' },
            { source_path: 'sns/drafts/post.md', target_table: 'graph_entities', target_type: 'document', content_hash: null, target_id: 'doc_2' }
        ]);

        expect(compared.map((item) => item.migration_status)).toEqual([
            'existing_server_match',
            'conflict',
            'existing_server_path_only',
            'needs_extraction'
        ]);
        expect(compared.map((item) => item.migration_status)).not.toContain('delete');
    });
});
