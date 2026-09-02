import type { FastifyInstance } from 'fastify';
import type { DroneCommand } from '@drone/shared';
import { dispatch } from '../dispatch.js';

const VALID_COMMANDS: DroneCommand[] = ['hold', 'resume', 'rtl'];

export async function droneRoutes(app: FastifyInstance): Promise<void> {
  // Current telemetry snapshot (handy for polling / debugging).
  app.get('/drone/telemetry', async () => dispatch.currentTelemetry());

  // Flight commands. In the mock these nudge the simulated drone; with PX4
  // they will map to MAVSDK Action calls (hold, RTL, etc.).
  app.post('/drone/command', async (request, reply) => {
    const body = request.body as { command?: string } | undefined;
    const command = body?.command as DroneCommand | undefined;
    if (!command || !VALID_COMMANDS.includes(command)) {
      return reply
        .code(400)
        .send({ error: `command must be one of ${VALID_COMMANDS.join(', ')}` });
    }
    await dispatch.command(command);
    return { ok: true, command };
  });
}
