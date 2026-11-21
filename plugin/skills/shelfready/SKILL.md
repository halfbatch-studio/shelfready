---
name: shelfready
description: Get an iOS app ready for App Store submission with ShelfReady — privacy policy, support page, Impressum (DE/AT), App Privacy answers, privacy manifests and a go-live checklist, generated from the app's own code. Use when someone is shipping or updating an iOS app, asks what Apple or the EU requires before release, needs a privacy policy or App Privacy ("nutrition label") answers, adds an SDK, or mentions shelfready.yaml.
---

# ShelfReady: get an iOS app on the shelf

ShelfReady reads an iOS repo (bundle IDs, permission texts, `PrivacyInfo.xcprivacy`, SwiftPM/CocoaPods/Carthage packages) and keeps one file, `shelfready.yaml`, at the repo root as the source of truth. Pages, App Privacy answers and the checklist are all generated from it, and `check` fails when the code drifts away from it.

## Tools

Prefer the `shelfready` MCP tools when they're available: `scan`, `init`, `check`, `checklist`, `tick`, `pages`, `app_privacy`, `sdk_info`, `migrate`. Each takes `path` (the app repo).

Without them, use the CLI, which does the same: `npx -y shelfready <command>` (or `shelf` if installed with Homebrew). `shelf --help` lists the options.

| Step | MCP tool | CLI |
|---|---|---|
| Read the repo | `scan` | `shelf scan` |
| Create the YAML | `init` | `shelf init --country DE --email … --voice I` |
| Preflight | `check` (`online: true` for live pages) | `shelf check [--online]` |
| Pages | `pages` (`write: false` to preview, `swiftui` for LegalView) | `shelf pages [--swiftui App/LegalView.swift]` |
| App Privacy | `app_privacy` (`write` to save fastlane JSON) | `shelf store --privacy-json` |
| Checklist | `checklist`, `tick` | `shelf checklist [--done id,id]` |
| An SDK | `sdk_info` | — |
| Old schema | `migrate` | `shelf migrate` |
| A live listing, no repo | `listing` | `shelf listing <App Store link>` |

## Workflow

1. **Scan** and tell the developer, briefly, what you found: app name, targets, permissions, manifests, third-party SDKs.
2. **No `shelfready.yaml`?** Ask for the publisher facts before `init`, all in one message:
   - country (ISO code; DE and AT need an Impressum),
   - public contact email,
   - brand or studio name, and whether pages say "I" or "we",
   - whether they charge for the app or in-app purchases (EU trader),
   - where the pages will live (base URL), if they know.
   - whether to add a short ShelfReady note to `AGENTS.md` (or `CLAUDE.md`), so any coding agent in the repo runs the checks before a release (`agentsNote: true` on `init`, or `shelf agents`).
   Traders also need a legal name, a business address (never a home address) and, in DE/AT, a phone or contact form plus VAT ID and register details for companies. Ask; never fill these in from guesses, the git log or the Apple developer account.
3. **Fill in what only the developer knows** by editing `shelfready.yaml` with them: `app.tagline`, `privacyNotes` (where data lives, e.g. "everything stays on the device and in your iCloud"), `support.faq`, `support.replyTime`. Draft from the code and ask them to confirm.
4. **Check** and fix findings in the code or the YAML (table below). Re-run until there are no errors.
5. **Pages**: generate, then help publish them wherever their site is (GitHub Pages, their own site). Edit the YAML, never the generated Markdown; it is overwritten. For DE/AT traders also generate `LegalView.swift` and add it to Settings.
6. **App Privacy**: produce the answers. Anything listed as unmapped must be answered by hand in App Store Connect; say so, don't guess.
7. **Checklist**: show what's left. Items marked `?` (not checked) are live-page checks that only run with `online: true`; run that rather than calling them open. Tick manual items (`trademark`, `trader-status`, `paid-agreements`, `asc-app-info`, `asc-urls`, `asc-app-privacy`, `asc-age-rating`, `asc-screenshots`, `testflight`, `submitted`) only after the developer says they did them.
8. Once pages are live, `check` with `online: true` to confirm they show the YAML's date, email and FAQ. Offer the GitHub Action so drift fails pull requests:
   ```yaml
   - uses: halfbatch-studio/shelfready@v0
     with:
       online: "true"
   ```

## Fixing check findings

| Rule | What to do |
|---|---|
| `drift.packages`, `drift.collected`, `drift.tracking` | The code changed. Find out what the new SDK or data type does (`sdk_info`), update `data` in the YAML, regenerate pages and App Privacy answers. |
| `sdk.unknown` | Not in the knowledge base. Read its `PrivacyInfo.xcprivacy` (in the package checkout) or the vendor's docs and add what it collects to `data.collected`. |
| `sdk.yourData` | The SDK may send user content off the device (e.g. crash reports with breadcrumbs). Mention it in `privacyNotes`. |
| `manifest.missing`, `manifest.reasons` | Add `PrivacyInfo.xcprivacy` to every target, with an approved reason for each required-reason API the target uses (UserDefaults → `CA92.1` for app-only use). |
| `purpose.placeholder` | Write a specific `NS…UsageDescription`: what the permission is for, in the user's words. |
| `trader.*`, `publisher.email` | Ask the developer for the missing detail. |
| `impressum.legalView`, `impressum.inApp` | DE/AT: the Impressum must be reachable inside the app. Generate `LegalView.swift` and link it from Settings. |
| `config.outdated`, `config.unknownKey` | Run `migrate`; fix typos in key names. |
| `online.*`, `pages.baseURL` | Set `pages.baseURL`, publish the pages, check again. |

## Boundaries

- The generated pages are drafts based on the code, not legal advice. Say so once when you hand them over, and suggest a lawyer if they process sensitive data or sell to businesses.
- ShelfReady can't see servers, analytics dashboards or data sent by code it doesn't scan. Ask whether the app has a backend or sends anything off the device that the manifests don't declare.
- Don't overwrite an existing `shelfready.yaml` (`init` with `force`) unless the developer asks; it holds their wording.
