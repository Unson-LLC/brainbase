export const terminalSnapshotMethods = {
    async getPaneMode(sessionId) {
        if (!sessionId) {
            throw new Error('Session ID required');
        }

        const { stdout } = await this.execPromise(`tmux display-message -p -t "${sessionId}" "#{pane_in_mode}" 2>/dev/null || echo "0"`);
        return stdout.trim() === '1';
    },

    async getContent(sessionId, lines = 500) {
        const { stdout } = await this.execPromise(`tmux capture-pane -t "${sessionId}" -p -S -${lines}`);
        return stdout;
    },

    async getContentWithColors(sessionId, lines = 10) {
        const { stdout } = await this.execPromise(
            `tmux capture-pane -e -t "${sessionId}" -p -S -${lines}`
        );
        return stdout;
    },

    async getOutput(sessionId) {
        const { stdout } = await this.execPromise(`tmux capture-pane -t "${sessionId}" -p -J -S -100`);
        const choices = this.outputParser.detectChoices(stdout);

        return {
            output: stdout,
            choices: choices,
            hasChoices: choices.length > 0
        };
    }
};
