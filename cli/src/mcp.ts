// ShelfReady MCP server: the CLI's commands as MCP tools over stdio (`shelf mcp`).
// Hand-rolled JSON-RPC instead of @modelcontextprotocol/sdk to keep the package dependency-free;
// test/mcp.test.ts checks it against the official SDK client.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import {
  addAgentsNote, type AgentsNoteResult, appPrivacy, check, checkListing, checklist, checklistSummary, checkOnline, CURRENT_VERSION, factsToYAML, initFacts, knowledgeBase, legalView,
  lookup, migrateFile, pageFiles, readFacts, scan, sdkCollects, sdkTracks, setTicks, type Finding,
} from "./index.js";

const VERSION = (createRequire(import.meta.url)("../package.json") as { version: string }).version;
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `ShelfReady gets an iOS app ready for the App Store: privacy policy, support page, Impressum (DE/AT), App Privacy answers and a go-live checklist, all generated from one file, shelfready.yaml, in the app's repo.
Every tool takes \`path\`, the app repository (default: the server's working directory).
Typical flow: scan → init (if there's no shelfready.yaml) → fill privacyNotes and support.faq in the YAML with the developer → check → pages → app_privacy → checklist (tick manual items only when the developer confirms they did them).
Never invent publisher facts (legal name, address, VAT ID, register): ask the developer. Generated pages are drafts, not legal advice.`;

type Json = Record<string, unknown>;
interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  annotations: Json;
  run: (args: Json) => Promise<{ text: string; data: Json }> | { text: string; data: Json };
}

class ToolError extends Error {}

const pathProp = { path: { type: "string", description: "App repository folder. Default: the server's working directory." } };
const str = (description: string) => ({ type: "string", description });
const bool = (description: string) => ({ type: "boolean", description });

function repo(args: Json): string {
  return resolve(typeof args.path === "string" && args.path ? args.path : process.cwd());
}

/** Resolve a file the tool will write, refusing anything outside the repo. */
function inside(root: string, file: string): string {
  const full = resolve(root, file);
  const rel = relative(root, full);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new ToolError(`${file} is outside the repository ${root}; refusing to write there.`);
  return full;
}

function load(root: string) {
  const file = join(root, "shelfready.yaml");
  if (!existsSync(file)) throw new ToolError(`No shelfready.yaml in ${root}. Run the init tool first.`);
  try {
    return { file, ...readFacts(file) };
  } catch (e) {
    throw new ToolError(e instanceof Error ? e.message : String(e));
  }
}

/** "NSPrivacyCollectedDataTypePurchaseHistory" → "PurchaseHistory". */
const short = (s: string) => s.replace(/^NSPrivacyCollectedDataType(Purpose)?/, "");

const icon = (level: Finding["level"]) => (level === "error" ? "✗" : level === "warn" ? "!" : "✓");
const findingLines = (findings: Finding[]) => findings.map((f) => `${icon(f.level)} ${f.rule}: ${f.message}`).join("\n");
const counts = (findings: Finding[]) => ({
  errors: findings.filter((f) => f.level === "error").length,
  warnings: findings.filter((f) => f.level === "warn").length,
});

async function findingsFor(root: string, online: boolean) {
  const { facts, fileVersion } = load(root);
  const s = scan(root);
  let findings = check(facts, s, { fileVersion });
  let onlineFindings: Finding[] | undefined;
  if (online) {
    onlineFindings = await checkOnline(facts);
    findings = [...findings.filter((f) => f.level !== "ok"), ...onlineFindings];
    if (!findings.some((f) => f.level !== "ok")) findings.unshift({ level: "ok", rule: "all", message: "shelfready.yaml matches the repo." });
  }
  return { facts, fileVersion, scan: s, findings, onlineFindings };
}

export const TOOLS: Tool[] = [
  {
    name: "scan",
    title: "Scan an iOS repo",
    description: "Read the app repository without changing it: Xcode projects, bundle IDs, display names, permission texts (NS…UsageDescription), privacy manifests (PrivacyInfo.xcprivacy) and third-party packages (SwiftPM, CocoaPods, Carthage).",
    inputSchema: { type: "object", properties: { ...pathProp } },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (a) => {
      const r = scan(repo(a));
      const text = [
        `Bundle IDs: ${r.bundleIdentifiers.join(", ") || "none"}`,
        `Display names: ${r.displayNames.join(", ") || "none"}`,
        `Permission texts: ${Object.keys(r.purposeStrings).sort().join(", ") || "none"}`,
        `Packages: ${r.packages.map((p) => p.identity).join(", ") || "none"}`,
        `Privacy manifests: ${r.privacyManifests.length}`,
      ].join("\n");
      return { text, data: r as unknown as Json };
    },
  },
  {
    name: "init",
    title: "Create shelfready.yaml",
    description: "Scan the repo and write shelfready.yaml, the single source of truth for the pages. Ask the developer for country, email, brand, legal name and trader status first; don't guess them. Refuses to overwrite an existing file unless force is true.",
    inputSchema: {
      type: "object",
      properties: {
        ...pathProp,
        country: str("Publisher country, ISO 3166-1 alpha-2 (e.g. DE). Decides which pages are required."),
        email: str("Public contact email shown on the pages."),
        brand: str("Brand or studio name shown on the pages."),
        publisher: str("Legal name. Required for traders."),
        trader: bool("EU trader status: true if the app or in-app purchases cost money."),
        phone: str("Second contact channel for DE/AT traders."),
        voice: { type: "string", enum: ["I", "we"], description: "How pages speak: I (solo developer) or we (team)." },
        baseUrl: str("Where the pages will live, e.g. https://example.com/myapp/"),
        force: bool("Overwrite an existing shelfready.yaml."),
        agentsNote: bool("Also add a short ShelfReady note to AGENTS.md (or CLAUDE.md, if the repo uses that) so coding agents run the checks before a release. Ask the developer first."),
      },
      required: ["country", "email"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    run: (a) => {
      const root = repo(a);
      const out = join(root, "shelfready.yaml");
      if (existsSync(out) && a.force !== true) throw new ToolError(`${out} exists. Pass force: true to overwrite it (the developer's edits would be lost).`);
      let result;
      try {
        result = initFacts(scan(root), a as unknown as Parameters<typeof initFacts>[1]);
      } catch (e) {
        throw new ToolError(e instanceof Error ? e.message : String(e));
      }
      const yaml = factsToYAML(result.facts);
      writeFileSync(out, yaml);
      const lines = [`Wrote ${out}`, ...result.notes];
      let agents: AgentsNoteResult | undefined;
      if (a.agentsNote === true) {
        agents = addAgentsNote(root);
        lines.push(agents.action === "present" ? `${relative(root, agents.file)} already has the ShelfReady note.` : `${agents.action === "created" ? "Created" : "Added the ShelfReady note to"} ${relative(root, agents.file)}.`);
      }
      return { text: lines.join("\n"), data: { file: out, notes: result.notes, yaml, ...(agents ? { agentsNote: agents } : {}) } };
    },
  },
  {
    name: "check",
    title: "Preflight check",
    description: "Compare shelfready.yaml with the repo: new SDKs or data types the pages don't mention, missing privacy manifests, placeholder permission texts, missing trader or Impressum details, outdated schema. online: true also fetches the live pages and checks they show the YAML's date, email and FAQ.",
    inputSchema: { type: "object", properties: { ...pathProp, online: bool("Also check the live pages over the network.") } },
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: async (a) => {
      const { findings } = await findingsFor(repo(a), a.online === true);
      const c = counts(findings);
      return { text: `${findingLines(findings)}\n\n${c.errors} errors, ${c.warnings} warnings.`, data: { ...c, findings } };
    },
  },
  {
    name: "checklist",
    title: "Go-live checklist",
    description: "The go-live checklist: automatic items computed from check, and manual items (trademark search, App Store Connect steps…) the developer ticks with the tick tool. Each open item says how to do it.",
    inputSchema: { type: "object", properties: { ...pathProp, online: bool("Also verify the live pages over the network.") } },
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: async (a) => {
      const r = await findingsFor(repo(a), a.online === true);
      const rows = checklist({ facts: r.facts, scan: r.scan, findings: check(r.facts, r.scan, { fileVersion: r.fileVersion }), ...(r.onlineFindings ? { online: r.onlineFindings } : {}) });
      const mark = { done: "✓", todo: "○", fail: "✗", unchecked: "?" } as const;
      const lines = rows.map((x) => `${mark[x.status]} ${x.title}${x.detail ? ` (${x.detail})` : ""}${x.automatic ? "" : ` [${x.id}]`}${x.status !== "done" && x.how ? `\n    ${x.how}` : ""}`);
      const done = rows.filter((x) => x.status === "done").length;
      const unchecked = rows.filter((x) => x.status === "unchecked").length;
      return { text: `${lines.join("\n")}\n\n${checklistSummary(rows).replace("--online", "online: true")}`, data: { done, unchecked, total: rows.length, items: rows } };
    },
  },
  {
    name: "tick",
    title: "Tick checklist items",
    description: "Mark manual checklist items as done (or undo them) in shelfready.yaml, keeping its comments. Only tick an item when the developer says they did it. Automatic items can't be ticked; fix the repo instead.",
    inputSchema: {
      type: "object",
      properties: { ...pathProp, ids: { type: "array", items: { type: "string" }, description: "Manual item IDs, e.g. [\"trademark\", \"testflight\"]." }, done: bool("false to untick. Default true.") },
      required: ["ids"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (a) => {
      const { file } = load(repo(a));
      const ids = Array.isArray(a.ids) ? a.ids.map(String) : [];
      if (!ids.length) throw new ToolError("Pass at least one checklist item ID in ids.");
      const done = a.done !== false;
      try {
        writeFileSync(file, setTicks(file, ids, done));
      } catch (e) {
        throw new ToolError(e instanceof Error ? e.message : String(e));
      }
      return { text: `${done ? "Ticked" : "Unticked"} ${ids.join(", ")} in ${file}.`, data: { file, ids, done } };
    },
  },
  {
    name: "pages",
    title: "Generate legal pages",
    description: "Generate the privacy policy, support page and (for DE/AT) Impressum as Markdown from shelfready.yaml. write: false returns the pages without writing files. swiftui writes a SwiftUI LegalView with the Impressum for the in-app requirement. The pages are drafts, not legal advice.",
    inputSchema: {
      type: "object",
      properties: {
        ...pathProp,
        out: str("Output folder inside the repo. Default shelfready/pages."),
        frontMatter: { type: "string", enum: ["jekyll", "none"], description: "Front matter for static site generators. Default jekyll." },
        swiftui: str("Also write LegalView.swift to this path inside the repo."),
        write: bool("false to only return the pages. Default true."),
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: (a) => {
      const root = repo(a);
      const { facts } = load(root);
      const files = pageFiles(facts, a.frontMatter === "none" ? "none" : "jekyll");
      if (a.write === false) {
        return { text: files.map((f) => `=== ${f.file} ===\n${f.content}`).join("\n\n"), data: { written: [], pages: files } };
      }
      const dir = inside(root, typeof a.out === "string" && a.out ? a.out : "shelfready/pages");
      mkdirSync(dir, { recursive: true });
      const written = files.map((f) => {
        writeFileSync(join(dir, f.file), f.content);
        return join(dir, f.file);
      });
      const notes: string[] = [];
      if (typeof a.swiftui === "string" && a.swiftui) {
        const swift = inside(root, a.swiftui);
        mkdirSync(dirname(swift), { recursive: true });
        writeFileSync(swift, legalView(facts));
        written.push(swift);
        if (!facts.pages.baseURL) notes.push("pages.baseURL is empty; the LegalView links will be relative and won't open.");
      }
      return { text: [`Wrote:`, ...written.map((w) => `  ${relative(root, w)}`), ...notes].join("\n"), data: { written, notes } };
    },
  },
  {
    name: "app_privacy",
    title: "App Privacy answers",
    description: "Derive the App Store Connect App Privacy answers from shelfready.yaml, in fastlane's app_privacy_details.json format. Lists data types that can't be mapped automatically; those must be answered by hand, never guessed. Pass write to save the JSON.",
    inputSchema: { type: "object", properties: { ...pathProp, write: str("Save the JSON to this path inside the repo, e.g. fastlane/app_privacy_details.json.") } },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: (a) => {
      const root = repo(a);
      const { facts } = load(root);
      const { entries, unmapped } = appPrivacy(facts);
      const json = JSON.stringify(entries, null, 2) + "\n";
      const notCollected = entries.every((e) => (e as { data_protections?: string[] }).data_protections?.includes("DATA_NOT_COLLECTED"));
      const lines = [notCollected ? "No data collected: answer \"Data Not Collected\" in App Store Connect." : `${entries.length} data types to declare in App Store Connect.`];
      let file: string | undefined;
      if (typeof a.write === "string" && a.write) {
        file = inside(root, a.write);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, json);
        lines.push(`Wrote ${relative(root, file)}. Upload with: fastlane run upload_app_privacy_details_to_app_store json_path:${relative(root, file)}`);
      }
      if (unmapped.length) lines.push(`Answer by hand in App Store Connect: ${unmapped.join(", ")}`);
      return { text: `${lines.join("\n")}\n\n${json}`, data: { entries, unmapped, ...(file ? { file } : {}) } };
    },
  },
  {
    name: "sdk_info",
    title: "What an SDK collects",
    description: "Look up a third-party iOS SDK in ShelfReady's knowledge base, built from each SDK's own privacy manifest: what it collects, whether it tracks, and where that's declared. Without name, lists the SDKs covered.",
    inputSchema: { type: "object", properties: { name: str("Swift package identity, CocoaPods or Carthage name, e.g. sentry-cocoa, firebase-ios-sdk, Alamofire.") } },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (a) => {
      if (typeof a.name !== "string" || !a.name) {
        const sdks = knowledgeBase().map((e) => ({ identity: e.identity, name: e.name, vendor: e.vendor }));
        return { text: sdks.map((s) => `${s.identity}: ${s.name} (${s.vendor})`).join("\n"), data: { sdks } };
      }
      const e = lookup(a.name);
      if (!e) return { text: `${a.name} isn't in the knowledge base yet. Read its PrivacyInfo.xcprivacy, or the vendor's privacy docs, and add what it collects to shelfready.yaml by hand.`, data: { found: false } };
      const collects = sdkCollects(e);
      const text = [
        `${e.name} (${e.vendor}), checked ${e.checked} at ${e.repository} ${e.commit.slice(0, 7)}`,
        `Tracking: ${sdkTracks(e) ? "yes" : "no"}`,
        `Collects:${collects.length ? "" : " nothing declared"}`,
        ...collects.map((c) => `  - ${short(c.type)}${c.linked ? ", linked to the user" : ""}${c.tracking ? ", used for tracking" : ""}${c.purposes?.length ? `, for ${c.purposes.map(short).join(", ")}` : ""}`),
        ...(e.notes ? [`Notes: ${e.notes}`] : []),
      ].join("\n");
      return { text, data: { found: true, entry: e as unknown as Json, collects, tracking: sdkTracks(e) } };
    },
  },
  {
    name: "listing",
    title: "Check a live App Store listing",
    description: "Check an app that is already on the App Store, without its repo: privacy policy and support page load, the policy has a contact and a date, EU trader details are complete, German/Austrian traders link an Impressum, and the App Privacy label covers the SDKs the policy names. Takes an App Store link or numeric ID. Read-only; fetches public pages.",
    inputSchema: { type: "object", properties: { app: str("App Store link (apps.apple.com/…/id123456789) or numeric app ID.") }, required: ["app"] },
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: async (a) => {
      let report;
      try {
        report = await checkListing(String(a.app ?? ""), { fetch, kb: knowledgeBase() });
      } catch (e) {
        throw new ToolError(e instanceof Error ? e.message : String(e));
      }
      const mark = { ok: "✓", warn: "!", error: "✗", info: "i" } as const;
      const lines = report.findings.map((f) => `${mark[f.level]} ${f.title}${f.detail ? ` (${f.detail})` : ""}${f.level !== "ok" && f.fix ? `\n    ${f.fix}` : ""}`);
      return { text: `${report.app.title} by ${report.app.seller}\n${lines.join("\n")}\n\n${report.passed} of ${report.total} checks pass.`, data: report as unknown as Json };
    },
  },
  {
    name: "migrate",
    title: "Migrate shelfready.yaml",
    description: `Update shelfready.yaml to the current schema (v${CURRENT_VERSION}), keeping comments and wording. dryRun: true shows the changes without writing.`,
    inputSchema: { type: "object", properties: { ...pathProp, dryRun: bool("Show what would change without writing.") } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (a) => {
      const file = join(repo(a), "shelfready.yaml");
      if (!existsSync(file)) throw new ToolError(`No shelfready.yaml in ${repo(a)}.`);
      let r;
      try {
        r = migrateFile(file);
      } catch (e) {
        throw new ToolError(e instanceof Error ? e.message : String(e));
      }
      if (r.from === r.to) return { text: `shelfready.yaml is already schema v${r.to}.`, data: { from: r.from, to: r.to, notes: [], written: false } };
      const write = a.dryRun !== true;
      if (write) writeFileSync(file, r.text);
      return { text: [`v${r.from} → v${r.to}`, ...r.notes, write ? `Wrote ${file}.` : "(dry run, nothing written)"].join("\n"), data: { from: r.from, to: r.to, notes: r.notes, written: write } };
    },
  },
];

interface Request {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Json;
}

/** Handle one JSON-RPC message. Returns the response, or undefined for notifications. */
export async function handle(msg: Request): Promise<Json | undefined> {
  const isRequest = msg.id !== undefined && msg.id !== null;
  const reply = (result: Json) => ({ jsonrpc: "2.0", id: msg.id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
  if (msg?.jsonrpc !== "2.0" || typeof msg.method !== "string") return isRequest ? fail(-32600, "Invalid request") : undefined;
  if (!isRequest) return undefined; // notifications/initialized, notifications/cancelled, …

  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "shelfready", title: "ShelfReady", version: VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS.map(({ run: _run, ...t }) => t) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return fail(-32602, `Unknown tool: ${String(msg.params?.name)}`);
      const args = (msg.params?.arguments ?? {}) as Json;
      try {
        const { text, data } = await tool.run(args);
        return reply({ content: [{ type: "text", text }], structuredContent: data });
      } catch (e) {
        const message = e instanceof ToolError || e instanceof Error ? e.message : String(e);
        return reply({ content: [{ type: "text", text: message }], isError: true });
      }
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

/** Serve MCP over stdio: one JSON-RPC message per line. Only protocol messages go to stdout. */
export async function serveStdio(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<void> {
  // Anything a dependency logs must not corrupt the protocol stream.
  console.log = console.info = (...args: unknown[]) => console.error(...args);
  const send = (m: unknown) => output.write(JSON.stringify(m) + "\n");
  const rl = createInterface({ input, crlfDelay: Infinity });
  const pending = new Set<Promise<void>>();
  for await (const line of rl) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    const p = (async () => {
      if (Array.isArray(parsed)) {
        const out = (await Promise.all(parsed.map((m) => handle(m as Request)))).filter(Boolean);
        if (out.length) send(out);
      } else {
        const out = await handle(parsed as Request);
        if (out) send(out);
      }
    })();
    pending.add(p);
    void p.finally(() => pending.delete(p));
  }
  await Promise.all(pending);
}
