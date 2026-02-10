import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthService } from '../../server/services/auth-service.js';

describe('AuthService - Device Code Flow', () => {
    let authService;

    beforeEach(() => {
        authService = new AuthService();
        authService.jwtSecret = 'test-secret';
        authService.refreshSecret = 'test-refresh-secret';
        authService.pool = {
            connect: async () => ({
                query: async () => ({ rows: [] }),
                release: () => {}
            })
        };
    });

    afterEach(() => {
        // Clear device code stores
        authService.deviceCodeStore.clear();
        authService.userCodeStore.clear();
    });

    describe('generateUserCode', () => {
        it('should generate user code in XXXX-XXXX format', () => {
            const userCode = authService.generateUserCode();
            expect(userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
        });

        it('should generate unique user codes', () => {
            const codes = new Set();
            for (let i = 0; i < 100; i++) {
                codes.add(authService.generateUserCode());
            }
            expect(codes.size).toBe(100);
        });

        it('should exclude confusing characters (0, O, 1, I, L)', () => {
            const userCode = authService.generateUserCode();
            expect(userCode).not.toMatch(/[01OIL]/);
        });
    });

    describe('generateDeviceCode', () => {
        it('should generate 64-character hex string (32 bytes)', () => {
            const deviceCode = authService.generateDeviceCode();
            expect(deviceCode.length).toBe(64);
            expect(deviceCode).toMatch(/^[a-f0-9]{64}$/);
        });

        it('should generate unique device codes', () => {
            const codes = new Set();
            for (let i = 0; i < 100; i++) {
                codes.add(authService.generateDeviceCode());
            }
            expect(codes.size).toBe(100);
        });
    });

    describe('createDeviceCodeRequest', () => {
        it('should return device code response with all required fields', () => {
            const codeVerifier = 'test-code-verifier';
            const response = authService.createDeviceCodeRequest(codeVerifier);

            expect(response.device_code).toBeTruthy();
            expect(response.user_code).toBeTruthy();
            expect(response.verification_uri).toBeTruthy();
            expect(response.verification_uri_complete).toBeTruthy();
            expect(typeof response.expires_in).toBe('number');
            expect(response.interval).toBe(5);
        });

        it('should store device code with codeVerifier', () => {
            const codeVerifier = 'test-code-verifier';
            const response = authService.createDeviceCodeRequest(codeVerifier);

            const record = authService.deviceCodeStore.get(response.device_code);
            expect(record).toBeTruthy();
            expect(record.codeVerifier).toBe(codeVerifier);
            expect(record.userCode).toBe(response.user_code);
            expect(record.status).toBe('pending');
        });

        it('should create bidirectional mapping (device_code ↔ user_code)', () => {
            const codeVerifier = 'test-code-verifier';
            const response = authService.createDeviceCodeRequest(codeVerifier);

            const deviceCodeFromUserCode = authService.userCodeStore.get(response.user_code);
            expect(deviceCodeFromUserCode).toBe(response.device_code);
        });

        it('verification_uri_complete should include user_code', () => {
            const codeVerifier = 'test-code-verifier';
            const response = authService.createDeviceCodeRequest(codeVerifier);

            expect(response.verification_uri_complete).toContain(response.user_code);
        });
    });

    describe('verifyUserCode', () => {
        it('should return null for invalid user code', () => {
            const result = authService.verifyUserCode('INVALID-CODE');
            expect(result).toBeNull();
        });

        it('should return device code and status for valid user code', () => {
            const codeVerifier = 'test-code-verifier';
            const response = authService.createDeviceCodeRequest(codeVerifier);

            const result = authService.verifyUserCode(response.user_code);
            expect(result).toBeTruthy();
            expect(result.deviceCode).toBe(response.device_code);
            expect(result.status).toBe('pending');
        });

        it('should return null for expired user code', () => {
            const codeVerifier = 'test-code-verifier';
            const response = authService.createDeviceCodeRequest(codeVerifier);

            // Manually expire the code
            const record = authService.deviceCodeStore.get(response.device_code);
            record.createdAt = Date.now() - (11 * 60 * 1000); // 11 minutes ago

            const result = authService.verifyUserCode(response.user_code);
            expect(result).toBeNull();
        });
    });

    describe('approveDeviceCode', () => {
        it('should update status to approved and store Slack identity', () => {
            const codeVerifier = 'test-code-verifier';
            const response = authService.createDeviceCodeRequest(codeVerifier);

            authService.approveDeviceCode(response.device_code, 'U12345', 'T12345');

            const record = authService.deviceCodeStore.get(response.device_code);
            expect(record.status).toBe('approved');
            expect(record.slackUserId).toBe('U12345');
            expect(record.slackWorkspaceId).toBe('T12345');
        });

        it('should throw error for invalid device code', () => {
            expect(() => {
                authService.approveDeviceCode('INVALID', 'U12345', 'T12345');
            }).toThrow(/Device code not found/);
        });

        it('should throw error for expired device code', () => {
            const codeVerifier = 'test-code-verifier';
            const response = authService.createDeviceCodeRequest(codeVerifier);

            // Manually expire the code
            const record = authService.deviceCodeStore.get(response.device_code);
            record.createdAt = Date.now() - (11 * 60 * 1000); // 11 minutes ago

            expect(() => {
                authService.approveDeviceCode(response.device_code, 'U12345', 'T12345');
            }).toThrow(/Device code expired/);
        });
    });

    describe('denyDeviceCode', () => {
        it('should update status to denied', () => {
            const codeVerifier = 'test-code-verifier';
            const response = authService.createDeviceCodeRequest(codeVerifier);

            authService.denyDeviceCode(response.device_code);

            const record = authService.deviceCodeStore.get(response.device_code);
            expect(record.status).toBe('denied');
        });

        it('should throw error for invalid device code', () => {
            expect(() => {
                authService.denyDeviceCode('INVALID');
            }).toThrow(/Device code not found/);
        });
    });

    describe('pollDeviceToken', () => {
        it('should return authorization_pending for pending status', async () => {
            const codeVerifier = 'test-code-verifier';
            const response = authService.createDeviceCodeRequest(codeVerifier);

            const result = await authService.pollDeviceToken(response.device_code);
            expect(result.error).toBe('authorization_pending');
        });

        it('should return access_denied for denied status', async () => {
            const codeVerifier = 'test-code-verifier';
            const response = authService.createDeviceCodeRequest(codeVerifier);
            authService.denyDeviceCode(response.device_code);

            const result = await authService.pollDeviceToken(response.device_code);
            expect(result.error).toBe('access_denied');
        });

        it('should return expired_token for expired device code', async () => {
            const codeVerifier = 'test-code-verifier';
            const response = authService.createDeviceCodeRequest(codeVerifier);

            // Manually expire the code
            const record = authService.deviceCodeStore.get(response.device_code);
            record.createdAt = Date.now() - (11 * 60 * 1000); // 11 minutes ago

            const result = await authService.pollDeviceToken(response.device_code);
            expect(result.error).toBe('expired_token');
        });

        it('should return expired_token for invalid device code', async () => {
            const result = await authService.pollDeviceToken('INVALID');
            expect(result.error).toBe('expired_token');
        });

        it('should clean up device code after denial', async () => {
            const codeVerifier = 'test-code-verifier';
            const response = authService.createDeviceCodeRequest(codeVerifier);
            authService.denyDeviceCode(response.device_code);

            await authService.pollDeviceToken(response.device_code);

            // Device code should be deleted
            expect(authService.deviceCodeStore.has(response.device_code)).toBe(false);
            expect(authService.userCodeStore.has(response.user_code)).toBe(false);
        });
    });

    describe('cleanupExpiredDeviceCodes', () => {
        it('should remove expired device codes', () => {
            const codeVerifier = 'test-code-verifier';
            const response = authService.createDeviceCodeRequest(codeVerifier);

            // Manually expire the code
            const record = authService.deviceCodeStore.get(response.device_code);
            record.createdAt = Date.now() - (11 * 60 * 1000); // 11 minutes ago

            authService.cleanupExpiredDeviceCodes();

            expect(authService.deviceCodeStore.has(response.device_code)).toBe(false);
            expect(authService.userCodeStore.has(response.user_code)).toBe(false);
        });

        it('should not remove active device codes', () => {
            const codeVerifier = 'test-code-verifier';
            const response = authService.createDeviceCodeRequest(codeVerifier);

            authService.cleanupExpiredDeviceCodes();

            expect(authService.deviceCodeStore.has(response.device_code)).toBe(true);
            expect(authService.userCodeStore.has(response.user_code)).toBe(true);
        });

        it('should clean up multiple expired codes', () => {
            const codes = [];
            for (let i = 0; i < 5; i++) {
                const response = authService.createDeviceCodeRequest(`verifier-${i}`);
                codes.push(response);
            }

            // Expire first 3 codes
            for (let i = 0; i < 3; i++) {
                const record = authService.deviceCodeStore.get(codes[i].device_code);
                record.createdAt = Date.now() - (11 * 60 * 1000);
            }

            authService.cleanupExpiredDeviceCodes();

            // First 3 should be deleted
            for (let i = 0; i < 3; i++) {
                expect(authService.deviceCodeStore.has(codes[i].device_code)).toBe(false);
            }

            // Last 2 should remain
            for (let i = 3; i < 5; i++) {
                expect(authService.deviceCodeStore.has(codes[i].device_code)).toBe(true);
            }
        });
    });
});
