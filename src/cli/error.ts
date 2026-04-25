export function handleCliError(error: unknown): void {
    if (isPromptCancelError(error)) {
        console.log('\n已取消。');
        process.exitCode = 130;
        return;
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(message || 'Unknown CLI error');
    process.exitCode = 1;
}

export function isPromptCancelError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    if (error.name === 'ExitPromptError') return true;

    const text = `${error.name} ${error.message}`.toLowerCase();
    return text.includes('force closed the prompt') || text.includes('canceled prompt') || text.includes('cancelled prompt');
}
