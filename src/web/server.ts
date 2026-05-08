import http from 'node:http';
import os from 'node:os';
import { URL } from 'node:url';
import { requireActor } from '../core/actor.js';
import {
    abandonTask,
    cancelTask,
    clearHistory,
    enqueueTask,
    removeTask,
    rerunTask,
    resumeTask,
    stopTask,
} from '../core/task-actions.js';
import { getProcessStatus, readSystemLogs } from '../core/process-actions.js';
import {
    clearScheduleTasks,
    removeSchedule,
    runScheduleNow,
    setScheduleEnabled,
} from '../core/schedule-actions.js';
import {
    inspectTaskDetails,
    listTaskFiles,
    listTaskRuns,
    listTaskSummaries,
    readRunLog,
    readTaskRunDetails,
    readTaskFile,
    resolveManagedArtifact,
} from '../core/task-inspection.js';
import {
    createTaskDraft,
    finalizeTaskDraft,
    getTaskCreateOptions,
    getTaskDraftSummary,
    readDraftFile,
    sendTaskDraftMessage,
    uploadDraftFile,
    writeDraftFile,
} from '../core/task-drafts.js';
import { PACKAGE_ROOT } from '../paths.js';
import { FileQueue } from '../queue.js';
import { listSchedules, readScheduleState } from '../storage.js';
import { type ActorRef, type QueueStatus, type RunnerName } from '../types.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const QUEUE_STATUSES: QueueStatus[] = ['pending', 'running', 'paused', 'done', 'blocked'];

export interface WebServerOptions {
    host: string;
    port: number;
    readOnly?: boolean;
}

export async function startWebServer(options: WebServerOptions): Promise<http.Server> {
    const server = http.createServer((req, res) => {
        handleRequest(req, res, options).catch(error => {
            sendJson(res, statusFromError(error), { error: error instanceof Error ? error.message : 'Unexpected error' });
        });
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port, options.host, () => {
            server.off('error', reject);
            resolve();
        });
    });

    return server;
}

export function getNetworkUrls(port: number): string[] {
    const urls: string[] = [];
    for (const entries of Object.values(os.networkInterfaces())) {
        for (const entry of entries ?? []) {
            if (entry.family !== 'IPv4' || entry.internal) continue;
            urls.push(`http://${entry.address}:${port}`);
        }
    }
    return urls;
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse, options: WebServerOptions): Promise<void> {
    if (!req.url || !req.method) {
        sendJson(res, 400, { error: 'Invalid request.' });
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    if (req.method === 'GET' && !pathname.startsWith('/api/')) {
        await serveClientAsset(res, pathname);
        return;
    }

    if (req.method === 'GET' && pathname === '/api/status') {
        sendJson(res, 200, { readOnly: Boolean(options.readOnly), ...(await getProcessStatus()) });
        return;
    }

    if (req.method === 'GET' && pathname === '/api/tasks') {
        sendJson(res, 200, { tasks: await listTaskSummaries(url.searchParams.get('status') ?? undefined) });
        return;
    }

    if (req.method === 'GET' && pathname === '/api/task-create/options') {
        sendJson(res, 200, await getTaskCreateOptions());
        return;
    }

    const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (req.method === 'GET' && taskMatch) {
        sendJson(res, 200, await inspectTaskDetails(taskMatch[1]));
        return;
    }

    const runsMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/runs$/);
    if (req.method === 'GET' && runsMatch) {
        sendJson(res, 200, { runs: await listTaskRuns(runsMatch[1]) });
        return;
    }

    const runDetailMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/runs\/([^/]+)$/);
    if (req.method === 'GET' && runDetailMatch) {
        sendJson(res, 200, await readTaskRunDetails(runDetailMatch[1], runDetailMatch[2]));
        return;
    }

    const filesMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/files$/);
    if (req.method === 'GET' && filesMatch) {
        const area = parseTaskFileArea(url.searchParams.get('area'));
        sendJson(res, 200, { files: await listTaskFiles(filesMatch[1], area) });
        return;
    }

    const fileContentMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/files\/content$/);
    if (req.method === 'GET' && fileContentMatch) {
        const area = parseTaskFileArea(url.searchParams.get('area'));
        const ref = url.searchParams.get('path') ?? 'task.md';
        sendText(res, 200, await readTaskFile(fileContentMatch[1], area, ref));
        return;
    }

    const artifactDownloadMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/artifacts\/download$/);
    if (req.method === 'GET' && artifactDownloadMatch) {
        const ref = url.searchParams.get('path') ?? '';
        const artifact = await resolveManagedArtifact(artifactDownloadMatch[1], ref);
        sendDownload(res, await fs.readFile(artifact.file), artifact.name);
        return;
    }

    if (req.method === 'POST' && pathname === '/api/drafts/tasks') {
        assertWebWriteAllowed(options);
        actorFromHeaders(req.headers);
        const body = await readJsonBody(req);
        if (typeof body.type !== 'string') throw new WebHttpError(400, 'Task type is required.');
        if (body.creationMethod !== 'manual' && body.creationMethod !== 'claude' && body.creationMethod !== 'codex') {
            throw new WebHttpError(400, 'Creation method is invalid.');
        }
        sendJson(
            res,
            200,
            await createTaskDraft({
                type: body.type,
                creationMethod: body.creationMethod,
            }),
        );
        return;
    }

    const draftMatch = pathname.match(/^\/api\/drafts\/tasks\/([^/]+)$/);
    if (req.method === 'GET' && draftMatch) {
        sendJson(res, 200, await getTaskDraftSummary(draftMatch[1]));
        return;
    }

    const draftFileMatch = pathname.match(/^\/api\/drafts\/tasks\/([^/]+)\/files\/content$/);
    if (req.method === 'GET' && draftFileMatch) {
        const ref = url.searchParams.get('path') ?? 'task.md';
        sendText(res, 200, await readDraftFile(draftFileMatch[1], ref));
        return;
    }

    if (req.method === 'POST' && draftFileMatch) {
        assertWebWriteAllowed(options);
        actorFromHeaders(req.headers);
        const body = await readJsonBody(req);
        if (typeof body.path !== 'string') throw new WebHttpError(400, 'Draft file path is required.');
        if (typeof body.content !== 'string') throw new WebHttpError(400, 'Draft file content must be a string.');
        sendJson(res, 200, await writeDraftFile(draftFileMatch[1], body.path, body.content));
        return;
    }

    const draftUploadMatch = pathname.match(/^\/api\/drafts\/tasks\/([^/]+)\/files\/upload$/);
    if (req.method === 'POST' && draftUploadMatch) {
        assertWebWriteAllowed(options);
        actorFromHeaders(req.headers);
        const body = await readJsonBody(req);
        if (typeof body.path !== 'string') throw new WebHttpError(400, 'Draft file path is required.');
        if (typeof body.contentBase64 !== 'string' || body.contentBase64.length === 0) {
            throw new WebHttpError(400, 'Draft upload content is required.');
        }
        sendJson(
            res,
            200,
            await uploadDraftFile(draftUploadMatch[1], body.path, Buffer.from(body.contentBase64, 'base64')),
        );
        return;
    }

    const draftSessionMatch = pathname.match(/^\/api\/drafts\/tasks\/([^/]+)\/session$/);
    if (req.method === 'POST' && draftSessionMatch) {
        assertWebWriteAllowed(options);
        actorFromHeaders(req.headers);
        const body = await readJsonBody(req);
        if (typeof body.message !== 'string' || body.message.trim().length === 0) {
            throw new WebHttpError(400, 'Draft message is required.');
        }
        sendJson(res, 200, await sendTaskDraftMessage(draftSessionMatch[1], body.message.trim()));
        return;
    }

    const draftFinalizeMatch = pathname.match(/^\/api\/drafts\/tasks\/([^/]+)\/finalize$/);
    if (req.method === 'POST' && draftFinalizeMatch) {
        assertWebWriteAllowed(options);
        const actor = actorFromHeaders(req.headers);
        const body = await readJsonBody(req);
        if (typeof body.title !== 'string') throw new WebHttpError(400, 'Task title is required.');
        if (body.runner !== 'claude' && body.runner !== 'codex') throw new WebHttpError(400, 'Runner is invalid.');
        sendJson(
            res,
            200,
            await finalizeTaskDraft(draftFinalizeMatch[1], {
                title: body.title,
                runner: body.runner as RunnerName,
                budgetUsd: parseOptionalNumber(body.budgetUsd),
                maxRetries: parseOptionalInteger(body.maxRetries),
                timeoutMs: parseOptionalInteger(body.timeoutMs),
                enqueue: body.enqueue === true,
                actor,
            }),
        );
        return;
    }

    const logMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/runs\/([^/]+)\/logs\/(stdout|stderr)$/);
    if (req.method === 'GET' && logMatch) {
        const tailBytes = parseInt(url.searchParams.get('tailBytes') ?? '0', 10);
        sendText(
            res,
            200,
            await readRunLog(logMatch[1], logMatch[2], logMatch[3] as 'stdout' | 'stderr', {
                tailBytes: Number.isFinite(tailBytes) && tailBytes > 0 ? tailBytes : undefined,
            }),
        );
        return;
    }

    if (req.method === 'GET' && pathname === '/api/queue') {
        const queue = new FileQueue();
        await queue.ensureDirs();
        const groups = Object.fromEntries(
            await Promise.all(QUEUE_STATUSES.map(async status => [status, await queue.list(status)])),
        );
        sendJson(res, 200, { queue: groups });
        return;
    }

    if (req.method === 'GET' && pathname === '/api/schedules') {
        const schedules = await Promise.all(
            (await listSchedules()).map(async schedule => ({
                schedule,
                state: await readScheduleState(schedule.scheduleId).catch(() => null),
            })),
        );
        sendJson(res, 200, { schedules });
        return;
    }

    if (req.method === 'GET' && pathname === '/api/logs/system') {
        const tail = parseInt(url.searchParams.get('tail') ?? '50', 10);
        sendJson(res, 200, { lines: await readSystemLogs(Number.isFinite(tail) ? tail : 50) });
        return;
    }

    const scheduleActionMatch = pathname.match(/^\/api\/schedules\/([^/]+)\/(enable|disable|run|clear-tasks|remove)$/);
    if (req.method === 'POST' && scheduleActionMatch) {
        assertWebWriteAllowed(options);
        const actor = actorFromHeaders(req.headers);
        const [, scheduleId, action] = scheduleActionMatch;
        const result =
            action === 'enable'
                ? await setScheduleEnabled(scheduleId, true, { actor })
                : action === 'disable'
                  ? await setScheduleEnabled(scheduleId, false, { actor })
                  : action === 'run'
                    ? await runScheduleNow(scheduleId, { actor })
                    : action === 'clear-tasks'
                      ? await clearScheduleTasks(scheduleId, { actor })
                      : await removeSchedule(scheduleId, { actor }).then(() => ({ removed: true }));
        sendJson(res, 200, result);
        return;
    }

    if (req.method === 'POST' && pathname === '/api/tasks/clear-history') {
        assertWebWriteAllowed(options);
        const actor = actorFromHeaders(req.headers);
        const body = await readJsonBody(req);
        const statuses = Array.isArray(body.statuses)
            ? body.statuses.filter((status): status is 'done' | 'blocked' => status === 'done' || status === 'blocked')
            : undefined;
        sendJson(res, 200, await clearHistory({ actor, statuses }));
        return;
    }

    const actionMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/(enqueue|resume|rerun|abandon|cancel|stop|remove)$/);
    if (req.method === 'POST' && actionMatch) {
        assertWebWriteAllowed(options);
        const actor = actorFromHeaders(req.headers);
        const body = await readJsonBody(req);
        const [, taskId, action] = actionMatch;
        const task =
            action === 'enqueue'
                ? await enqueueTask(taskId, { actor })
                : action === 'resume'
                  ? await resumeTask(taskId, { actor })
                  : action === 'rerun'
                    ? await rerunTask(taskId, { actor })
                    : action === 'abandon'
                      ? await abandonTask(taskId, { actor, reason: typeof body.reason === 'string' ? body.reason : undefined })
                      : action === 'cancel'
                        ? await cancelTask(taskId, { actor, reason: typeof body.reason === 'string' ? body.reason : undefined })
                        : action === 'stop'
                          ? await stopTask(taskId, { actor, reason: typeof body.reason === 'string' ? body.reason : undefined })
                          : await removeTask(taskId, { actor, reason: typeof body.reason === 'string' ? body.reason : undefined }).then(() => null);
        sendJson(res, 200, { task });
        return;
    }

    sendJson(res, 404, { error: 'Not found.' });
}

function parseTaskFileArea(value: string | null): 'spec' | 'workdir' {
    return value === 'workdir' ? 'workdir' : 'spec';
}

export function actorFromHeaders(headers: http.IncomingHttpHeaders): ActorRef {
    return requireActor(headers['x-drift-user'], 'web');
}

export function assertWebWriteAllowed(options: Pick<WebServerOptions, 'readOnly'>): void {
    if (options.readOnly) {
        throw new WebHttpError(403, 'Web UI is running in read-only mode.');
    }
}

class WebHttpError extends Error {
    constructor(
        readonly statusCode: number,
        message: string,
    ) {
        super(message);
    }
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString('utf-8').trim();
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, unknown>;
}

function statusFromError(error: unknown): number {
    if (error instanceof WebHttpError) return error.statusCode;
    if (!(error instanceof Error)) return 500;
    if (error.message.includes('not found') || error.message.includes('ENOENT')) return 404;
    if (error.message.includes('Missing or invalid actor')) return 400;
    if (
        error.message.includes('required') ||
        error.message.includes('must be non-empty') ||
        error.message.includes('Invalid draft file path')
    ) {
        return 400;
    }
    if (error.message.startsWith('Only ') || error.message.startsWith('Runner not available')) return 409;
    return 500;
}

function parseOptionalNumber(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return value;
}

function parseOptionalInteger(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
    return value;
}

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
    res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body, null, 2));
}

function sendText(res: http.ServerResponse, statusCode: number, body: string): void {
    res.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(body);
}

function sendHtml(res: http.ServerResponse, body: string): void {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
}

function sendDownload(res: http.ServerResponse, body: Buffer, filename: string): void {
    res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    });
    res.end(body);
}

async function serveClientAsset(res: http.ServerResponse, pathname: string): Promise<void> {
    const clientRoot = path.join(PACKAGE_ROOT, 'dist', 'web', 'client');
    const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const target = path.resolve(clientRoot, requested);
    const relative = path.relative(clientRoot, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        sendText(res, 403, 'Forbidden');
        return;
    }

    const file = await fs.readFile(target).catch(async error => {
        if (requested !== 'index.html' && error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            return fs.readFile(path.join(clientRoot, 'index.html'));
        }
        throw error;
    }).catch(() => null);

    if (!file) {
        sendHtml(
            res,
            '<!doctype html><html><head><meta charset="utf-8"><title>Drift</title></head><body><h1>Drift Web UI is not built</h1><p>Run <code>npm run build:web</code> or <code>npm run build</code>, then restart <code>drift web</code>.</p></body></html>',
        );
        return;
    }

    res.writeHead(200, { 'content-type': contentTypeFor(target) });
    res.end(file);
}

function contentTypeFor(file: string): string {
    const ext = path.extname(file);
    if (ext === '.html') return 'text/html; charset=utf-8';
    if (ext === '.js') return 'text/javascript; charset=utf-8';
    if (ext === '.css') return 'text/css; charset=utf-8';
    if (ext === '.svg') return 'image/svg+xml';
    if (ext === '.png') return 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
    return 'application/octet-stream';
}

function renderAppHtml(options: { readOnly: boolean }): string {
    const config = JSON.stringify(options);
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Drift</title>
  <style>
    :root {
      color-scheme: light;
      --bg:#f4f6f8; --panel:#ffffff; --panel-soft:#f9fafb; --text:#172033; --muted:#667085;
      --line:#d8dee8; --line-strong:#b9c2d1; --accent:#2563eb; --accent-soft:#eef4ff;
      --ok:#15803d; --warn:#b45309; --bad:#b91c1c; --blocked:#7f1d1d; --shadow:0 14px 34px rgba(20, 31, 51, .08);
    }
    * { box-sizing: border-box; }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:var(--bg); color:var(--text); }
    header { height:60px; display:flex; align-items:center; justify-content:space-between; gap:16px; padding:0 18px; border-bottom:1px solid var(--line); background:rgba(255,255,255,.92); position:sticky; top:0; z-index:5; backdrop-filter: blur(10px); }
    h1 { font-size:19px; margin:0; font-weight:720; letter-spacing:0; }
    h2 { font-size:20px; margin:0; letter-spacing:0; }
    h3 { font-size:13px; margin:0 0 10px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
    main { display:grid; grid-template-columns: 330px minmax(420px, 1fr) 360px; min-height:calc(100vh - 60px); }
    aside, .rail { background:var(--panel); overflow:auto; }
    aside { border-right:1px solid var(--line); padding:16px; }
    .rail { border-left:1px solid var(--line); padding:16px; }
    .workspace { padding:18px; overflow:auto; }
    button, input, textarea { font:inherit; }
    button { border:1px solid var(--line); background:#fff; border-radius:7px; padding:8px 11px; cursor:pointer; color:var(--text); }
    button:hover:not(:disabled) { border-color:var(--line-strong); background:#f8fafc; }
    button.primary { border-color:var(--accent); background:var(--accent); color:#fff; }
    button.primary:hover:not(:disabled) { background:#1d4ed8; border-color:#1d4ed8; }
    button.danger { border-color:#fecaca; color:var(--bad); background:#fff7f7; }
    button.ghost { background:transparent; }
    button:disabled { opacity:.5; cursor:not-allowed; }
    input, textarea { border:1px solid var(--line); border-radius:7px; padding:8px 10px; background:#fff; color:var(--text); }
    textarea { width:100%; min-height:88px; resize:vertical; }
    .row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .between { display:flex; align-items:center; justify-content:space-between; gap:12px; }
    .muted { color:var(--muted); }
    .brand { display:flex; align-items:center; gap:10px; }
    .mark { width:28px; height:28px; border-radius:7px; background:#111827; color:#fff; display:grid; place-items:center; font-weight:800; }
    .pill, .badge { display:inline-flex; align-items:center; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; color:var(--muted); background:#fff; white-space:nowrap; }
    .language-toggle { display:inline-flex; border:1px solid var(--line); border-radius:8px; overflow:hidden; background:#fff; }
    .language-toggle button { border:0; border-radius:0; padding:7px 10px; }
    .language-toggle button.active { background:var(--accent); color:#fff; }
    .badge.pending { color:#1d4ed8; background:#eff6ff; border-color:#bfdbfe; }
    .badge.running { color:#047857; background:#ecfdf5; border-color:#bbf7d0; }
    .badge.paused { color:#b45309; background:#fffbeb; border-color:#fde68a; }
    .badge.blocked { color:#991b1b; background:#fef2f2; border-color:#fecaca; }
    .badge.done { color:#166534; background:#f0fdf4; border-color:#bbf7d0; }
    .badge.not_queued { color:#475569; background:#f8fafc; border-color:#cbd5e1; }
    .status-strip { display:grid; grid-template-columns: repeat(6, minmax(86px, 1fr)); gap:9px; margin-bottom:14px; }
    .stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:11px; box-shadow:0 1px 0 rgba(16,24,40,.02); }
    .stat strong { display:block; font-size:22px; line-height:1.1; margin-top:4px; }
    .filters { display:grid; grid-template-columns: repeat(2, 1fr); gap:7px; margin:12px 0; }
    .filters button { display:flex; justify-content:space-between; align-items:center; padding:8px 9px; }
    .filters button.active { border-color:var(--accent); color:var(--accent); background:var(--accent-soft); }
    .search { width:100%; margin:10px 0 4px; }
    .task-list { margin-top:12px; }
    .task { width:100%; text-align:left; margin-bottom:9px; border-radius:8px; padding:10px; background:#fff; border:1px solid var(--line); }
    .task.active { border-color:var(--accent); box-shadow:0 0 0 3px rgba(37,99,235,.10); }
    .task strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-bottom:6px; }
    .task .meta { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:12px; color:var(--muted); }
    .panel { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:15px; margin-bottom:14px; box-shadow:0 1px 0 rgba(16,24,40,.02); }
    .hero-panel { padding:18px; }
    .detail-title { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:12px; }
    .actions { display:flex; gap:8px; flex-wrap:wrap; padding-top:12px; border-top:1px solid var(--line); margin-top:12px; }
    .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:10px; }
    .kv { border-top:1px solid var(--line); padding:9px 0; display:grid; grid-template-columns:150px 1fr; gap:10px; }
    .kv:first-child { border-top:0; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:12px; }
    pre { white-space:pre-wrap; word-break:break-word; background:#101828; color:#e5e7eb; padding:14px; border-radius:8px; overflow:auto; max-height:420px; }
    table { width:100%; border-collapse:collapse; }
    th, td { text-align:left; border-bottom:1px solid var(--line); padding:8px 6px; vertical-align:top; font-size:13px; }
    th { color:var(--muted); font-weight:600; }
    .empty { min-height:320px; display:grid; place-items:center; color:var(--muted); text-align:center; }
    .modal { position:fixed; inset:0; display:none; align-items:center; justify-content:center; background:rgba(15,23,42,.48); z-index:20; padding:20px; }
    .modal.active { display:flex; }
    .dialog { width:min(440px, 100%); background:#fff; border:1px solid var(--line); border-radius:10px; box-shadow:var(--shadow); padding:20px; }
    .dialog h2 { margin-bottom:8px; }
    .dialog p { color:var(--muted); margin:0 0 16px; line-height:1.5; }
    .dialog input { width:100%; margin-bottom:10px; }
    .error { color:var(--bad); min-height:20px; font-size:13px; }
    @media (max-width: 1180px) { main { grid-template-columns: 310px 1fr; } .rail { grid-column:1 / -1; border-left:0; border-top:1px solid var(--line); } }
    @media (max-width: 760px) { header { height:auto; align-items:flex-start; padding:12px; flex-direction:column; } main { grid-template-columns:1fr; } aside { border-right:0; border-bottom:1px solid var(--line); max-height:48vh; } .workspace, .rail { padding:12px; } .status-strip { grid-template-columns: repeat(2, 1fr); } .kv { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <header>
    <div class="brand"><div class="mark">D</div><div><h1>Drift</h1><div class="muted mono" data-i18n="workspaceControl">workspace control</div></div></div>
    <div class="row">
      <span id="mode" class="pill"></span>
      <span id="actorChip" class="pill"></span>
      <div class="language-toggle" aria-label="Language">
        <button id="langEn" type="button">EN</button>
        <button id="langZh" type="button">中文</button>
      </div>
      <button class="ghost" id="changeActor" data-i18n="changeUser">Change user</button>
      <button id="refreshButton" data-i18n="refresh">Refresh</button>
    </div>
  </header>
  <main>
    <aside>
      <div class="between"><h3 data-i18n="tasks">Tasks</h3><span id="taskCount" class="pill">0</span></div>
      <input id="search" class="search" placeholder="Search title, id, type" />
      <div class="filters" id="filters"></div>
      <div id="tasks" class="task-list"></div>
    </aside>
    <section class="workspace">
      <div id="statusStrip" class="status-strip"></div>
      <div id="detail"></div>
    </section>
    <section class="rail">
      <div id="queuePanel" class="panel"></div>
      <div id="schedulePanel" class="panel"></div>
      <div id="systemPanel" class="panel"></div>
    </section>
  </main>
  <div id="actorModal" class="modal" role="dialog" aria-modal="true">
    <form id="actorForm" class="dialog">
      <h2 data-i18n="actorTitle">Set your display name</h2>
      <p data-i18n="actorDescription">This name is stored in this browser and written to the audit log for Web write actions. It is not authentication.</p>
      <input id="actorInput" autocomplete="name" maxlength="40" placeholder="For example, York" />
      <div id="actorError" class="error"></div>
      <div class="row"><button class="primary" type="submit">Continue</button></div>
    </form>
  </div>
  <script>
    const config = ${config};
    const statuses = ['all', 'not_queued', 'pending', 'running', 'paused', 'blocked', 'done'];
    const messages = {
      en: {
        workspaceControl: 'workspace control',
        readOnly: 'read-only',
        writeEnabled: 'write enabled',
        userRequired: 'User required',
        userPrefix: 'User: ',
        changeUser: 'Change user',
        refresh: 'Refresh',
        tasks: 'Tasks',
        searchPlaceholder: 'Search title, id, type',
        actorTitle: 'Set your display name',
        actorDescription: 'This name is stored in this browser and written to the audit log for Web write actions. It is not authentication.',
        actorPlaceholder: 'For example, York',
        actorContinue: 'Continue',
        actorInvalid: 'Enter a display name from 1 to 40 characters.',
        userNameRequired: 'User name is required.',
        noMatchingTasks: 'No matching tasks.',
        selectTask: 'Select a task to inspect it.',
        queueTruth: 'Queue Truth',
        schedules: 'Schedules',
        systemLog: 'System Log',
        noLogsToday: 'No logs today.',
        queue: 'Queue',
        retry: 'Retry',
        latestRun: 'Latest Run',
        budget: 'Budget',
        createdBy: 'Created By',
        createdAt: 'Created At',
        lastEnqueued: 'Last Enqueued',
        lastStarted: 'Last Started',
        lastFinished: 'Last Finished',
        timeout: 'Timeout',
        noRunYet: 'No run yet.',
        runId: 'Run ID',
        trigger: 'Trigger',
        runStatus: 'Run Status',
        sessionRef: 'Session Ref',
        started: 'Started',
        finished: 'Finished',
        reason: 'Reason',
        resultStatus: 'Result Status',
        artifacts: 'Artifacts',
        logPreview: 'Log Preview',
        chooseLog: '(choose stdout or stderr)',
        emptyLog: '(empty)',
        abandonReason: 'Reason',
        abandonedReason: 'Task abandoned',
        enqueue: 'Enqueue',
        resume: 'Resume',
        rerun: 'Rerun',
        abandon: 'Abandon',
        enabled: 'enabled',
        disabled: 'disabled',
        status: { all: 'all', not_queued: 'not queued', pending: 'pending', running: 'running', paused: 'paused', blocked: 'blocked', done: 'done' }
      },
      zh: {
        workspaceControl: '工作区控制台',
        readOnly: '只读模式',
        writeEnabled: '允许写操作',
        userRequired: '需要设置用户',
        userPrefix: '用户：',
        changeUser: '切换用户',
        refresh: '刷新',
        tasks: '任务',
        searchPlaceholder: '搜索标题、ID、类型',
        actorTitle: '设置你的显示名称',
        actorDescription: '这个名称会保存在当前浏览器，并随 Web 写操作写入审计日志。它不是登录认证。',
        actorPlaceholder: '例如 York',
        actorContinue: '继续',
        actorInvalid: '请输入 1-40 个字符的显示名称。',
        userNameRequired: '需要设置用户名称。',
        noMatchingTasks: '没有匹配的任务。',
        selectTask: '选择一个任务查看详情。',
        queueTruth: '队列真相',
        schedules: '定时任务',
        systemLog: '系统日志',
        noLogsToday: '今天暂无日志。',
        queue: '队列',
        retry: '重试',
        latestRun: '最新运行',
        budget: '预算',
        createdBy: '创建来源',
        createdAt: '创建时间',
        lastEnqueued: '最近入队',
        lastStarted: '最近开始',
        lastFinished: '最近结束',
        timeout: '超时',
        noRunYet: '还没有运行记录。',
        runId: '运行 ID',
        trigger: '触发方式',
        runStatus: '运行状态',
        sessionRef: '会话引用',
        started: '开始时间',
        finished: '结束时间',
        reason: '原因',
        resultStatus: '结果状态',
        artifacts: '产物',
        logPreview: '日志预览',
        chooseLog: '（选择 stdout 或 stderr）',
        emptyLog: '（空）',
        abandonReason: '原因',
        abandonedReason: '放弃任务',
        enqueue: '入队',
        resume: '恢复',
        rerun: '重跑',
        abandon: '放弃',
        enabled: '已启用',
        disabled: '已停用',
        status: { all: '全部', not_queued: '未入队', pending: '待执行', running: '运行中', paused: '暂停', blocked: '阻塞', done: '完成' }
      }
    };
    let language = localStorage.getItem('drift:language') === 'zh' ? 'zh' : 'en';
    let state = { filter: 'all', query: '', tasks: [], selected: null, detail: null, counts: {} };
    const actorInput = document.getElementById('actorInput');
    const actorModal = document.getElementById('actorModal');
    const actorChip = document.getElementById('actorChip');
    document.getElementById('refreshButton').onclick = () => refresh();
    document.getElementById('changeActor').onclick = () => showActorModal();
    document.getElementById('langEn').onclick = () => setLanguage('en');
    document.getElementById('langZh').onclick = () => setLanguage('zh');
    document.getElementById('search').addEventListener('input', event => { state.query = event.target.value.trim().toLowerCase(); renderTasks(); });
    document.getElementById('actorForm').addEventListener('submit', event => {
      event.preventDefault();
      const name = actorInput.value.trim();
      if (!validActorName(name)) {
        document.getElementById('actorError').textContent = t('actorInvalid');
        return;
      }
      localStorage.setItem('drift:userName', name);
      updateActorChip();
      actorModal.classList.remove('active');
      refresh();
    });

    function t(key) { return messages[language][key] || messages.en[key] || key; }
    function statusText(status) { return messages[language].status[status] || status; }
    function applyLanguage() {
      document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
      document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
      document.getElementById('search').placeholder = t('searchPlaceholder');
      actorInput.placeholder = t('actorPlaceholder');
      document.querySelector('#actorForm button[type="submit"]').textContent = t('actorContinue');
      document.getElementById('mode').textContent = config.readOnly ? t('readOnly') : t('writeEnabled');
      document.getElementById('langEn').classList.toggle('active', language === 'en');
      document.getElementById('langZh').classList.toggle('active', language === 'zh');
      updateActorChip();
    }
    function setLanguage(nextLanguage) {
      language = nextLanguage === 'zh' ? 'zh' : 'en';
      localStorage.setItem('drift:language', language);
      applyLanguage();
      renderFilters(state.counts);
      renderTasks();
      renderStatusStrip(state.counts);
      renderDetail();
    }

    function validActorName(name) { return typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 40; }
    function currentActor() { return localStorage.getItem('drift:userName') || ''; }
    function updateActorChip() { actorChip.textContent = currentActor() ? t('userPrefix') + currentActor() : t('userRequired'); }
    function showActorModal() { actorInput.value = currentActor(); document.getElementById('actorError').textContent = ''; actorModal.classList.add('active'); setTimeout(() => actorInput.focus(), 0); }
    function ensureActorBeforeUse() { updateActorChip(); if (!validActorName(currentActor())) showActorModal(); }

    async function api(path, options = {}) {
      const headers = { ...(options.headers || {}) };
      if (options.body) headers['content-type'] = 'application/json';
      if (options.method && options.method !== 'GET') {
        const actor = currentActor().trim();
        if (!validActorName(actor)) { showActorModal(); throw new Error(t('userNameRequired')); }
        headers['x-drift-user'] = actor;
      }
      const res = await fetch(path, { ...options, headers });
      const type = res.headers.get('content-type') || '';
      const body = type.includes('application/json') ? await res.json() : await res.text();
      if (!res.ok) throw new Error(body.error || body || res.statusText);
      return body;
    }

    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
    }

    async function refresh() {
      ensureActorBeforeUse();
      const [status, taskData, queueData, scheduleData, logs] = await Promise.all([
        api('/api/status'),
        api('/api/tasks' + (state.filter === 'all' ? '' : '?status=' + encodeURIComponent(state.filter))),
        api('/api/queue'),
        api('/api/schedules'),
        api('/api/logs/system')
      ]);
      state.tasks = taskData.tasks;
      state.counts = status.counts;
      renderFilters(status.counts);
      renderTasks();
      renderStatusStrip(status.counts);
      renderQueue(queueData.queue);
      renderSchedules(scheduleData.schedules);
      renderSystemLog(logs.lines);
      if (state.selected) await selectTask(state.selected, false);
      if (!state.selected && state.tasks[0]) await selectTask(state.tasks[0].taskId, false);
    }

    function renderFilters(counts) {
      const total = Object.values(counts).reduce((sum, count) => sum + Number(count || 0), 0);
      document.getElementById('filters').innerHTML = statuses.map(status => '<button class="' + (state.filter === status ? 'active' : '') + '" data-status="' + status + '"><span>' + statusText(status) + '</span><strong>' + (status === 'all' ? total : (counts[status] || 0)) + '</strong></button>').join('');
      document.querySelectorAll('[data-status]').forEach(button => button.onclick = () => { state.filter = button.dataset.status; state.selected = null; state.detail = null; refresh(); });
    }

    function renderTasks() {
      const tasks = state.tasks.filter(task => {
        if (!state.query) return true;
        return [task.title, task.taskId, task.type, task.runner, task.status].some(value => String(value || '').toLowerCase().includes(state.query));
      });
      document.getElementById('taskCount').textContent = String(tasks.length);
      document.getElementById('tasks').innerHTML = tasks.map(task => '<button class="task ' + (state.selected === task.taskId ? 'active' : '') + '" data-task="' + esc(task.taskId) + '"><strong>' + esc(task.title) + '</strong><div class="meta"><span class="mono">' + esc(task.taskId) + '</span>' + badge(task.status) + '</div><div class="meta"><span>' + esc(task.type) + '</span><span>' + esc(task.runner) + '</span></div></button>').join('') || '<p class="muted">' + esc(t('noMatchingTasks')) + '</p>';
      document.querySelectorAll('[data-task]').forEach(button => button.onclick = () => selectTask(button.dataset.task));
    }

    function renderStatusStrip(counts) {
      document.getElementById('statusStrip').innerHTML = ['pending', 'running', 'paused', 'blocked', 'done', 'not_queued'].map(status => '<div class="stat"><span class="muted">' + statusText(status) + '</span><strong>' + (counts[status] || 0) + '</strong></div>').join('');
    }

    function renderQueue(queue) {
      const rows = Object.entries(queue).map(([name, items]) => '<tr><td>' + badge(name) + '</td><td>' + items.length + '</td><td class="mono">' + esc(items.slice(0, 4).map(item => item.taskId).join('\\n') || '-') + '</td></tr>').join('');
      document.getElementById('queuePanel').innerHTML = '<h3>' + esc(t('queueTruth')) + '</h3><table><tbody>' + rows + '</tbody></table>';
    }

    function renderSchedules(schedules) {
      document.getElementById('schedulePanel').innerHTML = '<h3>' + esc(t('schedules')) + '</h3><table><tbody>' + schedules.map(item => '<tr><td class="mono">' + esc(item.schedule.scheduleId) + '</td><td>' + (item.schedule.enabled ? '<span class="badge running">' + esc(t('enabled')) + '</span>' : '<span class="badge not_queued">' + esc(t('disabled')) + '</span>') + '</td><td>' + esc(item.schedule.cron) + '</td><td>' + esc(item.state?.lastRunStatus || '-') + '</td></tr>').join('') + '</tbody></table>';
    }

    function renderSystemLog(logs) {
      document.getElementById('systemPanel').innerHTML = '<h3>' + esc(t('systemLog')) + '</h3><pre>' + esc(logs.join('\\n') || t('noLogsToday')) + '</pre>';
    }

    async function selectTask(taskId, scroll = true) {
      state.selected = taskId;
      state.detail = await api('/api/tasks/' + encodeURIComponent(taskId));
      renderTasks();
      renderDetail();
      if (scroll) document.getElementById('detail').scrollIntoView({ block: 'start' });
    }

    function renderDetail() {
      const detail = state.detail;
      if (!detail) { document.getElementById('detail').innerHTML = '<div class="panel empty">' + esc(t('selectTask')) + '</div>'; return; }
      const task = detail.task;
      const latest = detail.latestRun;
      const actions = [
        ['enqueue', task.status === 'not_queued'],
        ['resume', task.status === 'paused'],
        ['rerun', task.status === 'done' || task.status === 'blocked'],
        ['abandon', task.status === 'paused']
      ].map(([name, enabled]) => '<button class="' + (name === 'abandon' ? 'danger' : 'primary') + '" data-action="' + name + '" ' + (!enabled || config.readOnly ? 'disabled' : '') + '>' + esc(t(name)) + '</button>').join('');
      document.getElementById('detail').innerHTML = '<div class="panel hero-panel"><div class="detail-title"><div><h2>' + esc(task.title) + '</h2><div class="row" style="margin-top:8px">' + badge(task.status) + '<span class="pill">' + esc(task.type) + '</span><span class="pill">' + esc(task.runner) + '</span></div></div><span class="mono muted">' + esc(task.taskId) + '</span></div><div class="grid">' + metric(t('queue'), detail.queueStatus ? statusText(detail.queueStatus) : '-') + metric(t('retry'), task.retryCount + '/' + task.maxRetries) + metric(t('latestRun'), task.latestRunId || '-') + metric(t('budget'), '$' + task.budgetUsd) + '</div><div class="actions">' + actions + '</div></div><div class="panel">' + kv(t('createdBy'), task.createdBy.sourceId ? task.createdBy.kind + ' (' + task.createdBy.sourceId + ')' : task.createdBy.kind) + kv(t('createdAt'), task.createdAt) + kv(t('lastEnqueued'), task.lastEnqueuedAt || '-') + kv(t('lastStarted'), task.lastStartedAt || '-') + kv(t('lastFinished'), task.lastFinishedAt || '-') + kv(t('timeout'), task.timeoutMs + ' ms') + '</div>' + renderLatest(latest, task);
      document.querySelectorAll('[data-action]').forEach(button => button.onclick = () => runAction(task.taskId, button.dataset.action));
    }

    function kv(label, value) { return '<div class="kv"><span class="muted">' + esc(label) + '</span><span>' + esc(value) + '</span></div>'; }
    function metric(label, value) { return '<div class="stat"><span class="muted">' + esc(label) + '</span><strong style="font-size:16px">' + esc(value) + '</strong></div>'; }
    function badge(status) { return '<span class="badge ' + esc(status) + '">' + esc(statusText(status)) + '</span>'; }

    function renderLatest(latest, task) {
      if (!latest) return '<div class="panel"><h3>' + esc(t('latestRun')) + '</h3><p class="muted">' + esc(t('noRunYet')) + '</p></div>';
      const run = latest.runMeta || {};
      const result = latest.result || {};
      return '<div class="panel"><div class="between"><h3>' + esc(t('latestRun')) + '</h3><div class="row"><button data-log="stdout">stdout</button><button data-log="stderr">stderr</button></div></div>' + kv(t('runId'), run.runId || task.latestRunId || '-') + kv(t('trigger'), run.trigger || '-') + kv(t('runStatus'), run.status || '-') + kv(t('sessionRef'), run.sessionRef || '-') + kv(t('started'), run.startedAt || '-') + kv(t('finished'), run.finishedAt || '-') + kv(t('reason'), result.reason || run.reason || '-') + kv(t('resultStatus'), result.status || '-') + '<h3>' + esc(t('artifacts')) + '</h3><pre class="mono">' + esc((latest.artifacts || []).join('\\n') || '-') + '</pre><h3>' + esc(t('logPreview')) + '</h3><pre id="log">' + esc(t('chooseLog')) + '</pre></div>';
    }

    async function runAction(taskId, action) {
      const reason = action === 'abandon' ? prompt(t('abandonReason'), t('abandonedReason')) : undefined;
      try {
        await api('/api/tasks/' + encodeURIComponent(taskId) + '/' + action, { method: 'POST', body: JSON.stringify({ reason }) });
        await refresh();
      } catch (error) {
        alert(error.message);
      }
    }

    document.addEventListener('click', async event => {
      const button = event.target.closest('[data-log]');
      if (!button || !state.detail?.task?.latestRunId) return;
      const task = state.detail.task;
      const text = await api('/api/tasks/' + encodeURIComponent(task.taskId) + '/runs/' + encodeURIComponent(task.latestRunId) + '/logs/' + button.dataset.log);
      document.getElementById('log').textContent = text || t('emptyLog');
    });

    applyLanguage();
    ensureActorBeforeUse();
    refresh().catch(error => document.getElementById('detail').innerHTML = '<div class="panel empty">' + esc(error.message) + '</div>');
  </script>
</body>
</html>`;
}
