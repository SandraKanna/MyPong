import type { FastifyRequest } from 'fastify';

export function getUserId(request: FastifyRequest): number | null {
  const raw = request.headers['x-user-id'];
  if (typeof raw !== 'string') return null;
  const id = Number(raw);
  return Number.isNaN(id) ? null : id;
}
