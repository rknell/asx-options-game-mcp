import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { CredentialStore, credentialKey } from '../src/credentials.js';
import { assertSignIn } from '../src/auth.js';
import { GameBrowser } from '../src/browser.js';

test('credential store uses distinct profile keys and never returns backend error details', async () => {
  let saved; const entry = { setPassword: x => { saved = x; }, getPassword: () => saved };
  const store = new CredentialStore('/synthetic/profile', () => entry);
  const credentials = { email: 'test@example.invalid', password: 'synthetic-password' };
  await store.save(credentials);
  assert.deepEqual(await store.load(), credentials);
  assert.notEqual(credentialKey('/profile/a'), credentialKey('/profile/b'));
  const broken = new CredentialStore('/synthetic/profile', () => { throw Error('sensitive-backend-detail'); });
  await assert.rejects(() => broken.load(), e => !e.message.includes('sensitive-backend-detail'));
  await assert.rejects(() => store.save({ email:'bad', password:'' }));
});

test('credential entry is restricted to the exact verified sign-in URL', () => {
  assertSignIn('https://optionsgame.com.au/#/signin');
  for (const url of ['http://optionsgame.com.au/#/signin', 'https://optionsgame.com.au.evil.test/#/signin',
    'https://optionsgame.com.au/other#/signin', 'https://optionsgame.com.au/#/reset'])
    assert.throws(() => assertSignIn(url));
});

test('saved credentials sign in unattended; expired sessions sign in again; failed login latches', async t => {
  const chromiumBrowser = await chromium.launch({ headless: true });
  t.after(() => chromiumBrowser.close());
  const context = await chromiumBrowser.newContext();
  let fail = false; let submits = 0;
  await context.exposeBinding('recordSubmit', () => { submits++; });
  await context.route('**/*', route => route.fulfill({ contentType:'text/html', body:
    route.request().url().includes('/tradefloor/')
      ? '<a href="#!/portfolio/123">Portfolio</a><p>Fixture authenticated</p>'
      : `<form id="login" onsubmit="event.preventDefault(); recordSubmit(); ${fail ? '' : "location.href='/tradefloor/#!/'"}">
          <input id="email" type="email"><input id="password" type="password"><button>LOGIN</button></form>` }));
  const page = await context.newPage();
  let loads = 0;
  const browser = new GameBrowser('/unused-fixture', { credentials: { load: async () => {
    loads++; return { email:'test@example.invalid', password:'synthetic-only' };
  } } });
  browser.context = context; browser.page = page;
  await page.goto('https://optionsgame.com.au/#/signin');
  await browser.waitForLogin();
  assert.equal(submits, 1); assert.equal(loads, 1);
  assert.match((await browser.snapshot()).text, /Fixture authenticated/);
  await page.goto('https://optionsgame.com.au/#/signin');
  await browser.waitForLogin();
  assert.equal(submits, 2);
  fail = true;
  await page.goto('https://optionsgame.com.au/#/signin');
  await assert.rejects(() => browser.waitForLogin(200), /Automatic login did not/);
  await assert.rejects(() => browser.waitForLogin(200), /Previous login failed/);
  assert.equal(submits, 3);
});
