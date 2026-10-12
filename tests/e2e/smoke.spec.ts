import { test, expect, type Page } from '@playwright/test';

const SHOTS = 'test-results/screenshots';

/**
 * Smoke test: does the storefront render without crashing, across the key
 * routes, at desktop and mobile. Not a functional/checkout test — it asserts
 * the page mounts, core content is visible, and no uncaught JS error fires.
 * Screenshots are captured for visual review (CI uploads them as an artifact).
 *
 * `pageerror` (uncaught exceptions) is a hard failure. `console.error` is
 * recorded as an attachment but not failed on — it includes external resource
 * noise (e.g. the font CDN) that isn't a storefront defect.
 */
function watchErrors(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  return { pageErrors, consoleErrors };
}

async function attachConsole(testInfo: { attach: Function }, errs: string[]) {
  if (errs.length) {
    await testInfo.attach('console-errors', { body: errs.join('\n'), contentType: 'text/plain' });
  }
}

test('home renders', async ({ page }, testInfo) => {
  const { pageErrors, consoleErrors } = watchErrors(page);
  const resp = await page.goto('/');
  expect(resp?.ok(), 'GET / should respond 2xx').toBeTruthy();
  await expect(page).toHaveTitle(/.+/);
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('h1.text-display')).toBeVisible();
  await expect(page.locator('header nav')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/home-${testInfo.project.name}.png`, fullPage: true });
  await attachConsole(testInfo, consoleErrors);
  expect(pageErrors, `uncaught errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('product page renders with a buy control', async ({ page }, testInfo) => {
  const { pageErrors, consoleErrors } = watchErrors(page);
  const resp = await page.goto('/products/monolith-01');
  expect(resp?.ok(), 'GET /products/monolith-01 should respond 2xx').toBeTruthy();
  await expect(page.locator('main h1')).toBeVisible();
  // BuyButton renders "Add to Cart — $…" (or a disabled sold-out/complete state).
  await expect(
    page.getByRole('button', { name: /add to cart|edition complete|sold out/i }).first(),
  ).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/product-${testInfo.project.name}.png`, fullPage: true });
  await attachConsole(testInfo, consoleErrors);
  expect(pageErrors, `uncaught errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('key routes all respond and mount', async ({ page }, testInfo) => {
  const routes = [
    '/about',
    '/contact',
    '/legal/terms',
    '/legal/privacy',
    '/legal/shipping',
    '/legal/refunds',
    '/checkout/success',
    '/checkout/cancel',
  ];
  const { pageErrors } = watchErrors(page);
  for (const route of routes) {
    const resp = await page.goto(route);
    expect(resp?.ok(), `GET ${route} should respond 2xx`).toBeTruthy();
    await expect(page.locator('main'), `${route} should mount <main>`).toBeVisible();
  }
  expect(pageErrors, `uncaught errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
