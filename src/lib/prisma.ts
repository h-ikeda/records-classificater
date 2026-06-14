import { PrismaClient } from '@prisma/client';
import { resolveDatabaseUrl } from './schema-name.mjs';

// The schema is fixed for the lifetime of a deployment (production or a single
// preview), so a module-level singleton with a schema-scoped URL is correct.
// We cache on globalThis to survive Next.js hot-reloads and route-module reuse.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient({
      datasources: { db: { url: resolveDatabaseUrl() } },
    });
  }
  return globalForPrisma.prisma;
}

// Lazy proxy: the client (and thus DATABASE_URL) is only required on first use
// at request time, not when the module is imported (which happens during
// `next build` page-data collection, where no database is available).
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
