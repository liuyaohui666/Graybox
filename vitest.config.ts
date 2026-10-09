import { defineConfig } from "vitest/config";
// Integration files reset the same dedicated graybox_test database.
export default defineConfig({ test: { fileParallelism: false } });
