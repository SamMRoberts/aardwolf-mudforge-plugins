import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// Keep evidence outside the checkout, including for failed runs.
const output = process.env.SMOKE_OUTPUT_DIR ? resolve(process.env.SMOKE_OUTPUT_DIR)
  : mkdtempSync(join(tmpdir(), 'aardwolf-browser-smoke-'));
const checkout = dirname(fileURLToPath(import.meta.url));
if (output === checkout || output.startsWith(checkout + '/')) throw new Error('SMOKE_OUTPUT_DIR must be outside the checkout');
process.env.SMOKE_OUTPUT_DIR = output;
console.log(`Synthetic browser evidence: ${output}`);
export default defineConfig({
  testDir: './tests/browser',
  testMatch: '*.spec.mjs',
  timeout: 30_000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: join(output, 'artifacts'),
  reporter: [['list'], ['json', { outputFile: join(output, 'results.json') }]],
  use: {
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [
    { name: 'narrow', use: { viewport: { width: 320, height: 480 } } },
    { name: 'wide', use: { viewport: { width: 1280, height: 720 } } },
  ],
});
