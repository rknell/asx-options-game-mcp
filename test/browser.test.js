import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { GameBrowser } from '../src/browser.js';
import { GAME } from '../src/core.js';

// All traffic is intercepted. No test contacts or trades against the real game.
test('browser adapter edits, snapshots, rejects stale forms and reads orders', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'asx-browser-'));
  const context = await chromium.launchPersistentContext(dir, { headless: true });
  t.after(async () => { await context.close(); await rm(dir, { recursive: true, force: true }); });
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `
    <script>function title(){document.title=location.hash.includes('portfolio')?'Portfolio':location.hash.includes('orders')?'Orders':'Fixture';} title();addEventListener('hashchange',title);</script>
    <h1>Fixture game</h1><a href="#!/portfolio/123">Portfolio</a><a href="#!/orders">Orders</a>
    <input type="password" value="secret"><input type="hidden" value="hidden">
    <label>Code<input placeholder="Code" value="TEST"></label>
    <label>Quantity<input type="number" value="1"></label>
    <select><option value="limit">Limit</option><option value="market">Market</option></select>
    <button onclick="document.querySelector('tbody').innerHTML='<tr><td>fixture-order-1</td><td>Accepted</td></tr>'">Submit simulated order</button>
    <table><tbody><tr><td>Cash</td><td>50000</td></tr></tbody></table>` }));
  const page = context.pages()[0]; await page.goto(GAME);
  const browser = new GameBrowser(dir); browser.context = context; browser.page = page;
  const first = await browser.snapshot();
  assert.equal(first.tables[0][0][1], '50000');
  assert.ok(!JSON.stringify(first).includes('secret'));
  const qty = first.controls.find(c => c.label === 'Quantity');
  const submit = first.controls.find(c => c.text === 'Submit simulated order');
  const result = await browser.act({ snapshotId: first.snapshotId, actions: [
    { kind: 'fill', ref: qty.ref, value: '2' }, { kind: 'click', ref: submit.ref },
  ] });
  assert.equal(result.snapshot.tables[0][0][0], 'fixture-order-1');
  assert.equal(result.orderExecutionVerified, false);
  await assert.rejects(() => browser.act({ snapshotId: first.snapshotId, actions: [] }), /Stale/);
  let fresh = await browser.snapshot();
  await page.getByLabel('Quantity').fill('99');
  await assert.rejects(() => browser.act({ snapshotId: fresh.snapshotId, actions: [
    { kind: 'click', ref: fresh.controls.find(c => c.text === 'Submit simulated order').ref },
  ] }), /Form values changed/);
  fresh = await browser.snapshot();
  await page.getByRole('button').evaluate(el => el.textContent = 'Different action');
  await assert.rejects(() => browser.act({ snapshotId: fresh.snapshotId, actions: [
    { kind: 'click', ref: fresh.controls.find(c => c.text === 'Submit simulated order').ref },
  ] }), /Control changed/);
  assert.ok((await browser.navigate('portfolio')).url.endsWith('#!/portfolio/123'));
  await page.goto('https://unrelated.example/');
  await assert.rejects(() => browser.snapshot(), /Only the/);
});
