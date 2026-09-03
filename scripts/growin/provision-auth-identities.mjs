#!/usr/bin/env node
import crypto from 'node:crypto';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

export const GROWIN_INITIAL_USERS = Object.freeze([
    Object.freeze({
        personId: 'person_kato_shintaro',
        personName: '加藤 真太郎',
        email: 's.kato@growin.jp',
        role: 'member'
    }),
    Object.freeze({
        personId: 'person_kawamura_tatsumi',
        personName: '川村 達見',
        email: 't.kawamura@growin.jp',
        role: 'member'
    }),
    Object.freeze({
        personId: 'person_inoue_nozomi',
        personName: '井上 希望',
        email: 'no.inoue@growin.jp',
        role: 'member'
    }),
    Object.freeze({
        personId: 'person_sano_tetsuya',
        personName: '佐野 哲哉',
        email: 't.sano@growin.jp',
        role: 'member'
    })
]);

function stableId(prefix, value) {
    return `${prefix}_${crypto.createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

export function buildGrowinAuthBootstrapPlan(users) {
    return users.map((user) => {
        const email = String(user.email || '').trim().toLowerCase();
        if (!email.endsWith('@growin.jp')) {
            throw new Error(`Growin Workspace以外のメールアドレスは登録できません: ${email}`);
        }
        return Object.freeze({
            ...user,
            email,
            identityId: stableId('authid_google', email),
            grantId: stableId('grant_growin', user.personId),
            provider: 'google-workspace',
            providerTenant: 'growin.jp',
            organizationId: 'org_growin',
            projectCodes: ['growin'],
            clearance: ['internal']
        });
    });
}

export async function provisionGrowinAuthIdentities({ databaseUrl, users = GROWIN_INITIAL_USERS } = {}) {
    if (!databaseUrl) throw new Error('INFO_SSOT_DATABASE_URL is required');
    const plan = buildGrowinAuthBootstrapPlan(users);
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const entry of plan) {
            await client.query(
                `INSERT INTO people (id, name, status)
                 VALUES ($1, $2, 'active')
                 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = 'active'`,
                [entry.personId, entry.personName]
            );
            await client.query(
                `INSERT INTO auth_grants (
                    id, person_id, person_name, organization_id, role,
                    project_codes, clearance, active, updated_at
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,true,NOW())
                 ON CONFLICT (id) DO UPDATE SET
                    person_id = EXCLUDED.person_id,
                    person_name = EXCLUDED.person_name,
                    organization_id = EXCLUDED.organization_id,
                    role = EXCLUDED.role,
                    project_codes = EXCLUDED.project_codes,
                    clearance = EXCLUDED.clearance,
                    active = true,
                    updated_at = NOW()`,
                [entry.grantId, entry.personId, entry.personName, entry.organizationId,
                    entry.role, entry.projectCodes, entry.clearance]
            );
            const identityResult = await client.query(
                `INSERT INTO auth_identities (
                    id, person_id, provider, provider_subject, provider_tenant,
                    active, metadata, updated_at
                 ) VALUES ($1,$2,$3,$4,$5,true,$6::jsonb,NOW())
                 ON CONFLICT (provider, provider_subject, provider_tenant) DO UPDATE SET
                    person_id = EXCLUDED.person_id,
                    active = true,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()
                 WHERE auth_identities.person_id = EXCLUDED.person_id`,
                [entry.identityId, entry.personId, entry.provider, entry.email,
                    entry.providerTenant, JSON.stringify({ source: 'growin-confirmed-workspace-address' })]
            );
            if (identityResult.rowCount !== 1) {
                throw new Error(`Google Workspace identity is already bound to another person: ${entry.email}`);
            }
        }

        const emails = plan.map((entry) => entry.email);
        const readback = await client.query(
            `SELECT ai.person_id, ai.provider_subject AS email, ai.provider_tenant,
                    ag.organization_id, ag.role, ag.project_codes, ai.active AND ag.active AS active
             FROM auth_identities ai
             JOIN auth_grants ag ON ag.person_id = ai.person_id
             WHERE ai.provider = 'google-workspace'
               AND ai.provider_tenant = 'growin.jp'
               AND ai.provider_subject = ANY($1::text[])
             ORDER BY ai.provider_subject`,
            [emails]
        );
        if (readback.rows.length !== plan.length
            || readback.rows.some((row) => row.organization_id !== 'org_growin'
                || !row.active
                || row.project_codes?.join(',') !== 'growin')) {
            throw new Error('Growin auth identity readback failed');
        }
        await client.query('COMMIT');
        return {
            status: 'ok',
            users: readback.rows.map((row) => ({
                person_id: row.person_id,
                email: row.email,
                provider_tenant: row.provider_tenant,
                organization_id: row.organization_id,
                role: row.role,
                project_codes: row.project_codes,
                active: row.active
            }))
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    provisionGrowinAuthIdentities({ databaseUrl: process.env.INFO_SSOT_DATABASE_URL })
        .then((result) => console.log(JSON.stringify(result)))
        .catch((error) => {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        });
}
