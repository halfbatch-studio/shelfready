# ShelfReady

Get an iOS app ready for the App Store shelf. ShelfReady reads your repo and keeps the non-code parts of a release honest: the privacy policy, support page and Impressum, your App Privacy answers, and a go-live checklist. In CI it fails the build when a new SDK or data type isn't covered by your policy.

It does not upload builds or fill in App Store Connect; use [`asc`](https://github.com/rudrankriyam/App-Store-Connect-CLI) or fastlane for that. ShelfReady covers the legal, privacy and web layer around them, with the EU steps most tools skip.

Try it in your app's repo, nothing to install:

```sh
npx -y shelfready check
```

Already on the App Store? Paste your link at **[shelfready.dev/check](https://shelfready.dev/check/)**.

Website, the full checklist and what common SDKs collect: **[shelfready.dev](https://shelfready.dev)**

## Quick start

```sh
brew install halfbatch-studio/tap/shelfready   # or: npm install -g shelfready   (Node 20+)

cd ~/path/to/your-app
shelf init --country DE --email support@example.com --brand "Your Studio" --voice I --base-url https://example.com/app/
# review shelfready.yaml: add privacy notes and FAQ
shelf pages --swiftui MyApp/LegalView.swift   # privacy, support, Impressum + in-app view
shelf store                                   # fastlane/app_privacy_details.json
shelf check --ci                              # fails on drift
shelf checklist --online                      # what's left before you submit
```

## Commands

| Command | What it does |
|---|---|
| `shelf scan` | Reads bundle IDs, display names, permission texts (Info.plist and `INFOPLIST_KEY_*`), privacy manifests (XML or binary), export compliance, and packages from Package.resolved, Podfile.lock and Cartfile.resolved |
| `shelf init` | Writes `shelfready.yaml` from the scan plus your publisher details; known SDKs add what they collect |
| `shelf pages` | Privacy policy, support page and Impressum (Germany and Austria) as Markdown with Jekyll front matter; `--swiftui` writes a `LegalView` for the in-app Impressum |
| `shelf store` | App Privacy answers in fastlane's `app_privacy_details.json` format; data types without an App Store Connect category are reported, never guessed |
| `shelf check` | Drift between `shelfready.yaml` and the repo, missing manifests, placeholder permission texts, unknown SDKs, trader details, in-app Impressum. `--ci` exits 1 on errors, `--online` checks the published pages, `--format github` annotates pull requests |
| `shelf checklist` | The go-live checklist: automatic items from `check`, manual ones you tick with `--done <id>`; `--markdown` writes it as a file |
| `shelf migrate` | Updates `shelfready.yaml` to the current schema, keeping your comments and style |
| `shelf listing` | Checks an app that's already live, from its App Store link alone: privacy policy and support page load, the policy has a contact and a date, EU trader details, an Impressum for German and Austrian traders, and whether the privacy label covers the SDKs the policy names. Also on the web at [shelfready.dev/check](https://shelfready.dev/check/) |
| `shelf agents` | Adds a short note to `AGENTS.md` (or `CLAUDE.md`) so coding agents in the repo run the checks before a release; `shelf init` offers it |
| `shelf mcp` | Runs the MCP server on stdio, so Claude and other agents can use all of the above |

## Use with your coding agent

ShelfReady includes an MCP server (`shelf mcp`) and a skill, so the agent you build your app with can run the whole go-live flow: scan the repo, ask you for the publisher details it can't know, write the pages and App Privacy answers, and work through the checklist.

**Claude Code** (terminal, VS Code, JetBrains, desktop): install the plugin, which adds the skill and starts the server.

```sh
claude plugin marketplace add halfbatch-studio/shelfready
claude plugin install shelfready@shelfready
```

Then ask: "get this app ready for the App Store".

**Codex CLI:**

```sh
codex mcp add shelfready -- npx -y shelfready mcp
```

**Cursor, Claude Desktop, Windsurf and other MCP clients:** add this to the client's MCP config (for Cursor, `.cursor/mcp.json` in your app repo).

```json
{
  "mcpServers": {
    "shelfready": { "command": "npx", "args": ["-y", "shelfready", "mcp"] }
  }
}
```

Tools: `scan`, `init`, `check`, `checklist`, `tick`, `pages`, `app_privacy`, `listing`, `sdk_info`, `migrate`. Each takes `path`, the app repo, and only ever writes inside it. The server is listed in the [MCP Registry](https://registry.modelcontextprotocol.io) as `io.github.halfbatch-studio/shelfready`.

The skill, [`plugin/skills/shelfready/SKILL.md`](plugin/skills/shelfready/SKILL.md), follows the open Agent Skills format: copy the folder into any agent that reads skills, or upload it to claude.ai.

## GitHub Action

```yaml
# .github/workflows/shelfready.yml
name: ShelfReady
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: halfbatch-studio/shelfready@v0
        with:
          online: "false"   # "true" also checks the live pages
```

Inputs: `path` (folder with `shelfready.yaml`, default `.`), `online` (default `false`), `fail-on-error` (default `true`). Findings appear as annotations and in the job summary.

## What ShelfReady knows about SDKs

`cli/knowledge/` describes 21 common SDKs (Firebase, RevenueCat, Sentry, Mixpanel, Amplitude, PostHog, Facebook, OneSignal, Bugsnag, Datadog, Segment, TelemetryDeck, Adapty, Superwall, Google Sign-In, Supabase, Alamofire, Kingfisher, SDWebImage, Lottie, Realm). Every entry is generated from the SDK's own privacy manifest and records the commit it came from; `npm run kb:import` refreshes them. Additions are welcome: add the SDK to `cli/knowledge/sources.yaml` and run the import.

## Config: `shelfready.yaml`

One file in your app repo holds the facts behind your pages: app, publisher (`voice: I` or `we`, trader status, Impressum details), collected data, privacy notes, FAQ, page URLs and checklist ticks. It's versioned: when ShelfReady changes the format, `shelf migrate` updates the file and lists what to review. See [`examples/kipple`](examples/kipple) for a real one and its generated output.

## Status and limits

- Version 0.2. Used to ship [kipple](https://halfbatch.studio/kipple/); expect rough edges.
- **Not legal advice.** Page templates are drafts based on § 5 DDG, the GDPR and Apple's rules, not yet reviewed by a lawyer. You're responsible for what your pages say.
- iOS only for now.

## Repository

```
cli/        the `shelf` CLI and its core library (TypeScript), tests, SDK knowledge base
site/       shelfready.dev, generated from the same checklist items as the CLI
examples/   real configs and output
action.yml  the GitHub Action
plugin/     the Claude Code plugin: skill and MCP server config
```

## License

[Apache-2.0](LICENSE) © Half Batch. The license covers the code, not the names: "ShelfReady" and "Half Batch" aren't licensed for use by forks (see [NOTICE](NOTICE)).
