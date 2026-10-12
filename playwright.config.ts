import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';

/**
 * Resolve a preinstalled Chromium if one exists (this repo's cloud dev
 * container ships one under /opt/pw-browsers and blocks downloads). On a
 * stock CI runner the path is absent → return undefined so Playwright uses
 * its own managed browser (the e2e workflow runs `playwright install`).
 */
function localChrome(): string | undefined {
  const base = '/opt/pw-browsers';
  try {
    const dir = fs
      .readdirSync(base)
      .find((d) => d.startsWith('chromium-') && !d.includes('headless'));
    if (dir) {
      const bin = `${base}/${dir}/chrome-linux/chrome`;
      if (fs.existsSync(bin)) return bin;
    }
  } catch {
    /* not in the container */
  }
  return undefined;
}

const executablePath = localChrome();
const PORT = 4173;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        launchOptions: executablePath ? { executablePath } : undefined,
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 5'], // chromium-based mobile preset
        launchOptions: executablePath ? { executablePath } : undefined,
      },
    },
  ],
  webServer: {
    command: `pnpm build && pnpm exec vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
