import { defineConfig } from "drizzle-kit";
import { loadEnv } from "./src/env";

loadEnv();

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/garden_bookings",
  },
  verbose: true,
  strict: true,
});
