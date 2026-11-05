import { chromium } from 'playwright';
import { mkdir, chmod } from 'node:fs/promises';
import path from 'node:path';
import { GAME, assertGame, fingerprint, snapshotId } from './core.js';

export class GameBrowser {
  constructor(directory, { headless = false } = {}) {
    this.directory = directory;
    this.headless = headless;
    this.latest = null;
  }
  async start() {
    if (this.context) return;
    const profile = path.join(this.directory, 'browser');
    await mkdir(profile, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    this.context = await chromium.launchPersistentContext(profile, {
      headless: this.headless, viewport: { width: 1440, height: 1000 },
      acceptDownloads: false,
    });
    this.page = this.context.pages()[0] || await this.context.newPage();
    this.page.setDefaultTimeout(8000);
    this.page.setDefaultNavigationTimeout(45000);
    await this.page.goto(GAME, { waitUntil: 'domcontentloaded' });
  }
  async close() { await this.context?.close(); this.context = null; }
  async screenshot() {
    await this.start();
    assertGame(this.page.url());
    return this.page.screenshot({ type: 'png' });
  }
  async snapshot() {
    await this.start();
    assertGame(this.page.url());
    const id = snapshotId();
    const data = await this.page.evaluate(({ id }) => {
      const visible = el => {
        const style = getComputedStyle(el);
        return el.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const text = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      const describe = el => ({
        tag: el.tagName.toLowerCase(), type: el.getAttribute('type'), role: el.getAttribute('role'),
        label: el.getAttribute('aria-label') || [...(el.labels || [])].map(text).join(' ') || el.getAttribute('title') || '',
        text: text(el).slice(0, 300), placeholder: el.getAttribute('placeholder'),
        href: el.getAttribute('href'),
      });
      document.querySelectorAll('[data-asx-mcp-ref]').forEach(el => el.removeAttribute('data-asx-mcp-ref'));
      const elements = [...document.querySelectorAll('button,a[href],input,select,textarea,[role="button"],[role="option"],[ng-click],[data-ng-click],[onclick]')]
        .filter(visible).filter(el => !['password', 'hidden', 'file'].includes(el.getAttribute('type')));
      const controls = elements.slice(0, 500).map((el, index) => {
        const ref = `${id}-${index}`;
        el.setAttribute('data-asx-mcp-ref', ref);
        return { ref, ...describe(el), value: 'value' in el ? el.value : undefined,
          disabled: Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true',
          options: el.tagName === 'SELECT' ? [...el.options].map(o => ({ label: o.text, value: o.value, selected: o.selected })) : undefined };
      });
      const tables = [...document.querySelectorAll('table')].filter(visible).map(table =>
        [...table.rows].filter(visible).map(row => [...row.cells].map(text)));
      return { title: document.title, text: document.body.innerText.slice(0, 24000), controls, tables,
        controlsTruncated: elements.length > 500 };
    }, { id });
    this.latest = { snapshotId: id, capturedAt: new Date().toISOString(), url: this.page.url(), ...data };
    return this.latest;
  }
  async navigate(view) {
    await this.start();
    assertGame(this.page.url());
    const known = { home: '#!/', strategy: '#!/strategy', orders: '#!/orders' };
    let hash = known[view];
    if (!hash) {
      const prefix = view === 'portfolio' ? '#!/portfolio/' : '#!/performance/';
      const links = await this.page.locator('a[href]').evaluateAll(els => els.map(e => e.getAttribute('href')));
      hash = links.find(h => h.startsWith(prefix));
      if (!hash) throw new Error('Account-specific navigation unavailable. Log in first.');
    }
    this.latest = null;
    await this.page.goto(`https://optionsgame.com.au/tradefloor/${hash}`, { waitUntil: 'domcontentloaded' });
    return this.snapshot();
  }
  async act({ snapshotId: id, actions }) {
    await this.start();
    assertGame(this.page.url());
    if (!(await this.page.locator('a[href^="#!/portfolio/"]').count()))
      throw new Error('Authenticated game navigation unavailable. Complete login manually.');
    if (actions.some((a, i) => a.kind === 'click' && i !== actions.length - 1))
      throw new Error('A click must be the final action in a batch. Inspect the resulting state before another click.');
    const previous = this.latest;
    if (!previous || previous.snapshotId !== id || previous.url !== this.page.url() || Date.now() - Date.parse(previous.capturedAt) > 120000)
      throw new Error('Stale snapshot. Call game_snapshot again.');
    // Invalidate before the first change, including failures; each batch consumes its snapshot.
    this.latest = null;
    let completed = 0;
    for (const action of actions) {
      assertGame(this.page.url());
      const control = previous.controls.find(c => c.ref === action.ref);
      if (!control || control.disabled) throw new Error('Unknown or disabled control; take a fresh snapshot.');
      const locator = this.page.locator(`[data-asx-mcp-ref="${control.ref}"]`);
      const current = await locator.evaluate(el => ({
        tag: el.tagName.toLowerCase(), type: el.getAttribute('type'), role: el.getAttribute('role'),
        label: el.getAttribute('aria-label') || [...(el.labels || [])].map(e => (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim()).join(' ') || el.getAttribute('title') || '',
        text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300),
        placeholder: el.getAttribute('placeholder'), href: el.getAttribute('href'),
      }));
      const expected = Object.fromEntries(Object.keys(current).map(k => [k, control[k]]));
      if (fingerprint(current) !== fingerprint(expected)) throw new Error('Control changed since snapshot. Inspect again.');
      if (control.href) {
        const target = new URL(control.href, this.page.url());
        assertGame(target.href);
        if (target.protocol !== 'https:') throw new Error('Unsupported link.');
      }
      if (action.kind === 'click') {
        // Catch manual edits (or dynamic form replacements) before a potentially final click.
        const actualFields = await this.page.locator('[data-asx-mcp-ref]').evaluateAll(els =>
          els.filter(el => ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName))
            .map(el => ({ ref: el.getAttribute('data-asx-mcp-ref'), value: el.value })));
        const expectedFields = previous.controls.filter(c => ['input', 'select', 'textarea'].includes(c.tag))
          .map(c => ({ ref: c.ref, value: c.value }));
        if (fingerprint(actualFields) !== fingerprint(expectedFields)) throw new Error('Form values changed. Inspect a fresh snapshot before clicking.');
      }
      if (action.kind === 'fill') await locator.fill(action.value);
      else if (action.kind === 'select') await locator.selectOption(action.value);
      else if (action.kind === 'check') await locator.setChecked(action.checked);
      else await locator.click();
      if (action.kind === 'fill' || action.kind === 'select') control.value = action.value;
      completed++;
    }
    return { actionsCompleted: completed, orderExecutionVerified: false,
      note: 'UI actions completed; this does NOT prove an order was accepted or filled. Reconcile with Orders and Portfolio.',
      snapshot: await this.snapshot() };
  }
}
