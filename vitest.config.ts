import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
import { defineConfig } from "vitest/config";

// Configuration for Cloudflare Workers tests
const workersConfig = defineWorkersConfig({
  test: {
    include: ["src/**/*.cf.test.ts", "src/**/*.test.ts"],
    exclude: ["src/**/*.node.test.ts"],
    poolOptions: {
      workers: {
        singleWorker: true,
        miniflare: {
          compatibilityDate: "2025-03-02",
          kvNamespaces: ["TEST_KV"],
          r2Buckets: ["TEST_BUCKET"],
        },
      },
    },
  },
});

// Configuration for Node.js tests
const nodeConfig = defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.node.test.ts"],
    exclude: ["src/**/*.cf.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "dist/",
        "src/examples/",
        "**/*.cf.test.ts",
        "**/*.node.test.ts",
      ],
    },
  },
});

export default defineConfig({
  test: {
    projects: [nodeConfig, workersConfig],
  },
});
