import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('real stdio MCP handshake, tool schemas and journal lookup', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'asx-mcp-'));
  const client = new Client({ name: 'test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../src/cli.js', import.meta.url)), 'serve', '--data-dir', dir] });
  t.after(async () => { await client.close(); await rm(dir, { recursive: true, force: true }); });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(t => t.name).sort(), ['game_act','game_action_status','game_navigate','game_screenshot','game_snapshot']);
  const result = await client.callTool({ name: 'game_action_status', arguments: { requestId: 'never-used' } });
  assert.equal(JSON.parse(result.content[0].text).status, 'unknown');
  const invalid = await client.callTool({ name: 'game_act', arguments: { requestId: 'a' } });
  assert.equal(invalid.isError, true);
});
