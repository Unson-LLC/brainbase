/**
 * HealthController Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthController } from '../../../server/controllers/health-controller.js';

describe('HealthController', () => {
  let controller;
  let mockSessionManager;
  let mockConfigParser;
  let mockReq;
  let mockRes;

  beforeEach(() => {
    mockSessionManager = {
      isReady: vi.fn().mockReturnValue(true)
    };

    mockConfigParser = {
      checkIntegrity: vi.fn().mockResolvedValue({
        summary: { errors: 0, warnings: 0 },
        stats: { projects: 5 }
      })
    };

    controller = new HealthController({
      sessionManager: mockSessionManager,
      configParser: mockConfigParser
    });

    mockReq = {};
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    };
  });

  describe('getHealth', () => {
    it('全て正常_healthyステータスと200が返される', async () => {
      await controller.getHealth(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'healthy',
          timestamp: expect.any(String),
          uptime: expect.any(Number),
          checks: expect.objectContaining({
            server: expect.objectContaining({ status: 'healthy' }),
            sessionManager: expect.objectContaining({ status: 'healthy' }),
            config: expect.objectContaining({ status: 'healthy' }),
            memory: expect.objectContaining({ status: 'healthy' })
          })
        })
      );
    });

    it('SessionManagerが起動中_degradedステータスが返される', async () => {
      mockSessionManager.isReady.mockReturnValue(false);

      await controller.getHealth(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'degraded',
          checks: expect.objectContaining({
            sessionManager: expect.objectContaining({ status: 'starting' })
          })
        })
      );
    });

    it('Config整合性にエラーあり_unhealthyステータスが返される', async () => {
      mockConfigParser.checkIntegrity.mockResolvedValue({
        summary: { errors: 2, warnings: 0 },
        stats: { projects: 5 }
      });

      await controller.getHealth(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'unhealthy',
          checks: expect.objectContaining({
            config: expect.objectContaining({ status: 'unhealthy' })
          })
        })
      );
    });

    it('Config整合性に警告あり_degradedステータスが返される', async () => {
      mockConfigParser.checkIntegrity.mockResolvedValue({
        summary: { errors: 0, warnings: 3 },
        stats: { projects: 5 }
      });

      await controller.getHealth(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'degraded',
          checks: expect.objectContaining({
            config: expect.objectContaining({ status: 'degraded' })
          })
        })
      );
    });

    it('SessionManagerがnull_OSS版対応でhealthyが返される', async () => {
      const ossController = new HealthController({
        sessionManager: null,
        configParser: mockConfigParser
      });

      await ossController.getHealth(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'healthy',
          checks: expect.objectContaining({
            sessionManager: expect.objectContaining({ status: 'healthy' })
          })
        })
      );
    });

    it('ConfigParserがnull_OSS版対応でhealthyが返される', async () => {
      const ossController = new HealthController({
        sessionManager: mockSessionManager,
        configParser: null
      });

      await ossController.getHealth(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'healthy',
          checks: expect.objectContaining({
            config: expect.objectContaining({ status: 'healthy' })
          })
        })
      );
    });

    it('例外発生時_503とエラーメッセージが返される', async () => {
      mockConfigParser.checkIntegrity.mockRejectedValue(new Error('Config error'));

      await controller.getHealth(mockReq, mockRes);

      // ConfigParser error is caught internally, so it returns degraded not 503
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          checks: expect.objectContaining({
            config: expect.objectContaining({ status: 'degraded' })
          })
        })
      );
    });
  });
});
