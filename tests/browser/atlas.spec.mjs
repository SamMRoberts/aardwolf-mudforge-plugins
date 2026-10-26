import { test, expect } from './harness.mjs';
import { installAtlasBridge, retainAtlasDrawingBuffer } from './atlas-bridge.mjs';

test('Atlas renders built tiles, handles keyboard input, and retains search across updates', async ({ page, openWidget }, testInfo) => {
  await installAtlasBridge(page);
  await retainAtlasDrawingBuffer(page);
  await openWidget('atlas');
  await expect(page).toHaveTitle('Aardwolf Atlas');
  await expect(page.locator('#room-count')).toHaveText('2 visible / 2 rooms');
  await expect(page.locator('#failure')).toBeHidden();
  await expect.poll(() => page.locator('#map').evaluate(canvas => {
    const gl = canvas.getContext('webgl2');
    if (!gl || !canvas.width || !canvas.height) return false;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    // A clear-only canvas is uniform. Rooms and connecting lines produce
    // multiple colors through the production bundled Three.js renderer.
    for (let i = 4; i < pixels.length; i += 4) {
      if (pixels[i] !== pixels[0] || pixels[i + 1] !== pixels[1] || pixels[i + 2] !== pixels[2]) return true;
    }
    return false;
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('atlas-rendered.png') });

  await page.locator('#map').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('+');
  await expect(page.locator('#follow')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#perspective').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#perspective')).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('searchbox', { name: 'Find a room' }).fill('Smoke destination');
  await page.keyboard.press('Tab');
  await expect(page.locator('#results button').first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#room-name')).toHaveText('Smoke destination');
  await expect(page.locator('#route-summary')).toHaveText('1 steps · weighted cost 1');
  const search = page.getByRole('searchbox', { name: 'Find a room' });
  await search.fill('unfinished search draft');
  await page.evaluate(() => window.atlasSmokeUpdate());
  await expect(page.locator('#status')).toContainText('Player #2');
  await expect(search).toHaveValue('unfinished search draft');
  await expect(search).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#results')).toBeHidden();

  await page.getByRole('combobox', { name: 'Browse area' }).selectOption('archive');
  await expect(page.locator('#room-count')).toHaveText('1 visible / 1 rooms');
  await expect(page.locator('#area-title')).toHaveText('Smoke archive');
  await page.screenshot({ path: testInfo.outputPath('atlas-updated.png') });
});

test('Atlas reports unavailable WebGL and sends the native mapper fallback action', async ({ page, openWidget, allowConsoleError }, testInfo) => {
  await installAtlasBridge(page);
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attributes) {
      return /^(webgl2?|experimental-webgl)$/.test(type) ? null : getContext.call(this, type, attributes);
    };
  });
  allowConsoleError(/^THREE\.WebGLRenderer: THREE\.WebGLRenderer: Error creating WebGL context\.$/);
  await openWidget('atlas');
  await expect(page.locator('#failure')).toBeVisible();
  await expect(page.locator('#failure-detail')).toContainText('WebGL could not initialize');
  await page.locator('#fallback').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.smoke.messages.some(message => message.data.action === 'fallback'))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('atlas-webgl-unavailable.png') });
});

test('Atlas reports an actual graphics context loss and keeps fallback operable', async ({ page, openWidget }, testInfo) => {
  await installAtlasBridge(page);
  await openWidget('atlas');
  await expect(page.locator('#room-count')).toHaveText('2 visible / 2 rooms');
  await expect(page.locator('#failure')).toBeHidden();
  const extensionAvailable = await page.locator('#map').evaluate(canvas => {
    const extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    extension.loseContext();
    return true;
  });
  expect(extensionAvailable, 'Chromium must expose WEBGL_lose_context for this smoke check').toBe(true);
  await expect(page.locator('#failure')).toBeVisible();
  await expect(page.locator('#failure-detail')).toContainText('graphics context was lost');
  await page.locator('#fallback').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.smoke.messages.some(message => message.data.action === 'fallback'))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('atlas-context-lost.png') });
});
