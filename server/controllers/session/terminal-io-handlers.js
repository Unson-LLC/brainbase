// @ts-check
import { logger } from '../../utils/logger.js';

export function installTerminalIoHandlers(controller) {
    controller.sendInput = async (req, res) => {
        const { id } = req.params;
        const { input, type, forcePaste } = req.body;
        const preview = typeof input === 'string' ? input.slice(0, 80) : String(input).slice(0, 80);
        logger.info(`[sendInput] POST /api/sessions/${id}/input type=${type} bytes=${typeof input === 'string' ? input.length : 0} forcePaste=${forcePaste === true} preview="${preview}"`);

        try {
            await controller.terminalIo.sendInput(id, input, type, { forcePaste: forcePaste === true });
            // tmux に書き込んだ直後は cache が古い。invalidate しないと
            // 後続の snapshot 取得で stale なテキストが返り、xterm に書き戻されて
            // 入力したパス/テキストが「すぐ消える」現象が起きる。
            controller.captureCache?.invalidate?.(id);
            logger.info(`[sendInput] 200: input sent to ${id}`);
            res.json({ success: true });
        } catch (error) {
            logger.error(`[sendInput] 500 Failed to send input to ${id}: ${error.message}`);
            res.status(500).json({ error: error.message || 'Failed to send input' });
        }
    };

    controller.getContent = async (req, res) => {
        const { id } = req.params;
        const lines = parseInt(req.query.lines) || 500;

        try {
            const content = await controller.snapshot.getContent(id, lines);
            res.json({ content });
        } catch {
            res.status(500).json({ error: 'Failed to capture content' });
        }
    };

    controller.getOutput = async (req, res) => {
        const { id } = req.params;

        try {
            const result = await controller.snapshot.getOutput(id);
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    };

    controller.scroll = async (req, res) => {
        const { id } = req.params;
        const { direction, steps } = req.body;

        try {
            await controller.terminalIo.scrollSession(id, direction, steps);
            controller.captureCache?.invalidate?.(id);
            res.json({ success: true });
        } catch (error) {
            logger.error(`Failed to scroll ${id}:`, error.message);
            res.status(500).json({ error: error.message || 'Failed to scroll' });
        }
    };

    controller.selectPane = async (req, res) => {
        const { id } = req.params;
        const { direction } = req.body;

        try {
            await controller.terminalIo.selectPane(id, direction);
            controller.captureCache?.invalidate?.(id);
            res.json({ success: true });
        } catch (error) {
            logger.error(`Failed to select pane for ${id}:`, error.message);
            res.status(500).json({ error: error.message || 'Failed to select pane' });
        }
    };

    controller.exitCopyMode = async (req, res) => {
        const { id } = req.params;

        try {
            await controller.terminalIo.exitCopyMode(id);
            controller.captureCache?.invalidate?.(id);
            res.json({ success: true });
        } catch (error) {
            logger.error(`Failed to exit copy mode for ${id}:`, error.message);
            res.status(500).json({ error: error.message || 'Failed to exit copy mode' });
        }
    };
}
