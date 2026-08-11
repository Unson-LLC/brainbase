// @ts-check

/** Public boundary for idempotent, scope-safe Eve session dispatch. */
export class EveSessionDispatchService {
    constructor({ runtime }) {
        this.runtime = runtime;
    }

    dispatch(...args) { return this.runtime.dispatchLoopIntentToEve(...args); }
}
