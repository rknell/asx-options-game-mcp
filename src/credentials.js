import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import path from 'node:path';

export function credentialKey(directory) {
  return createHash('sha256').update(path.resolve(directory)).digest('hex');
}
export function validateCredentials(value) {
  if (!value || typeof value.email !== 'string' || !/^\S+@\S+\.\S+$/.test(value.email) ||
      typeof value.password !== 'string' || !value.password.length)
    throw new Error('A valid game email and nonempty password are required. Run npm run credentials locally.');
  return { email: value.email, password: value.password };
}
export class CredentialStore {
  constructor(directory, entryFactory) { this.directory = directory; this.entryFactory = entryFactory; }
  async entry() {
    if (this.entryFactory) return this.entryFactory('asx-options-game-mcp', credentialKey(this.directory));
    // Some stdio clients omit desktop environment variables. Locate this user's
    // standard D-Bus socket, not another user's store or an in-memory fallback.
    if (process.platform === 'linux' && !process.env.DBUS_SESSION_BUS_ADDRESS) {
      const socket = path.join(process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`, 'bus');
      try { await access(socket); process.env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${socket}`; } catch {}
    }
    const { Entry } = await import('@napi-rs/keyring');
    return new Entry('asx-options-game-mcp', credentialKey(this.directory), { linux: { store: 'secret-service' } });
  }
  async save(value) {
    const credentials = validateCredentials(value);
    try { (await this.entry()).setPassword(JSON.stringify(credentials)); }
    catch { throw new Error('Cannot save to the OS credential store. Unlock your keychain; on Linux a running Secret Service is required. No plaintext fallback is used.'); }
  }
  async load() {
    try { return validateCredentials(JSON.parse((await this.entry()).getPassword())); }
    catch { throw new Error('Game credentials are missing or the OS credential store is locked/unavailable. Run npm run credentials locally and ensure the store is unlocked for this user.'); }
  }
}

export async function configureCredentials(directory) {
  if (!process.stdin.isTTY) throw new Error('Credential setup requires an interactive local terminal. Never pass a password in command arguments or chat.');
  const { input, password } = await import('@inquirer/prompts');
  const email = (await input({ message: 'Options Game email:' })).trim();
  const secret = await password({ message: 'Options Game password:', mask: '*' });
  await new CredentialStore(directory).save({ email, password: secret });
  console.log('Credentials saved in your OS credential store. The MCP will sign in automatically.');
}
