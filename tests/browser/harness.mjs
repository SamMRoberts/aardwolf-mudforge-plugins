import { test as base, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { platform, release, arch } from 'node:os';
import { root } from '../../tools/build-repository.mjs';
import { builtDocuments, sha256 } from './documents.mjs';
import { installBridge } from './bridge.mjs';

const artifactPaths = ['dist/libs/aardwolf-api.lua', ...['api-core', 'vitals', 'spells', 'room-details', 'inventory', 'atlas']
  .map(name => `dist/plugins/aardwolf-${name}.lua`)];
function artifactSnapshot() {
  return Object.fromEntries(artifactPaths.map(path => {
    const bytes = readFileSync(`${root}/${path}`);
    return [path, { sha256: sha256(bytes), version: bytes.toString().match(/version\s*=\s*"([^"]+)"/)[1] }];
  }));
}
function sourceSnapshot() {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const inputs = git(['ls-files', '--others', '--exclude-standard']).trim().split('\n').filter(Boolean);
  return {
    sourceRevision: git(['rev-parse', 'HEAD']).trim(),
    patchSha256: sha256(git(['diff', '--binary', 'HEAD'])),
    untrackedInputs: Object.fromEntries(inputs.map(path => [path, sha256(readFileSync(`${root}/${path}`))])),
  };
}

export { expect };
export const test = base.extend({
  built: [async ({}, use) => {
    const source = sourceSnapshot(), artifacts = artifactSnapshot(), documents = builtDocuments();
    expect(artifactSnapshot(), 'distribution changed during document capture').toEqual(artifacts);
    await use({ documents, source, artifacts });
  }, { scope: 'worker' }],
  documents: [async ({ built }, use) => { await use(built.documents); }, { scope: 'worker' }],
  origin: [async ({ documents }, use) => {
    const server = createServer((request, response) => {
      const name = request.url.slice(1);
      if (name === 'favicon.ico') { response.writeHead(204); response.end(); return; }
      const document = Object.hasOwn(documents, name) ? documents[name] : null;
      response.writeHead(document ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(document?.html || 'Unknown smoke document');
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try { await use(`http://127.0.0.1:${server.address().port}`); }
    finally { await new Promise(resolve => server.close(resolve)); }
  }, { scope: 'worker' }],
  loadedDocuments: async ({}, use) => { await use([]); },
  allowedConsoleErrors: async ({}, use) => { await use([]); },
  allowConsoleError: async ({ allowedConsoleErrors }, use) => { await use(pattern => allowedConsoleErrors.push(pattern)); },
  evidence: [async ({ page, browser, built, origin, loadedDocuments, allowedConsoleErrors }, use, testInfo) => {
    const logs = [], failures = [];
    page.on('console', message => {
      if (['warning', 'error'].includes(message.type())) logs.push({ type: message.type(), text: message.text() });
    });
    page.on('pageerror', error => { logs.push({ type: 'pageerror', text: error.message }); });
    page.on('requestfailed', request => { failures.push({ url: request.url(), error: request.failure()?.errorText }); });
    page.on('response', response => { if (response.status() >= 400) failures.push({ url: response.url(), status: response.status() }); });
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(origin + '/') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
      failures.push({ url, error: 'Unexpected external request' });
      return route.abort();
    });
    await page.addInitScript(installBridge);
    await use();
    // A crashed page can refuse screenshots/evaluation. Always preserve the
    // console and network evidence first, and report capture failure honestly.
    let title = null, messages = [];
    try { title = await page.title(); messages = await page.evaluate(() => window.smoke?.messages || []); }
    catch (error) { logs.push({ type: 'evidenceerror', text: error.message }); }
    try {
      const path = testInfo.outputPath('final.png');
      await page.screenshot({ path, timeout: 5000 });
      await testInfo.attach('screenshot', { path, contentType: 'image/png' });
    }
    catch (error) { logs.push({ type: 'evidenceerror', text: error.message }); }
    const evidence = {
      layer: 'synthetic-browser', native: 'not run', live: 'not run',
      observedAt: new Date().toISOString(), ...built.source,
      environment: { node: process.version, playwright: JSON.parse(readFileSync(`${root}/node_modules/@playwright/test/package.json`)).version,
        browser: browser.version(), os: platform(), release: release(), arch: arch(), viewport: page.viewportSize() },
      url: page.url(), title, loadedDocuments, artifacts: built.artifacts,
      capturedDocuments: Object.fromEntries(Object.entries(built.documents).map(([name, document]) => [name, sha256(document.html)])),
      console: logs, networkFailures: failures, messages,
    };
    const path = testInfo.outputPath('evidence.json');
    writeFileSync(path, JSON.stringify(evidence, null, 2) + '\n');
    await testInfo.attach('evidence', { path, contentType: 'application/json' });
    expect(logs.filter(log => ['pageerror', 'evidenceerror'].includes(log.type) || (log.type === 'error'
      && !allowedConsoleErrors.some(pattern => pattern.test(log.text)))), 'unexpected console/page/capture errors').toEqual([]);
    for (const pattern of allowedConsoleErrors) {
      expect(logs.some(log => log.type === 'error' && pattern.test(log.text)), `expected console error ${pattern}`).toBe(true);
    }
    expect(failures, 'network failures').toEqual([]);
  }, { auto: true }],
  openWidget: async ({ page, documents, origin, loadedDocuments }, use, testInfo) => {
    await use(async name => {
      const document = documents[name];
      expect(document, `built document ${name}`).toBeTruthy();
      loadedDocuments.push(name);
      await page.goto(`${origin}/${name}`);
      await expect(page.locator('body')).not.toBeEmpty();
      await page.evaluate(({ bindings, properties }) => {
        window.smoke.bindings(bindings);
        for (const [name, value] of Object.entries(properties)) window.smoke.property(name, value);
      }, document);
      await expect(page).toHaveURL(`${origin}/${name}`);
      const path = testInfo.outputPath(`${name}-loaded.png`);
      await page.screenshot({ path });
      await testInfo.attach(`${name}-loaded`, { path, contentType: 'image/png' });
      return page;
    });
  },
});

export async function property(page, name, value) {
  await page.evaluate(({ name, value }) => window.smoke.property(name, value), { name, value });
}
export async function noHorizontalOverflow(page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
