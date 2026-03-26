import fs from 'fs';
import path from 'path';
import frontMatter from 'front-matter';
import { getAuth, getConfig } from './config.js';

function getHeaders(auth) {
    if (!auth) {
        throw new Error('Not logged in. Run: brainbase auth login');
    }
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.token}`
    };
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

export function renderPromotionManifest(candidate) {
    const attrs = [
        '---',
        `candidate_id: ${candidate.id}`,
        `pillar: ${candidate.pillar}`,
        `target_ref: ${candidate.target_ref}`,
        `status: ${candidate.status}`,
        `risk_level: ${candidate.risk_level}`,
        `doc_type: ${candidate.doc_type || ''}`,
        `target_project_id: ${candidate.target_project_id || ''}`,
        `apply_mode: ${candidate.apply_mode || 'manual'}`,
        `apply_error: ${candidate.apply_error || ''}`,
        `materialized_ref: ${candidate.materialized_ref || ''}`,
        `source_episode_ids: [${(candidate.source_episode_ids || []).join(', ')}]`,
        `linked_wiki_candidate_id: ${candidate.linked_wiki_candidate_id || ''}`,
        `linked_candidate_ids: [${(candidate.linked_candidate_ids || []).join(', ')}]`,
        '---',
        '',
        '# Promotion Candidate',
        '',
        '## Target',
        candidate.target_ref,
        '',
        '## Evaluation',
        JSON.stringify(candidate.evaluation_summary || {}, null, 2),
        '',
        '## Proposed Content',
        '```md',
        candidate.proposed_content,
        '```',
        ''
    ];

    return attrs.join('\n');
}

export function materializePromotions(candidates, repoRoot = process.cwd()) {
    const materialized = [];
    const manifestDir = path.join(repoRoot, 'docs', 'learning-promotions');
    ensureDir(manifestDir);

    for (const candidate of candidates) {
        const manifestPath = path.join(manifestDir, `${candidate.id}.md`);
        fs.writeFileSync(manifestPath, renderPromotionManifest(candidate), 'utf-8');
        materialized.push(manifestPath);

        if (candidate.pillar === 'skill' && candidate.target_ref) {
            const skillPath = path.join(repoRoot, candidate.target_ref);
            ensureDir(path.dirname(skillPath));
            fs.writeFileSync(skillPath, candidate.proposed_content, 'utf-8');
            materialized.push(skillPath);
        }
    }

    return materialized;
}

export async function proposeLearningPromotions() {
    const config = getConfig();
    const auth = getAuth();
    const serverUrl = auth?.server_url || config.server_url;
    const headers = getHeaders(auth);

    const proposeRes = await fetch(`${serverUrl}/api/learning/promotions/propose`, {
        method: 'POST',
        headers,
        body: JSON.stringify({})
    });
    if (!proposeRes.ok) {
        throw new Error(`Failed to propose promotions: ${proposeRes.status}`);
    }

    const listRes = await fetch(`${serverUrl}/api/learning/promotions?status=evaluated`, { headers });
    if (!listRes.ok) {
        throw new Error(`Failed to list promotions: ${listRes.status}`);
    }

    const candidates = await listRes.json();
    const materialized = materializePromotions(candidates);

    console.log(`Materialized ${candidates.length} promotion candidates.`);
    materialized.forEach(file => console.log(`  - ${path.relative(process.cwd(), file)}`));
}

function collectManifestFiles(rootDir) {
    if (!fs.existsSync(rootDir)) return [];
    return fs.readdirSync(rootDir)
        .filter(name => name.endsWith('.md'))
        .map(name => path.join(rootDir, name));
}

export async function applyApprovedPromotions() {
    const config = getConfig();
    const auth = getAuth();
    const serverUrl = auth?.server_url || config.server_url;
    const headers = getHeaders(auth);
    const manifestDir = path.join(process.cwd(), 'docs', 'learning-promotions');
    const manifestFiles = collectManifestFiles(manifestDir);

    for (const manifestPath of manifestFiles) {
        const parsed = frontMatter(fs.readFileSync(manifestPath, 'utf-8'));
        const attrs = parsed.attributes || {};
        if (attrs.pillar !== 'wiki' || attrs.status !== 'approved') continue;

        const contentMatch = parsed.body.match(/```md\n([\s\S]*?)\n```/);
        if (!contentMatch) continue;

        const pageRes = await fetch(`${serverUrl}/api/wiki/page`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                path: attrs.target_ref,
                content: contentMatch[1]
            })
        });
        if (!pageRes.ok) {
            throw new Error(`Failed to apply wiki promotion ${attrs.candidate_id}: ${pageRes.status}`);
        }

        await fetch(`${serverUrl}/api/learning/promotions/${attrs.candidate_id}/applied`, {
            method: 'POST',
            headers,
            body: JSON.stringify({})
        });

        console.log(`Applied wiki promotion: ${attrs.candidate_id} -> ${attrs.target_ref}`);
    }
}
