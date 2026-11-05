# ASX Options Game MCP

A local MCP server that lets an LLM inspect and operate the **[ASX / TradeFloor virtual Options Trading Game](https://optionsgame.com.au/)** through its browser interface. Each person signs in with their own account. No shared credentials, API keys, hosted backend, or model subscription is bundled.

**Status: experimental browser adapter (v0.1).** Credential-backed unattended login was verified against the actual game. Portfolio, strategy and order screens were inspected. The adapter and MCP protocol are also tested against isolated browser fixtures. Live order submission and cancellation have **not** been verified. This is a foundation for strategy experiments, not yet a validated unattended trading system. It is not affiliated with ASX, TradeFloor or Openmarkets.

## Install

Install Node.js **22.13+ (22.x) or 24+** and Git, then run:

```sh
git clone https://github.com/rknell/asx-options-game-mcp.git
cd asx-options-game-mcp
npm ci
npm run setup
```

Setup installs Chromium and prompts locally for **your own** game email and password. The password input is masked. Credentials are stored in the operating system's credential store, not in a config file or this repository. **Credential setup is required**, even if an old browser session exists.

The MCP runs unattended: it reuses a session when possible and signs in automatically when redirected to the game's login page. No normal-run password prompt or manual browser login is needed. Update a changed password with `npm run credentials`. `npm run login` is a diagnostic that opens a browser and verifies automatic sign-in; it is not a prerequisite for each run.

macOS uses Keychain, Windows uses Credential Manager, and Linux requires an unlocked Secret Service such as GNOME Keyring or KWallet. The store must be accessible to the same OS user running the MCP. No plaintext or nonpersistent Linux keyutils fallback is used. Running without a person present is supported while the OS store is unlocked; a locked keychain, CAPTCHA, MFA, account challenge or invalid password produces an error and stops automatic retries. First-time OS keychain access may require authorization during setup.

On Linux, if Chromium reports missing system libraries, use `npx playwright install --with-deps chromium` on a supported distribution. macOS and Windows use the same npm commands. A local terminal and accessible OS credential store are needed for setup; the MCP server runs Chromium headlessly by default. Set `ASX_GAME_HEADLESS=false` in the server environment to watch it on a desktop (on Linux, the client must also pass the desktop display environment).

## Connect an LLM client

Run `npm run config` to print a JSON MCP configuration with the correct absolute executable, script and profile paths for your machine. Add the `asx-options-game` entry to your client's MCP configuration. The server uses **stdio**; it is not a web URL.

For Codex CLI, from the cloned folder on macOS/Linux:

```sh
codex mcp add asx-options-game -- node "$PWD/src/cli.js" serve
```

On PowerShell:

```powershell
codex mcp add asx-options-game -- node "$((Get-Location).Path)/src/cli.js" serve
```

Alternatively, in a client with MCP settings, select a local/stdio server and copy `command` and `args` from `npm run config`. Restart/reconnect the client after adding it. See the [official Codex MCP configuration documentation](https://developers.openai.com/codex/mcp).

Try: **“Use asx-options-game to read my portfolio and current orders. Do not place a trade.”** The first browser tool loads the game and authenticates automatically in the background. If the game is still loading, take another snapshot before acting.

## Tools

| Tool | Purpose |
| --- | --- |
| `game_snapshot` | Visible page text, structured tables, controls, values and short-lived references |
| `game_navigate` | Portfolio, performance, strategy builder, orders or home |
| `game_act` | Batch fill/select/check operations and one final click; can place/cancel virtual orders |
| `game_action_status` | Durable result for an action request ID, even after restart |
| `game_screenshot` | PNG for interpreting icons and visually reviewing tickets |

The tool interface supports options and equity workflows through observed controls rather than guessed private endpoints. It does **not** yet provide a high-level `place_option_order` API, parsed option-chain model, automatic risk sizing, or an LLM strategy runner. The game UI remains the source of truth.

## Agent workflow

1. Read portfolio and open orders. Record the baseline, strategy name, model and timestamp in your own experiment log.
2. Read Strategy Builder, including contract code, expiry, strike, call/put, quantity, **SPC** (shares per contract), premium and margin. Never assume every contract multiplier is 100.
3. Choose controls only from the latest snapshot. Batch independent field edits; put a click last. New dialogs and autocomplete options require a new snapshot.
4. Inspect the review ticket and follow the user's trading mandate and the client’s approval rules before submitting. All game actions can change the user's virtual portfolio.
5. Reconcile order ID, side, quantity, price and status on Orders, then reconcile positions/cash. A successful click is not evidence of a fill.

Every `game_act` needs a unique `requestId` (for example `experiment01-order01-review`) and the latest `snapshotId`. Keep the **same** request ID and arguments if the tool response is lost. The journal suppresses re-execution of that request across restarts. If the status is `started` or `uncertain`, inspect Orders before deciding what to do. **Never generate a new ID merely to bypass an uncertain result.** There is no server-side idempotency guarantee.

Snapshots expire after two minutes and are consumed by an action batch. Changed controls or form values cause a stop. Batches are sequential, not atomic: earlier edits may already have happened when a later operation fails. Live quotes can move while you are reviewing a ticket.

## Personal data and multiple users

Game credentials are stored under the `asx-options-game-mcp` service in the OS credential store, keyed by a hash of the profile directory. Chromium's profile and `actions.jsonl` live in `~/.asx-options-game`, **outside the checkout**. Browser profiles contain session credentials; logs contain game snapshots and account information. Keep this directory private. Share the Git repo, never the profile or logs. Do not attach unredacted snapshots to public issues.

An alternate profile can be selected with `--data-dir /absolute/path` (pass it to both credentials/setup and serve), or `ASX_GAME_DATA_DIR`. Separate OS users naturally get separate profiles. Only one browser/server should use a profile at a time. The tools reject non-game origins and paths. This is a UI boundary, not a network firewall; the site still loads its normal third-party resources.

There is no telemetry or external LLM call in this package. Your MCP client receives the requested game data and may send it to its configured model provider. Passwords are retrieved directly by the authentication code, submitted only on the exact HTTPS game sign-in page, and never returned by MCP tools. Authentication errors suppress underlying fill details. The server does not store your password in configuration or connect to a real broker. Review the game's current terms before running automated experiments, especially competitions.

## Development

```sh
npm ci
npx playwright install chromium
npm run check
npm test
```

Tests cover automatic sign-in, reauthentication after session expiry, failed-login retry suppression, credential-store isolation, origin restrictions, stale snapshots, changed ticket values, local duplicate suppression, interrupted attempts, structured extraction and a real MCP stdio handshake. Browser tests intercept all requests and never contact the live game. CI runs the same checks on Linux.

Architecture: `src/browser.js` is the reusable browser adapter; `src/server.js` exposes MCP tools; `src/core.js` owns serialization and the durable journal; `src/credentials.js` owns OS credential storage; `src/auth.js` owns sign-in; `src/cli.js` provides setup/credentials/login/config/serve. Future work should add verified, typed order workflows and strategy accounting on top of this adapter.

## Discovery notes

No matching installed/catalog plugin or public game-specific MCP was found during initial research (5 November 2026). The inspected game page advertised no WebMCP tools. A project called [tradefloor](https://github.com/simoncoombes/tradefloor) has its own MCP, but it is a different market simulator and does not connect to this game. No documented public trading API for this game's user accounts was established. This project therefore uses the visible browser workflow.

MIT licensed. Issues and contributions welcome; use synthetic account data in fixtures.
