import "dotenv/config";

import path from "node:path";

import { defineConfig } from "prisma/config";

/**
 * Prisma 7 CLI configuration.
 *
 * The connection URL is no longer read from `schema.prisma`; the CLI takes it
 * from here for migrations and introspection, while the runtime client builds a
 * driver adapter in `src/lib/db/client.ts`.
 */
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
