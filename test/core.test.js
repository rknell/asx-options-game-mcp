import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Journal, Serial, assertGame, GAME } from '../src/core.js';

test('only the exact virtual game origin and path are allowed', () => {
  assertGame(GAME);
  for (const url of ['https://optionsgame.com.au.evil.test/tradefloor/', 'http://optionsgame.com.au/tradefloor/',
    'https://broker.example/tradefloor/', 'https://optionsgame.com.au/account', 'https://user:pass@optionsgame.com.au/tradefloor/'])
    assert.throws(() => assertGame(url));
});
test('actions serialize even after a failure', async () => {
  const queue = new Serial(); const order = [];
  await Promise.allSettled([
    queue.run(async () => { order.push(1); await new Promise(r => setTimeout(r, 5)); throw Error('x'); }),
    queue.run(async () => { order.push(2); }),
  ]);
  assert.deepEqual(order, [1, 2]);
});
test('durable journal suppresses successful, failed, and interrupted retries', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'asx-journal-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let journal = new Journal(dir); await journal.init(); let calls = 0;
  const fn = async () => ({ calls: ++calls });
  assert.equal((await journal.once('request-1', { x: 1 }, fn)).status, 'completed');
  journal = new Journal(dir); await journal.init();
  assert.equal((await journal.once('request-1', { x: 1 }, fn)).replayPrevented, true);
  assert.equal(calls, 1);
  await assert.rejects(() => journal.once('request-1', { x: 2 }, fn), /different arguments/);
  const failed = await journal.once('request-2', {}, async () => { calls++; throw Error('timeout'); });
  assert.equal(failed.status, 'uncertain');
  assert.equal((await journal.once('request-2', {}, fn)).replayPrevented, true);
  const started = { ...journal.records.get('request-2'), requestId: 'request-3', status: 'started' };
  await journal.append(started);
  journal = new Journal(dir); await journal.init();
  assert.equal((await journal.once('request-3', {}, fn)).status, 'started');
  assert.equal(calls, 2);
  await appendFile(journal.file, '{broken');
  await assert.rejects(() => new Journal(dir).init());
});
