import Fastify from 'fastify';
import cors from '@fastify/cors';
import { orderRoutes } from './routes/orders.js';
import { missionRoutes } from './routes/missions.js';
import { droneRoutes } from './routes/drone.js';
import { telemetryRoutes } from './routes/telemetry.js';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  app.get('/health', async () => ({ status: 'ok', time: new Date().toISOString() }));

  await app.register(orderRoutes);
  await app.register(missionRoutes);
  await app.register(droneRoutes);
  await app.register(telemetryRoutes);

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`API listening on http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
