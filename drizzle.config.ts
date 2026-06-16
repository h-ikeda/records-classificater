import { defineConfig } from 'drizzle-kit';

// Neon RLS では `authenticated` / `anonymous` ロールは Neon 側で管理されるため、
// drizzle-kit がそれらを drop しないように entities.roles.provider を指定する。
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/placeholder',
  },
  entities: {
    roles: {
      provider: 'neon',
    },
  },
});
