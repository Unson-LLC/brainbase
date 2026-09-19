// @ts-check
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
    GROWIN_INITIAL_USERS,
    buildGrowinAuthBootstrapPlan
} from '../../scripts/growin/provision-auth-identities.mjs';

describe('Growin auth bootstrap', () => {
    it('keeps the shared auth schema applicable to an isolated tenant database', () => {
        const schema = fs.readFileSync(path.resolve('server/sql/info-ssot-schema.sql'), 'utf8');
        const authGrantBackfill = schema.slice(
            schema.indexOf('ALTER TABLE auth_grants ADD COLUMN IF NOT EXISTS organization_id text;'),
            schema.indexOf('CREATE TABLE IF NOT EXISTS auth_identities')
        );

        expect(authGrantBackfill).toContain("WHERE attrelid = to_regclass('organizations')");
        expect(authGrantBackfill).toContain('ag.slack_workspace_id = o.id');
        expect(authGrantBackfill).toContain("IF to_regclass('organizations') IS NOT NULL AND NOT EXISTS");
        expect(authGrantBackfill).toContain('CREATE OR REPLACE FUNCTION enforce_auth_grant_project_scope()');
        expect(authGrantBackfill).toContain('p.organization_id = NEW.organization_id');
        expect(authGrantBackfill).toContain('CREATE TRIGGER auth_grants_project_scope_guard');
        const readback = fs.readFileSync(path.resolve('server/sql/info-ssot-readback.sql'), 'utf8');
        expect(readback).toContain("'enforce_auth_grant_project_scope()'");
        expect(readback).toContain("tgname = 'auth_grants_project_scope_guard'");
        expect(readback).toContain('active auth grant contains an unknown or cross-organization project code');
    });

    it('requires the Graph-bound project catalog with the two Growin runtime scopes', () => {
        const terraform = fs.readFileSync(path.resolve('infra/gcp/growin/main.tf'), 'utf8');
        const registry = JSON.parse(fs.readFileSync(
            path.resolve('scripts/growin/project-registry.json'),
            'utf8'
        ));

        expect(terraform).toContain('name  = "BRAINBASE_PROJECT_CATALOG_MODE"\n        value = "required"');
        expect(registry.map(({ project_code }) => project_code)).toEqual(['growin', 'brainbase']);
        expect(registry.every(({ organization_id, organization_entity_id, owner_person_id }) => (
            organization_id === 'org_growin'
            && organization_entity_id === 'org_growin_partners'
            && owner_person_id === 'person_sano_tetsuya'
        ))).toBe(true);
    });

    it('does not move an existing Workspace identity to another person', () => {
        const source = fs.readFileSync(
            path.resolve('scripts/growin/provision-auth-identities.mjs'),
            'utf8'
        );

        expect(source).toContain('WHERE auth_identities.person_id = EXCLUDED.person_id');
        expect(source).toContain('if (identityResult.rowCount !== 1)');
    });

    it('fails the remote verifier on JSON-RPC errors instead of treating them as empty data', () => {
        const source = fs.readFileSync(
            path.resolve('scripts/growin/verify-remote-e2e.sh'),
            'utf8'
        );

        expect(source).toContain('if .error then error(.error.message // "JSON-RPC error")');
        expect(source).toContain('else error("JSON-RPC result missing") end');
    });

    it('fails the remote verifier when the current Graph tool contract is not deployed', () => {
        const source = fs.readFileSync(
            path.resolve('scripts/growin/verify-remote-e2e.sh'),
            'utf8'
        );

        expect(source).toContain('/health/version');
        expect(source).toContain('"search", "resolve_entity", "get_entity", "list_entities"');
        expect(source).toContain('.name != "get_context" and .name != "search_wiki"');
    });

    it('keeps the pilot device flow on one API instance and provides its public URL', () => {
        const terraform = fs.readFileSync(path.resolve('infra/gcp/growin/main.tf'), 'utf8');
        const apiService = terraform.slice(
            terraform.indexOf('resource "google_cloud_run_v2_service" "api"'),
            terraform.indexOf('resource "google_cloud_run_v2_service" "mcp"')
        );

        expect(apiService).toContain('max_instance_count = 1');
        expect(apiService).toContain('name  = "BRAINBASE_PUBLIC_URL"');
        expect(apiService).toContain('value = var.api_public_url');
    });

    it('uses distinct release and rollback SHAs for migration receipts', () => {
        const terraform = fs.readFileSync(path.resolve('infra/gcp/growin/main.tf'), 'utf8');
        const migrateJob = terraform.slice(
            terraform.indexOf('resource "google_cloud_run_v2_job" "migrate"'),
            terraform.indexOf('resource "google_cloud_run_v2_job" "auth_bootstrap"')
        );

        expect(migrateJob).toContain('name  = "INFO_SSOT_GIT_SHA"\n          value = var.release_git_sha');
        expect(migrateJob).toContain('name  = "INFO_SSOT_ROLLBACK_SHA"\n          value = var.rollback_git_sha');
    });

    it('runs auth bootstrap with its own least-privilege service account', () => {
        const terraform = fs.readFileSync(path.resolve('infra/gcp/growin/main.tf'), 'utf8');
        const authJob = terraform.slice(
            terraform.indexOf('resource "google_cloud_run_v2_job" "auth_bootstrap"')
        );

        expect(terraform).toContain('resource "google_service_account" "auth_bootstrap"');
        expect(terraform).toContain('auth_bootstrap = google_service_account.auth_bootstrap.name');
        expect(authJob).toContain('service_account = google_service_account.auth_bootstrap.email');
        expect(authJob).not.toContain('google_secret_manager_secret_iam_member.runtime_access');
    });

    it('prints the migration receipt to Cloud Logging compatible stdout', () => {
        const source = fs.readFileSync(path.resolve('scripts/info-ssot-apply.sh'), 'utf8');

        expect(source).toContain('echo "INFO_SSOT_APPLY_RECEIPT=$(tr -d');
    });

    it('binds only confirmed Workspace addresses to canonical people', () => {
        expect(GROWIN_INITIAL_USERS).toEqual([
            {
                personId: 'person_kato_shintaro',
                personName: '加藤 真太郎',
                email: 's.kato@growin.jp',
                role: 'gm'
            },
            {
                personId: 'person_kawamura_tatsumi',
                personName: '川村 達見',
                email: 't.kawamura@growin.jp',
                role: 'gm'
            },
            {
                personId: 'person_inoue_nozomi',
                personName: '井上 希望',
                email: 'no.inoue@growin.jp',
                role: 'gm'
            },
            {
                personId: 'person_sano_tetsuya',
                personName: '佐野 哲哉',
                email: 't.sano@growin.jp',
                role: 'ceo'
            }
        ]);
    });

    it('creates an idempotent, Growin-only grant and identity plan', () => {
        const plan = buildGrowinAuthBootstrapPlan(GROWIN_INITIAL_USERS);

        expect(plan).toHaveLength(4);
        expect(plan.every((entry) => entry.organizationId === 'org_growin')).toBe(true);
        expect(plan.every((entry) => entry.provider === 'google-workspace')).toBe(true);
        expect(plan.every((entry) => entry.providerTenant === 'growin.jp')).toBe(true);
        expect(plan.every((entry) => entry.projectCodes.join(',') === 'growin')).toBe(true);
        expect(Object.fromEntries(plan.map((entry) => [entry.email, entry.role]))).toEqual({
            's.kato@growin.jp': 'gm',
            't.kawamura@growin.jp': 'gm',
            'no.inoue@growin.jp': 'gm',
            't.sano@growin.jp': 'ceo'
        });
        expect(new Set(plan.map((entry) => entry.identityId)).size).toBe(4);
    });
});
