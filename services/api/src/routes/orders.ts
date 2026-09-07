import type { FastifyInstance } from 'fastify';
import type { CreateOrderInput, LatLng } from '@drone/shared';
import { store } from '../store.js';
import { dispatch } from '../dispatch.js';

function isLatLng(value: unknown): value is LatLng {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as LatLng).lat === 'number' &&
    typeof (value as LatLng).lng === 'number'
  );
}

function validate(body: unknown): CreateOrderInput | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (
    typeof b.customerName !== 'string' ||
    typeof b.packageDescription !== 'string' ||
    !isLatLng(b.pickup) ||
    !isLatLng(b.dropoff)
  ) {
    return null;
  }
  return {
    customerName: b.customerName,
    packageDescription: b.packageDescription,
    pickup: b.pickup,
    dropoff: b.dropoff,
  };
}

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  app.post('/orders', async (request, reply) => {
    const input = validate(request.body);
    if (!input) {
      return reply.code(400).send({
        error:
          'Invalid order. Expected { customerName, packageDescription, pickup:{lat,lng}, dropoff:{lat,lng} }.',
      });
    }
    const order = store.createOrder(input);
    const dispatched = await dispatch.dispatch(order);
    return reply.code(201).send(dispatched);
  });

  app.get('/orders', async () => store.listOrders());

  app.get('/orders/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const order = store.getOrder(id);
    if (!order) return reply.code(404).send({ error: 'Order not found' });
    return order;
  });
}
