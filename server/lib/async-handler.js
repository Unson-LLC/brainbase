// @ts-check
/**
 * asyncHandler - async Express route handler のラッパー
 *
 * async関数内で throw された例外を自動的に next() に渡し、
 * 集中エラーハンドリングミドルウェア (errorHandler) に委譲する。
 *
 * Before:
 *   getAll = async (req, res) => {
 *       try {
 *           const data = await this.service.getAll();
 *           res.json(data);
 *       } catch (error) {
 *           console.error('Failed:', error);
 *           res.status(500).json({ error: 'Failed' });
 *       }
 *   };
 *
 * After:
 *   getAll = asyncHandler(async (req, res) => {
 *       const data = await this.service.getAll();
 *       res.json(data);
 *   });
 */
/**
 * @param {(req: unknown, res: unknown, next: (error?: unknown) => unknown) => Promise<unknown> | unknown} fn
 * @returns {(req: unknown, res: unknown, next: (error?: unknown) => unknown) => void}
 */
export function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch((error) => {
            next(error);
        });
    };
}
