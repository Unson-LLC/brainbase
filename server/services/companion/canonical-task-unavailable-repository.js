function unavailable() {
    const error = new Error('CANONICAL_TASK_BACKEND is not configured');
    error.code = 'canonical_task_backend_not_configured';
    error.status = 503;
    throw error;
}

export class CanonicalTaskUnavailableRepository {
    assertAvailable() { return unavailable(); }
    list() { return unavailable(); }
    search() { return unavailable(); }
    get() { return unavailable(); }
    findByIdempotencyKey() { return unavailable(); }
    create() { return unavailable(); }
    update() { return unavailable(); }
    delete() { return unavailable(); }
}
