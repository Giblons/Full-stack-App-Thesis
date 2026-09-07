import type { FastifyInstance } from 'fastify';
import type { TelemetryEvent } from '@drone/shared';
import { dispatch } from '../dispatch.js';

/**
 * Server-Sent Events stream. The GCS opens an EventSource here and receives a
 * continuous feed of telemetry / mission / order updates. SSE keeps the thin
 * slice simple (plain HTTP, auto-reconnect); a WebSocket could replace it if
 * two-way streaming is later required.
 */
export async function telemetryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/telemetry/stream', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const send = (event: TelemetryEvent): void => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Prime the new client with the latest snapshot immediately.
    send({ type: 'telemetry', data: dispatch.currentTelemetry() });

    const unsubscribe = dispatch.subscribe(send);

    // Heartbeat keeps proxies from closing an idle connection.
    const heartbeat = setInterval(() => {
      reply.raw.write(': ping\n\n');
    }, 15_000);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
