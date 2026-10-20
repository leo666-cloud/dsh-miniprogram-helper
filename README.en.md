# dsh-miniprogram-helper

A [DSH](https://github.com/deepseek-ai/deepseek-harness) plugin that lets the agent **scan, scaffold, register and validate WeChat Mini Program** pages and config — and drive the WeChat DevTools CLI.

The problem it solves: when an AI generates a Mini Program page it very often **creates the files but forgets to list them in `app.json`**, so the page is invisible in WeChat DevTools. This plugin makes "create the file" and "register it" one atomic operation, and self-verifies afterwards.

## 11 tools

| Tool | What it does |
|---|---|
| `mp_scan` | Full health check: page inventory, missing files, **unregistered (orphan) pages**, tabBar/subpackage/usingComponents validation, package size |
| `mp_page_add` | Create a page (wxml/wxss/script/json) **and** register it in `app.json`, then self-verify. Never overwrites existing files unless `force=true` |
| `mp_page_remove` | Unregister a page (optionally delete its files). Refuses to remove the launch page, tabBar pages, or the last page |
| `mp_entry_set` | Change the launch page and keep `entryPagePath` in sync |
| `mp_register` | Register pages that already exist on disk, without creating files |
| `mp_fix` | One-click: register every orphan page. Custom components are excluded, so components never become pages |
| `mp_subpackage_add` | Create a subpackage, validate its root, register the first page **relative to the subpackage** |
| `mp_component_add` | Create a custom component and inject it into `usingComponents` |
| `mp_tabbar` | Configure the bottom tab bar from one line (`page:text`), validating the 2–5 limit and icon files |
| `mp_project_init` | Scaffold a project DevTools can import directly, including the `miniprogramRoot` layout |
| `mp_devtools` | Drive the DevTools CLI: `detect` / `login` / `open` / `preview` (renders a QR code PNG) / `upload` |

## What it gets right

- **Project root vs. code root.** `miniprogramRoot` in `project.config.json` (commonly `miniprogram/`) decides where `app.json` lives. Every path resolves against the code root, and both a project root and a code root are accepted as input.
- **Edits JSON without destroying it.** `app.json` allows comments, but `JSON.parse` doesn't and `JSON.stringify` silently drops your comments, indentation, key order and trailing comments. This plugin ships a JSONC parser plus range-replacement editing, so only the targeted fragment changes — `"pages/a", // home` stays exactly where it was.
- **Comments are not required reading for the machine.** Only the exported behaviour matters to WeChat.
- **Only script + `.wxml` are required.** `.wxss` / `.json` are optional. Validators that demand all four produce false failures; this one separates ❌ required from ℹ️ optional.
- **Components are never mistaken for pages.** Detection is `"component": true` in the sibling `.json`, plus skipping component directories.
- **The last path segment is the file base name**: `pages/detail/index` → `pages/detail/index.wxml`, not `pages/detail/index/index.wxml`. When the path points at a directory instead, the scan tells you the real path on disk.
- **Subpackage pages never land in the main package.** That mistake is a hard compile error in WeChat DevTools.
- **No silent overwrites.** `mp_page_add` / `mp_component_add` report kept files instead of clobbering hand-written code.
- **Path traversal is rejected.**
- **DevTools failures are attributed** to permissions, IDE initialization, not-logged-in, closed service port, or timeout — each with a concrete fix. Every CLI call is time-boxed so a stuck IDE can't hang the session.

## Install

```sh
dsh plugin --profile web add dsh-miniprogram-helper
```

Restart `dsh web`, then start a new session — the client module registry caches metadata for the life of the process.

> The official DSH Desktop app owns its `desktop` profile; the CLI refuses to modify it. Install through the app's own **Settings → Plugins**.

Requires Node.js `^22.19` or `>=24`, and DSH `0.2.1-rc.2` or a compatible line.

## Usage

```
Scan ~/project/miniprogram with mp_scan and tell me what's wrong
```

```
Add an "Orders" page at pages/order/index titled "我的订单"
```

```
Register every orphan page mp_scan found
```

```
Set up a bottom tab bar: Home / Orders / Me
```

```
Render a preview QR code so I can scan it
```

Configuration (all optional):

| Key | Default | Meaning |
|---|---|---|
| `projectRoot` | empty | Default project path |
| `useTypeScript` | `false` | Generate `.ts` instead of `.js` |
| `componentDirs` | `components` | Component directories (comma-separated), skipped when scanning for pages |
| `appId` | empty | AppID written by `mp_project_init`; `touristappid` when empty |
| `devtoolsCli` | empty | Path to the DevTools CLI; auto-detected when empty |
| `devtoolsPort` | empty | IDE service port |
| `devtoolsTimeoutSec` | `90` | CLI timeout |
| `previewDir` | empty | Where preview QR codes are written; system temp when empty |

For `mp_devtools`, enable **Settings → Security → Service port** in WeChat DevTools and log in first.

## Development

```sh
pnpm install
pnpm run build   # tsc -> lib/
pnpm test        # 21 end-to-end tests
```

The tests create real projects in temp directories, run the tools, and re-parse the resulting `app.json` — covering comment preservation, idempotency, subpackage registration, component-vs-page detection, path traversal, and CLI failure attribution.

## License

MIT
