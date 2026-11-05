#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { GameBrowser } from './browser.js';
import { serve } from './server.js';

const args = process.argv.slice(2);
const command = args[0] || 'serve';
const index = args.indexOf('--data-dir');
if (index >= 0 && !args[index + 1]) throw new Error('--data-dir requires a path');
const directory = path.resolve(index >= 0 ? args[index + 1] : process.env.ASX_GAME_DATA_DIR || path.join(os.homedir(), '.asx-options-game'));
if (command === 'setup') {
  const cli = fileURLToPath(new URL('../node_modules/playwright/cli.js', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} else if (command === 'login') {
  const browser = new GameBrowser(directory);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await browser.start();
    console.log(`Log into your own game account in the browser. Session data stays in ${directory}.`);
    await rl.question('Once you can see your portfolio, press Enter here to save and close: ');
  } finally { rl.close(); await browser.close(); }
} else if (command === 'config') {
  console.log(JSON.stringify({ mcpServers: { 'asx-options-game': {
    command: process.execPath, args: [fileURLToPath(import.meta.url), 'serve', '--data-dir', directory],
  } } }, null, 2));
} else if (command === 'serve') {
  await serve(directory);
} else {
  console.log('asx-options-game-mcp <setup|login|config|serve> [--data-dir PATH]');
  if (!['help', '--help', '-h'].includes(command)) process.exitCode = 1;
}
