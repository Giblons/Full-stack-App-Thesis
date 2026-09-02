import type { FastifyInstance } from 'fastify';
import { store } from '../store.js';

export async function missionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/missions', async () => store.listMissions());

  app.get('/missions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const mission = store.getMission(id);
    if (!mission) return reply.code(404).send({ error: 'Mission not found' });
    return mission;
  });
}
