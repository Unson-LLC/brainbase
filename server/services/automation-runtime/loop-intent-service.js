// @ts-check

/** Public boundary for creating and querying eligible loop intents. */
export class LoopIntentService {
    constructor({ runtime }) {
        this.runtime = runtime;
    }

    list(...args) { return this.runtime.listLoopIntents(...args); }
    create(...args) { return this.runtime.createLoopIntent(...args); }
}
