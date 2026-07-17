import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import {
  annotationJobMarker,
  createAnnotationServer,
  extractAnnotationJobId,
} from './server.mjs';

const configuredPort = Number.parseInt(process.env.PI_WEB_ANNOTATOR_PORT ?? '', 10);
const PORT = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 17373;
const STATUS_ID = 'annotation-server';

type AnnotationServer = Awaited<ReturnType<typeof createAnnotationServer>>;

export default function piWebAnnotatorExtension(pi: ExtensionAPI) {
  let server: AnnotationServer | undefined;
  let currentContext: ExtensionContext | undefined;
  let activeJobId: string | undefined;
  let activeJobFailed = false;

  function showRunningStatus(ctx: ExtensionContext) {
    ctx.ui.setStatus(
      STATUS_ID,
      ctx.ui.theme.fg('success', '●') + ctx.ui.theme.fg('dim', ` annotations :${PORT}`),
    );
  }

  async function startServer(ctx: ExtensionContext) {
    if (server) {
      showRunningStatus(ctx);
      return;
    }
    currentContext = ctx;
    server = await createAnnotationServer({
      port: PORT,
      async onJob(job) {
        const liveContext = currentContext;
        if (!liveContext || !server) throw new Error('No active Pi session');
        const prompt = `${annotationJobMarker(job.id)}\n${job.prompt}`;
        if (liveContext.isIdle()) {
          activeJobId = job.id;
          activeJobFailed = false;
          server.markInProgress(job.id);
          pi.sendUserMessage(prompt);
        } else {
          pi.sendUserMessage(prompt, { deliverAs: 'followUp' });
        }
        liveContext.ui.notify(
          `Received ${job.annotationIds.length} browser annotation${job.annotationIds.length === 1 ? '' : 's'}`,
          'info',
        );
      },
    });
    showRunningStatus(ctx);
    ctx.ui.notify(`Annotation server listening on 127.0.0.1:${PORT}`, 'info');
  }

  async function stopServer(ctx?: ExtensionContext) {
    const running = server;
    server = undefined;
    activeJobId = undefined;
    activeJobFailed = false;
    if (running) await running.close();
    ctx?.ui.setStatus(STATUS_ID, undefined);
    ctx?.ui.notify('Annotation server stopped', 'info');
  }

  pi.registerCommand('annotation-server', {
    description: 'Start, stop, or show the browser annotation bridge',
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (action === 'status') {
        ctx.ui.notify(server ? `Annotation server is running on port ${PORT}` : 'Annotation server is stopped', 'info');
        return;
      }
      if (action === 'stop' || (!action && server)) {
        await stopServer(ctx);
        return;
      }
      if (action && action !== 'start') {
        ctx.ui.notify('Usage: /annotation-server [start|stop|status]', 'warning');
        return;
      }
      try {
        await startServer(ctx);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : 'Could not start annotation server', 'error');
      }
    },
  });

  pi.on('session_start', async (_event, ctx) => {
    currentContext = ctx;
  });

  pi.on('message_start', async (event) => {
    if (!server || event.message.role !== 'user') return;
    const jobId = extractAnnotationJobId(event.message.content);
    if (!jobId) return;
    if (activeJobId && activeJobId !== jobId) {
      if (activeJobFailed) server.markPending(activeJobId);
      else server.markCompleted(activeJobId);
    }
    activeJobId = jobId;
    activeJobFailed = false;
    server.markInProgress(jobId);
  });

  pi.on('agent_start', async () => {
    if (activeJobId) activeJobFailed = false;
  });

  pi.on('agent_end', async (event) => {
    if (!activeJobId) return;
    for (let index = event.messages.length - 1; index >= 0; index--) {
      const message = event.messages[index];
      if (message.role !== 'assistant') continue;
      activeJobFailed = message.stopReason === 'aborted' || message.stopReason === 'error';
      break;
    }
  });

  pi.on('agent_settled', async () => {
    if (!server || !activeJobId) return;
    if (activeJobFailed) server.markPending(activeJobId);
    else server.markCompleted(activeJobId);
    activeJobId = undefined;
    activeJobFailed = false;
  });

  pi.on('session_shutdown', async (_event, ctx) => {
    await stopServer(ctx);
    currentContext = undefined;
  });
}
