#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { createRequire } from "node:module";
import { Command, Option } from "commander";
import { addAgentsNote, agentsNoteFile, type AgentsNoteResult, appPrivacy, check, checklist, checklistMarkdown, checklistSummary, checkOnline, CURRENT_VERSION, checkListing, knowledgeBase, setTicks, factsToYAML, initFacts, legalView, migrateFile, pageFiles, readFacts, scan } from "./index.js";

const program = new Command()
  .name("shelf")
  .description("Get an iOS app ready for the App Store shelf: legal pages, privacy truth, preflight.")
  .version((createRequire(import.meta.url)("../package.json") as { version: string }).version);

const list = (items: string[]) => (items.length ? items.join(", ") : "—");
const factsPath = (repo: string) => join(resolve(repo), "shelfready.yaml");

function requireLoaded(repo: string) {
  const path = factsPath(repo);
  if (!existsSync(path)) {
    console.error(`No shelfready.yaml in ${resolve(repo)}. Run \`shelf init\` first.`);
    process.exit(1);
  }
  try {
    const loaded = readFacts(path);
    if (loaded.fileVersion < CURRENT_VERSION) {
      console.warn(`! shelfready.yaml is schema v${loaded.fileVersion}; using it as v${CURRENT_VERSION} in memory. Run \`shelf migrate\` to update the file.`);
    }
    return loaded;
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  }
}

const requireFacts = (repo: string) => requireLoaded(repo).facts;

program
  .command("scan")
  .description("Read the repo: bundle IDs, purpose strings, privacy manifests, packages.")
  .argument("[path]", "app repository", ".")
  .option("--json", "print JSON")
  .action((path: string, opts: { json?: boolean }) => {
    const r = scan(path);
    if (opts.json) return console.log(JSON.stringify(r, null, 2));
    console.log(`Projects:        ${list(r.xcodeProjects)}`);
    console.log(`Bundle IDs:      ${list(r.bundleIdentifiers)}`);
    console.log(`Display names:   ${list(r.displayNames)}`);
    console.log(`Purpose strings: ${list(Object.keys(r.purposeStrings).sort())}`);
    console.log(`Packages:        ${list(r.packages.map((p) => `${p.identity} ${p.version ?? ""}`.trim()))}`);
    console.log(`Privacy manifests: ${r.privacyManifests.length}`);
    for (const m of r.privacyManifests) {
      console.log(`  ${m.path}`);
      console.log(`    tracking: ${m.tracking}  collected: ${list(m.collectedDataTypes.map((c) => c.type))}`);
      console.log(`    required-reason APIs: ${list(m.accessedAPIs.map((a) => `${a.category} ${a.reasons.join(",")}`))}`);
    }
  });

program
  .command("init")
  .description("Scan the repo and write shelfready.yaml for you to confirm.")
  .argument("[path]", "app repository", ".")
  .requiredOption("--country <code>", "publisher country, ISO code (e.g. DE)")
  .requiredOption("--email <email>", "public contact email")
  .option("--brand <name>", "brand or studio shown on pages")
  .option("--publisher <name>", "legal name (required for traders)")
  .option("--trader", "declare EU trader status (charging for the app or in-app purchases)")
  .option("--phone <number>", "second contact channel for traders")
  .addOption(new Option("--voice <voice>", "how pages speak: I (solo) or we (team)").choices(["I", "we"]).default("we"))
  .option("--base-url <url>", "where the pages will live, e.g. https://example.com/myapp/")
  .option("--force", "overwrite an existing shelfready.yaml")
  .option("--agents-note", "add a ShelfReady note to AGENTS.md (or CLAUDE.md) without asking")
  .option("--no-agents-note", "don't add the note and don't ask")
  .action(async (path: string, o: { country: string; email: string; brand?: string; publisher?: string; trader?: boolean; phone?: string; voice: "I" | "we"; baseUrl?: string; force?: boolean; agentsNote?: boolean }) => {
    const out = factsPath(path);
    if (existsSync(out) && !o.force) {
      console.error(`${out} exists. Use --force to overwrite.`);
      process.exit(1);
    }
    let result;
    try {
      result = initFacts(scan(path), o);
    } catch (e) {
      console.error(String(e instanceof Error ? e.message : e));
      process.exit(1);
    }
    writeFileSync(out, factsToYAML(result.facts));
    console.log(`Wrote ${out}`);
    for (const n of result.notes) console.log(n.replace("generate the pages", "run `shelf pages`"));
    await offerAgentsNote(path, o.agentsNote);
  });

program
  .command("listing")
  .description("Check a live App Store listing from the outside: privacy policy, support page, EU trader details, and whether the privacy label covers the SDKs the policy names.")
  .argument("<app>", "App Store link or numeric app ID")
  .option("--json", "print the report as JSON")
  .action(async (app: string, o: { json?: boolean }) => {
    let report;
    try {
      report = await checkListing(app, { fetch, kb: knowledgeBase() });
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
    if (o.json) return console.log(JSON.stringify(report, null, 2));
    const mark = { ok: "✓", warn: "!", error: "✗", info: "i" } as const;
    console.log(`${report.app.title} by ${report.app.seller}\n${report.app.url}\n`);
    for (const f of report.findings) {
      console.log(`  ${mark[f.level]} ${f.title}${f.detail ? `\n      ${f.detail}` : ""}${f.level !== "ok" && f.fix ? `\n      → ${f.fix}` : ""}`);
    }
    console.log(`\n${report.passed} of ${report.total} checks pass. This only sees the public listing; \`shelf check\` in the app's repo goes further.`);
    if (report.findings.some((f) => f.level === "error")) process.exitCode = 1;
  });

program
  .command("agents")
  .description("Add a short ShelfReady note to AGENTS.md (or CLAUDE.md), so coding agents in this repo run the checks before a release.")
  .argument("[path]", "app repository", ".")
  .action((path: string) => reportAgentsNote(addAgentsNote(path)));

/** A path to show: relative to where you are, unless that climbs out of it. */
const shown = (file: string) => {
  const rel = relative(process.cwd(), file);
  return rel && !rel.startsWith("..") ? rel : file;
};

function reportAgentsNote(r: AgentsNoteResult) {
  const name = shown(r.file);
  console.log(r.action === "present" ? `${name} already has the ShelfReady note.` : `${r.action === "created" ? "Created" : "Added the ShelfReady note to"} ${name}.`);
}

async function offerAgentsNote(path: string, choice: boolean | undefined) {
  if (choice === false) return;
  const target = agentsNoteFile(path);
  if (existsSync(target) && readFileSync(target, "utf8").includes("<!-- shelfready -->")) return;
  const file = shown(target);
  if (choice === undefined) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.log(`Tip: \`shelf agents\` adds a note to ${file} so coding agents in this repo run \`shelf check\` before a release.`);
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Add a ShelfReady note to ${file}, so coding agents (Claude Code, Codex, Cursor, Xcode) run the checks before a release? [Y/n] `);
    rl.close();
    if (/^n/i.test(answer.trim())) return;
  }
  reportAgentsNote(addAgentsNote(path));
}

program
  .command("pages")
  .description("Generate privacy policy, support page and Impressum (DE/AT) as Markdown; --swiftui adds LegalView.swift.")
  .argument("[path]", "app repository", ".")
  .option("--out <dir>", "output folder", "shelfready/pages")
  .option("--swiftui <file>", "also write a SwiftUI LegalView to this file")
  .addOption(new Option("--front-matter <kind>", "front matter for static site generators").choices(["none", "jekyll"]).default("jekyll"))
  .action((path: string, o: { out: string; swiftui?: string; frontMatter: "none" | "jekyll" }) => {
    const facts = requireFacts(path);
    const dir = resolve(path, o.out);
    mkdirSync(dir, { recursive: true });
    for (const page of pageFiles(facts, o.frontMatter)) {
      writeFileSync(join(dir, page.file), page.content);
      console.log(`Wrote ${join(o.out, page.file)}`);
    }
    if (o.swiftui) {
      if (!facts.pages.baseURL) console.warn("pages.baseURL is empty; the LegalView links will be relative and won't open.");
      writeFileSync(resolve(path, o.swiftui), legalView(facts));
      console.log(`Wrote ${o.swiftui}`);
    }
  });

program
  .command("store")
  .description("App Store Connect helpers. --privacy-json writes fastlane's app_privacy_details.json.")
  .argument("[path]", "app repository", ".")
  .option("--privacy-json [file]", "write App Privacy answers for fastlane", "fastlane/app_privacy_details.json")
  .action((path: string, o: { privacyJson: string | true }) => {
    const facts = requireFacts(path);
    const file = resolve(path, typeof o.privacyJson === "string" ? o.privacyJson : "fastlane/app_privacy_details.json");
    const { entries, unmapped } = appPrivacy(facts);
    mkdirSync(resolve(file, ".."), { recursive: true });
    writeFileSync(file, JSON.stringify(entries, null, 2) + "\n");
    console.log(`Wrote ${file}`);
    if (unmapped.length) console.warn(`Answer by hand in App Store Connect: ${unmapped.join(", ")}`);
    console.log("Upload with: fastlane run upload_app_privacy_details_to_app_store json_path:" + file);
    console.log("URLs, age rating and submission: use `asc` (not wrapped yet).");
  });

program
  .command("check")
  .description("Preflight: shelfready.yaml vs the repo, manifests, purpose strings, Impressum. --online also checks the live pages. --ci exits 1 on errors.")
  .argument("[path]", "app repository", ".")
  .option("--online", "check that the pages are live and show what shelfready.yaml says")
  .option("--ci", "exit with code 1 when there are errors")
  .option("--json", "print JSON")
  .addOption(new Option("--format <format>", "output format").choices(["text", "json", "github"]).default("text"))
  .action(async (path: string, o: { online?: boolean; ci?: boolean; json?: boolean; format: "text" | "json" | "github" }) => {
    const { facts, fileVersion } = requireLoaded(path);
    let findings = check(facts, scan(path), { fileVersion });
    if (o.online) {
      const online = await checkOnline(facts);
      findings = [...findings.filter((f) => f.level !== "ok"), ...online];
      if (!findings.some((f) => f.level !== "ok")) findings.unshift({ level: "ok", rule: "all", message: "shelfready.yaml matches the repo." });
    }
    const format = o.json ? "json" : o.format;
    if (format === "json") console.log(JSON.stringify(findings, null, 2));
    else if (format === "github") {
      // GitHub Actions workflow commands: annotations on the run and the pull request.
      const esc = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
      for (const f of findings) {
        if (f.level === "ok") console.log(`✓ ${f.rule}: ${f.message}`);
        else console.log(`::${f.level === "error" ? "error" : "warning"} file=shelfready.yaml,title=${esc(`ShelfReady ${f.rule}`).replace(/[,:]/g, " ")}::${esc(f.message)}`);
      }
      const summary = process.env.GITHUB_STEP_SUMMARY;
      if (summary) {
        const rows = findings.map((f) => `| ${f.level === "error" ? "✗" : f.level === "warn" ? "!" : "✓"} | \`${f.rule}\` | ${f.message.replace(/\|/g, "\\|")} |`);
        appendFileSync(summary, ["### ShelfReady", "", "| | Rule | Finding |", "|---|---|---|", ...rows, ""].join("\n"));
      }
    } else for (const f of findings) console.log(`${f.level === "error" ? "✗" : f.level === "warn" ? "!" : "✓"} ${f.rule}: ${f.message}`);
    if (o.ci && findings.some((f) => f.level === "error")) process.exit(1);
  });

program
  .command("checklist")
  .description("Go-live checklist: automatic items from check, manual items you tick with --done.")
  .argument("[path]", "app repository", ".")
  .option("--online", "also verify that the pages are live")
  .option("--done <ids>", "tick manual items, comma-separated (e.g. trademark,asc-urls)")
  .option("--undo <ids>", "untick manual items")
  .option("--markdown [file]", "print or write the checklist as Markdown")
  .action(async (path: string, o: { online?: boolean; done?: string; undo?: string; markdown?: string | true }) => {
    const file = factsPath(path);
    for (const [ids, done] of [[o.done, true], [o.undo, false]] as const) {
      if (!ids) continue;
      try {
        writeFileSync(file, setTicks(file, ids.split(",").map((s) => s.trim()).filter(Boolean), done));
      } catch (e) {
        console.error(String(e instanceof Error ? e.message : e));
        process.exit(1);
      }
    }
    const { facts, fileVersion } = requireLoaded(path);
    const s = scan(path);
    const rows = checklist({ facts, scan: s, findings: check(facts, s, { fileVersion }), ...(o.online ? { online: await checkOnline(facts) } : {}) });
    if (o.markdown) {
      const md = checklistMarkdown(rows, facts.app.name);
      if (typeof o.markdown === "string") {
        writeFileSync(resolve(path, o.markdown), md);
        console.log(`Wrote ${o.markdown}`);
      } else console.log(md);
      return;
    }
    const icon = { done: "✓", todo: "○", fail: "✗", unchecked: "?" } as const;
    for (const group of [...new Set(rows.map((r) => r.group))]) {
      console.log(`\n${group}`);
      for (const r of rows.filter((x) => x.group === group)) {
        const id = r.automatic ? "" : `  [${r.id}]`;
        console.log(`  ${icon[r.status]} ${r.title}${r.detail ? ` (${r.detail})` : ""}${id}`);
        if (r.how) console.log(`      ${r.how}`);
      }
    }
    console.log(`\n${checklistSummary(rows)}${rows.some((r) => !r.automatic && r.status !== "done") ? " Tick manual items with: shelf checklist --done <id>" : ""}`);
  });

program
  .command("migrate")
  .description("Update shelfready.yaml to the current schema, keeping your comments and wording.")
  .argument("[path]", "app repository", ".")
  .option("--dry-run", "show what would change without writing")
  .action((path: string, o: { dryRun?: boolean }) => {
    const file = factsPath(path);
    if (!existsSync(file)) {
      console.error(`No shelfready.yaml in ${resolve(path)}.`);
      process.exit(1);
    }
    let result;
    try {
      result = migrateFile(file);
    } catch (e) {
      console.error(String(e instanceof Error ? e.message : e));
      process.exit(1);
    }
    if (result.from === result.to) return console.log(`shelfready.yaml is already schema v${result.to}.`);
    console.log(`shelfready.yaml: v${result.from} → v${result.to}`);
    for (const n of result.notes) console.log(n);
    if (o.dryRun) return console.log("(dry run, nothing written)");
    writeFileSync(file, result.text);
    console.log(`Wrote ${file}. Review the new fields, then run \`shelf check\`.`);
  });

program
  .command("mcp")
  .description("Run the MCP server on stdio, for Claude and other agents: npx -y shelfready mcp")
  .action(async () => {
    const { serveStdio } = await import("./mcp.js");
    await serveStdio();
  });

for (const [name, what] of [
  ["publish", "Publish pages to GitHub Pages or shelfready.dev."],
  ["login", "Sign in to shelfready.dev (device flow)."],
] as const) {
  program
    .command(name)
    .description(`${what} (not built yet)`)
    .action(() => {
      console.log(`\`shelf ${name}\` isn't built yet. See docs/roadmap.md.`);
      process.exit(2);
    });
}

await program.parseAsync();
