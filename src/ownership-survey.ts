/** Repository-neutral validation for a caller-supplied ownership ledger and survey.
 * Measurements and tenant data remain with the caller; validation performs no I/O.
 */
export interface OwnershipSurveyComponent {
    id: string;
    lifecycle: string;
    current_paths?: string[];
    retained_source_paths?: string[];
}
export interface OwnershipSurveyEntry {
    id: string;
    wave: string;
    duplicate: string;
    production_use: string;
    disposition: string;
    files?: Array<{ path?: string }>;
}
export interface OwnershipSurvey {
    version: number;
    components?: OwnershipSurveyEntry[];
}
export interface OwnershipSurveyContract {
    components?: OwnershipSurveyComponent[];
}

export const OWNERSHIP_SURVEY_WAVES = Object.freeze(['1', '2', '3a', '3b', '3c', '3d', '4a', '4b', '4c', '4d', '4e', '5']);
const SURVEY_DUPLICATES = new Set(['same', 'partial', 'none']);
const SURVEY_PRODUCTION_USES = new Set(['used', 'conditional', 'scripts_only', 'shim_only', 'schema_only',
    'shim_and_schema', 'config_only', 'unused']);
const SURVEY_DISPOSITIONS = new Set(['move', 'switch_and_delete', 'delete_shim', 'inline_or_delete', 'delete', 'readback_and_close']);

export function validateOwnershipSurvey(contract: OwnershipSurveyContract | null | undefined, survey: OwnershipSurvey | null | undefined): string[] {
    if (!survey) return [];
    const errors = [];
    if (survey.version !== 1) errors.push('所有台帳の調査結果の version は 1 である必要があります');
    const entries = new Map<string, OwnershipSurveyEntry>();
    const components = new Map((contract?.components ?? []).map((component) => [component.id, component]));
    for (const entry of Array.isArray(survey.components) ? survey.components : []) {
        if (entries.has(entry?.id)) errors.push(`所有台帳の調査結果に項目が重複しています: ${entry?.id}`);
        entries.set(entry?.id, entry);
        const component = components.get(entry?.id);
        if (!component || !['migration_pending', 'retired'].includes(component.lifecycle)) {
            errors.push(`調査結果の項目は台帳の移設待ちか退役である必要があります: ${entry?.id}`);
        }
    }
    for (const component of contract?.components ?? []) {
        if (component?.lifecycle !== 'migration_pending') continue;
        const entry = entries.get(component.id);
        if (!entry) {
            errors.push(`移設待ちの項目に調査結果（段・重複・本番での利用）がありません: ${component.id}`);
            continue;
        }
        if (!OWNERSHIP_SURVEY_WAVES.includes(entry.wave)) errors.push(`${component.id} の調査結果の wave が不正です: ${entry.wave}`);
        if (!SURVEY_DUPLICATES.has(entry.duplicate)) errors.push(`${component.id} の調査結果の duplicate が不正です: ${entry.duplicate}`);
        if (!SURVEY_PRODUCTION_USES.has(entry.production_use)) {
            errors.push(`${component.id} の調査結果の production_use が不正です: ${entry.production_use}`);
        }
        if (!SURVEY_DISPOSITIONS.has(entry.disposition)) errors.push(`${component.id} の調査結果の disposition が不正です: ${entry.disposition}`);
        const expectedPaths = new Set([...(component.current_paths ?? []), ...(component.retained_source_paths ?? [])]);
        if (!Array.isArray(entry.files)) {
            errors.push(`${component.id} の調査結果に files 配列がありません`);
            continue;
        }
        const actualPaths = new Set();
        for (const file of entry.files) {
            if (typeof file?.path !== 'string' || !expectedPaths.has(file.path)) {
                errors.push(`${component.id} の調査結果に台帳にないパスがあります: ${file?.path}`);
            }
            if (actualPaths.has(file?.path)) errors.push(`${component.id} の調査結果のパスが重複しています: ${file?.path}`);
            actualPaths.add(file?.path);
        }
        for (const expectedPath of expectedPaths) {
            if (!actualPaths.has(expectedPath)) errors.push(`${component.id} の調査結果に台帳のパスがありません: ${expectedPath}`);
        }
    }
    return errors.sort();
}
