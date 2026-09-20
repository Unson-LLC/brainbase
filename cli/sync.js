// Keep a small error boundary for old invocations; no auth, network, or file I/O.
async function rejectRetiredWiki() {
    throw new Error('Wiki is retired. Use Graph, the owning Git repository, or Drive as the SSOT.');
}

export { rejectRetiredWiki as sync, rejectRetiredWiki as pull, rejectRetiredWiki as push, rejectRetiredWiki as wikiStatus };
