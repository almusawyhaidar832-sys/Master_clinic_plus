import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // "server-only" يرمي خطأً عند استيراده مباشرة خارج تجميع Next.js —
      // نستبدله بوحدة خالية في بيئة الاختبار (نفس ما يسويه Next داخلياً).
      "server-only": path.resolve(__dirname, "./test/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
