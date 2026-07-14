export const BRAINBASE_CORS_OPTIONS = Object.freeze({
    origin: true,
    credentials: true,
    allowedHeaders: Object.freeze([
        'Authorization',
        'Content-Type',
        'X-CSRF-Token',
        'X-Session-Id',
        'Idempotency-Key'
    ]),
    methods: Object.freeze(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
});
