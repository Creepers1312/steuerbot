import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // „server-only“ wirft außerhalb von React-Server-Komponenten – in Tests neutralisieren
      "server-only": path.resolve(import.meta.dirname, "test/leer.ts"),
    },
  },
  test: { include: ["src/**/*.test.ts"] },
});
