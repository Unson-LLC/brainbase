// @ts-check

/**
 * The SNS operational CLIs are retired.  Keep this guard in one place so a
 * direct `node scripts/...` invocation has the same machine-readable failure
 * regardless of which former entry point was used.
 */
export const SNS_CLI_RETIRED_CODE = 'SNS_CLI_RETIRED';

export function createRetiredSnsCliError(scriptName = 'SNS CLI') {
    const error = new Error(`${SNS_CLI_RETIRED_CODE}: ${scriptName} は廃止済みです。SNS操作は実行していません。`);
    error.code = SNS_CLI_RETIRED_CODE;
    return error;
}

export function throwRetiredSnsCli(scriptName) {
    throw createRetiredSnsCliError(scriptName);
}
