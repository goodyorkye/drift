import { type Command } from 'commander';
import { startWebServer, getNetworkUrls } from '../web/server.js';

export function registerWebCommand(program: Command): void {
    program
        .command('web')
        .description('Start the local Web UI')
        .option('--host <host>', 'Host to bind')
        .option('--port <port>', 'Port to listen on', '8787')
        .option('--allow-lan', 'Allow access from the local network')
        .option('--read-only', 'Disable write actions')
        .action(startWebCommand);
}

async function startWebCommand(opts: { host?: string; port: string; allowLan?: boolean; readOnly?: boolean }): Promise<void> {
    const port = parseInt(opts.port, 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`Invalid port: ${opts.port}`);
    }

    const host = opts.host ?? (opts.allowLan ? '0.0.0.0' : '127.0.0.1');
    await startWebServer({ host, port, readOnly: Boolean(opts.readOnly) });

    console.log('Drift Web UI listening on:');
    console.log(`  Local:   http://127.0.0.1:${port}`);
    if (host === '0.0.0.0' || opts.allowLan) {
        for (const url of getNetworkUrls(port)) {
            console.log(`  Network: ${url}`);
        }
    }
    if (host !== '127.0.0.1' && host !== 'localhost') {
        console.log('');
        console.log('No authentication is enabled. Anyone on this network who can access this URL can operate this workspace.');
    }
}
