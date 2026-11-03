import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { obsidian: fileURLToPath(new URL('./tests/support/obsidian.ts', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts'],
    // Verify UI behavior in Obsidian; do not launch the separate browser fixture.
    exclude: ['tests/toolbar.test.ts'],
  },
});
