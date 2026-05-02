# browseruse

Launch, connect, and control Chrome browsers via the DevTools Protocol. Manages persistent browser profiles so login state, cookies, and extensions survive across sessions.

Built on a codegen'd CDP SDK: **56 domains, 652 typed methods, zero wrapping**. The protocol is the API.

## Install

```bash
git clone https://github.com/corespeed-io/browseruse.git
cd browseruse && bun install
# Symlink CLI to PATH:
ln -sf "$(pwd)/src/cli.ts" /usr/local/bin/browseruse
```

## Usage

```bash
# Launch Chrome with a persistent profile
browseruse launch

# Connect (auto-launches if no browser found)
browseruse connect

# Control the browser
browseruse 'const t = await listPageTargets(); await session.use(t[0].targetId)'
browseruse 'await session.Page.navigate({url:"https://example.com"})'
browseruse screenshot --output /tmp/page.png

# Named profiles
browseruse launch --profile work
```

## How it works

```
┌────────��─────────────────────┐
│  Agent / User                │
└──────────────────────────────┘
              │ browseruse CLI
              ▼
┌────────��─────────────────────┐
│  REPL Server (Bun HTTP)      │
│  • Persistent CDP Session    │
│  • Browser lifecycle mgmt    ��
│  • Profile management        │
└──────────────────────────────┘
              │ WebSocket (CDP)
              ▼
┌──────────────────────────────┐
│  Chrome (managed instance)   │
│  --user-data-dir=~/.browseruse/profiles/default/
│  --remote-debugging-port     │
└─────────────��────────────────┘
```

The CLI auto-starts a persistent Bun HTTP server that holds a CDP Session. Each `browseruse '<code>'` call sends JS to the same server, reusing the WebSocket connection. The server can also launch and manage Chrome instances with persistent profiles.

## Files

```
src/
  cli.ts              CLI entry point (TypeScript, replaces bash)
  repl.ts             HTTP REPL server
  session.ts          CDP Session class (connect, target routing, events)
  browser.ts          Browser launch/discovery/lifecycle/profiles
  gen.ts              Codegen script
  generated.ts        Auto-generated CDP types (56 domains, 652 methods)
  browser_protocol.json
  js_protocol.json
interaction-skills/   CDP pattern recipes (screenshots, cookies, tabs, etc.)
SKILL.md              Agent-facing documentation
```

## Regenerating the SDK

When upstream protocol JSONs change:

```bash
bun src/gen.ts
browseruse --restart
```

## License

MIT
