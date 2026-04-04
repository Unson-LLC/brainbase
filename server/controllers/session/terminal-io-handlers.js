// @ts-check
import { logger } from '../../utils/logger.js';

export function installTerminalIoHandlers(controller) {
    controller.sendInput = async (req, res) => {
        const { id } = req.params;
        const { input, type } = req.body;

        try {
            await controller.terminalIo.sendInput(id, input, type);
            res.json({ success: true });
        } catch (error) {
            logger.error(`Failed to send input to ${id}:`, error.message);
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
            res.json({ success: true });
        } catch (error) {
            logger.error(`Failed to exit copy mode for ${id}:`, error.message);
            res.status(500).json({ error: error.message || 'Failed to exit copy mode' });
        }
    };
}
