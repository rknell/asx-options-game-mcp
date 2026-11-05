import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, open } from 'node:fs/promises';
import path from 'node:path';

export const GAME = 'https://optionsgame.com.au/tradefloor/#!/';
export function assertGame(url) {
  const u = new URL(url);
  if (u.origin !== 'https://optionsgame.com.au' || !u.pathname.startsWith('/tradefloor/') || u.username || u.password)
    throw new Error('Only the optionsgame.com.au/tradefloor game is supported. Complete login manually.');
}
export function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export class Serial {
  tail = Promise.resolve();
  run(fn) {
    const next = this.tail.then(fn);
    this.tail = next.catch(() => {});
    return next;
  }
}

// An intent is fsynced BEFORE touching the UI. An interrupted attempt is never replayed.
// This is local retry protection, not server-side exactly-once order execution.
export class Journal {
  constructor(directory) { this.directory = directory; this.records = new Map(); }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    this.file = path.join(this.directory, 'actions.jsonl');
    let contents;
    try { contents = await readFile(this.file, 'utf8'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; contents = ''; }
    for (const line of contents.split('\n').filter(Boolean)) {
      // Fail closed on a damaged log; silently discarding it could duplicate a trade.
      const record = JSON.parse(line);
      this.records.set(record.requestId, record);
    }
  }
  async append(record) {
    const handle = await open(this.file, 'a', 0o600);
    try { await handle.writeFile(JSON.stringify(record) + '\n'); await handle.sync(); }
    finally { await handle.close(); }
    this.records.set(record.requestId, record);
  }
  async once(requestId, payload, fn) {
    const hash = fingerprint(payload);
    const existing = this.records.get(requestId);
    if (existing) {
      if (existing.hash !== hash) throw new Error('requestId already used with different arguments.');
      return { replayPrevented: true, ...existing };
    }
    await this.append({ requestId, hash, status: 'started', at: new Date().toISOString() });
    try {
      const result = await fn();
      const record = { requestId, hash, status: 'completed', at: new Date().toISOString(), result };
      await this.append(record);
      return record;
    } catch (error) {
      const record = { requestId, hash, status: 'uncertain', at: new Date().toISOString(),
        error: error.message, recovery: 'Read current game state and Orders. Do not resubmit under a new requestId until reconciled.' };
      await this.append(record);
      return record;
    }
  }
}
export const snapshotId = () => randomUUID();
