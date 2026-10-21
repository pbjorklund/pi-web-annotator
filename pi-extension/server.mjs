// Generated from pi-extension/server.ts; run npm run build:typescript. Do not edit.
import { createServer } from 'node:http';
import { object } from './contracts.mjs';
class HttpError extends Error {
    status;
    constructor(message, status) { super(message); this.status = status; }
}
const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_JOBS = 200;
const MARKER_PATTERN = /<!-- pi-web-annotator-job:([A-Za-z0-9_-]{8,100}) -->/;
function sendJson(response, status, body) {
    response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
    });
    response.end(JSON.stringify(body));
}
async function readJson(request) {
    let size = 0;
    const chunks = [];
    const stream = request;
    for await (const value of stream) {
        if (!Buffer.isBuffer(value) && typeof value !== 'string')
            throw new HttpError('Invalid request bytes', 400);
        const chunk = typeof value === 'string' ? Buffer.from(value) : value;
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
            throw new HttpError('Request body too large', 413);
        }
        chunks.push(chunk);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    catch {
        throw new HttpError('Invalid JSON', 400);
    }
}
function validJob(input) {
    return object(input)
        && typeof input.id === 'string' && JOB_ID_PATTERN.test(input.id)
        && typeof input.prompt === 'string'
        && input.prompt.trim().length > 0
        && input.prompt.length <= 100_000
        && Array.isArray(input.annotationIds)
        && input.annotationIds.length > 0
        && input.annotationIds.length <= 500
        && input.annotationIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 100);
}
function trimJobs(jobs) {
    while (jobs.size > MAX_JOBS) {
        const next = jobs.keys().next();
        if (next.done)
            break;
        jobs.delete(next.value);
    }
}
export function annotationJobMarker(jobId) {
    if (!JOB_ID_PATTERN.test(jobId))
        throw new Error('Invalid annotation job ID');
    return `<!-- pi-web-annotator-job:${jobId} -->`;
}
export function extractAnnotationJobId(content) {
    const text = typeof content === 'string'
        ? content
        : Array.isArray(content)
            ? content.filter((part) => object(part) && part.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n')
            : '';
    return text.match(MARKER_PATTERN)?.[1];
}
export async function createAnnotationServer({ host = '127.0.0.1', port = 17373, onJob, }) {
    if (typeof onJob !== 'function')
        throw new Error('onJob is required');
    const jobs = new Map();
    const server = createServer(async (request, response) => {
        try {
            if (request.headers['x-pi-web-annotator'] !== '1') {
                sendJson(response, 403, { error: 'Forbidden' });
                return;
            }
            if (request.method === 'GET' && request.url === '/health') {
                sendJson(response, 200, { ok: true });
                return;
            }
            if (request.method === 'POST' && request.url === '/jobs') {
                const input = await readJson(request);
                if (!validJob(input)) {
                    sendJson(response, 400, { error: 'Invalid annotation job' });
                    return;
                }
                if (jobs.has(input.id)) {
                    sendJson(response, 409, { error: 'Job already exists' });
                    return;
                }
                const job = {
                    id: input.id,
                    prompt: input.prompt,
                    annotationIds: [...input.annotationIds],
                };
                jobs.set(job.id, 'sent');
                trimJobs(jobs);
                try {
                    await onJob(job);
                }
                catch (error) {
                    jobs.delete(job.id);
                    sendJson(response, 503, { error: error instanceof Error ? error.message : 'Pi rejected the job' });
                    return;
                }
                sendJson(response, 202, { id: job.id, status: jobs.get(job.id) });
                return;
            }
            if (request.method === 'POST' && request.url === '/jobs/status') {
                const input = await readJson(request);
                if (!object(input) || !Array.isArray(input.ids) || input.ids.length > MAX_JOBS) {
                    sendJson(response, 400, { error: 'Invalid job IDs' });
                    return;
                }
                const statuses = {};
                for (const id of input.ids) {
                    if (typeof id === 'string' && jobs.has(id))
                        statuses[id] = jobs.get(id);
                }
                sendJson(response, 200, { jobs: statuses });
                return;
            }
            sendJson(response, 404, { error: 'Not found' });
        }
        catch (error) {
            sendJson(response, error instanceof HttpError ? error.status : 500, { error: error instanceof Error ? error.message : 'Server error' });
        }
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
            server.off('error', reject);
            resolve();
        });
    });
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    return {
        url: `http://${host}:${actualPort}`,
        markPending(jobId) {
            if (jobs.has(jobId))
                jobs.set(jobId, 'pending');
        },
        markInProgress(jobId) {
            if (jobs.has(jobId))
                jobs.set(jobId, 'in_progress');
        },
        markCompleted(jobId) {
            if (jobs.has(jobId))
                jobs.set(jobId, 'completed');
        },
        close() {
            return new Promise((resolve, reject) => {
                server.close((error) => error ? reject(error) : resolve());
                server.closeAllConnections();
            });
        },
    };
}
