import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const cliEntry = path.join(root, 'dist', 'cli', 'index.js');
const webHost = process.env.DRIFT_WEB_HOST || '127.0.0.1';
const webPort = process.env.DRIFT_WEB_PORT || '8787';

export const apps = [
    {
        name: 'drift-core',
        cwd: root,
        script: cliEntry,
        args: ['start'],
        interpreter: 'node',
        exec_mode: 'fork',
        instances: 1,
        autorestart: true,
        time: true,
        env: {
            NODE_ENV: 'production',
            DRIFT_ROOT: root,
        },
    },
    {
        name: 'drift-web',
        cwd: root,
        script: cliEntry,
        args: ['web', '--host', webHost, '--port', webPort],
        interpreter: 'node',
        exec_mode: 'fork',
        instances: 1,
        autorestart: true,
        time: true,
        env: {
            NODE_ENV: 'production',
            DRIFT_ROOT: root,
            DRIFT_WEB_HOST: webHost,
            DRIFT_WEB_PORT: webPort,
        },
    },
];

export default {
    apps,
};
