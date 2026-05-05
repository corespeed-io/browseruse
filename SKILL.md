---
name: browseruse
description: Launch, connect, and control Chrome browsers via CDP. Manages persistent browser profiles so login state survives across sessions. Run JS snippets through the `browseruse` CLI — it auto-spawns a Bun HTTP server holding a fully-typed CDP Session, and can launch/manage Chrome instances with remote debugging.
---

# browseruse

Full CDP SDK (56 domains, 652 typed methods) plus browser lifecycle management. Unlike raw CDP tools, `browseruse` can **launch** Chrome with persistent profiles — login state, cookies, and extensions survive across restarts.

## Quick start

```bash
browseruse launch                    # Launch Chrome with default profile
browseruse connect                   # Connect to launched browser (or auto-launch)
browseruse 'const t = await listPageTargets(); await session.use(t[0].targetId)'
browseruse 'await session.Page.navigate({url:"https://example.com"})'
browseruse screenshot --output /tmp/page.png
```

## CLI commands

| Command | Behavior |
|---|---|
| `browseruse '<js>'` | Auto-start REPL, eval JS, print result. |
| `browseruse eval '<js>'` | Same as above, explicit subcommand. |
| `browseruse launch [opts]` | Launch managed Chrome with persistent profile. |
| `browseruse browsers` | List detected browsers (JSON). |
| `browseruse tabs` | List page targets (JSON, requires connection). |
| `browseruse connect [opts]` | Connect session (auto-launches if no browser found). |
| `browseruse screenshot [--output f]` | Capture screenshot to file. |
| `browseruse --status` | Health JSON or exit 1 if REPL down. |
| `browseruse --start` | Start REPL server explicitly. |
| `browseruse --stop` | Stop REPL + managed browser. |
| `browseruse --restart` | Restart REPL fresh. |
| `browseruse --logs` | Tail server log. |

### Launch options

```bash
browseruse launch --profile work     # Named profile (~/.browseruse/profiles/work/)
browseruse launch --headless         # Headless mode
browseruse launch --port 9222        # Specific debugging port
```

### Connect options

```bash
browseruse connect                         # Auto-detect or auto-launch
browseruse connect --no-auto-launch        # Only connect to existing browsers
browseruse connect --profile-dir <path>    # Specific browser profile dir
browseruse connect --ws-url ws://...       # Direct WebSocket URL
browseruse connect --timeout 30000         # Wait for user to click Allow
```

## Profiles

Profiles live at `~/.browseruse/profiles/<name>/`. The default profile is `default`.

- Each profile is a full Chrome user-data-dir
- Cookies, localStorage, extensions, bookmarks persist
- Multiple named profiles for different contexts (personal, work, etc.)
- Launch with `--profile <name>` to use a specific profile

## API surface inside eval snippets

Pre-loaded globals (no imports needed):

- `session` — persistent `Session` with all 56 CDP domains: `session.Page`, `session.DOM`, `session.Runtime`, `session.Network`, …
- `listPageTargets()` — list page targets (filtered, no chrome:// internals)
- `detectBrowsers()` — scan for running Chromium browsers
- `launchBrowser(opts?)` — launch a new managed browser
- `getManagedBrowser()` — check managed browser status
- `closeManagedBrowser()` — stop managed browser
- `resolveWsUrl(opts)` — resolve WebSocket URL from options
- `CDP` — generated namespaces for type reference

### Connecting and targeting

```bash
# Auto-connect (launches browser if needed)
browseruse 'await session.connect()'

# Pick a tab
browseruse 'const t = await listPageTargets(); await session.use(t[0].targetId)'

# Navigate
browseruse 'await session.Page.navigate({url:"https://example.com"})'
```

### Common CDP patterns

**Open a URL in a NEW tab** (use `Target.createTarget`, not `Page.navigate`):

```js
// CORRECT — opens new tab
const {targetId} = await session.Target.createTarget({url: 'https://example.com'})
await session.use(targetId)  // switch to the new tab

// WRONG — replaces current tab content
await session.Page.navigate({url: 'https://example.com'})
```

**Navigate the current tab** (replaces current page):

```js
await session.Page.navigate({url: 'https://example.com'})
```

**Close a tab:**

```js
await session.Target.closeTarget({targetId: 'TARGET_ID'})
```

**Switch between tabs:**

```js
const tabs = await listPageTargets()
await session.use(tabs[0].targetId)  // switch to first tab
```

### CDP method calls

Every method takes one object argument matching CDP wire params, returns the typed result:

```js
await session.Page.navigate({ url: 'https://example.com' })
await session.Page.captureScreenshot({ format: 'png' })
const { root } = await session.DOM.getDocument()
const { nodeId } = await session.DOM.querySelector({ nodeId: root.nodeId, selector: 'h1' })
await session.Runtime.evaluate({ expression: 'document.title', returnByValue: true })
```

### Events

```js
const off = session.onEvent((method, params, sessionId) => { ... })
await session.Network.enable()
const ev = await session.waitFor('Page.frameNavigated', p => p.frame.url.includes('example.com'), 10000)
```

### Multi-line (stdin/heredoc)

Multi-statement snippets require explicit `return`:

```bash
browseruse <<'EOF'
const tabs = await listPageTargets();
await session.use(tabs[0].targetId);
await session.Page.navigate({url:"https://example.com"});
return (await session.Runtime.evaluate({expression:"document.title",returnByValue:true})).result.value;
EOF
```

## Output format

| Result type | stdout |
|---|---|
| string | bare text (no JSON quotes) |
| number / boolean | `42`, `true` |
| object / array (non-empty) | compact JSON |
| undefined / null / `""` / `{}` / `[]` | empty (no output) |

Errors go to stderr, exit code 1.

## Env vars

- `BROWSERUSE_PORT` — REPL port (default: 9876)
- `BROWSERUSE_LOG` — log file (default: /tmp/browseruse.log)
