// Runs `shelf mcp` as a real subprocess and talks to it with the official MCP SDK client,
// so the hand-rolled server is checked against the reference implementation.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "plist";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const cliDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let root: string;
let client: Client;

type Result = { content: { type: string; text: string }[]; structuredContent?: Record<string, any>; isError?: boolean };
const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: { path: root, ...args } })) as Result;

before(async () => {
  root = mkdtempSync(join(tmpdir(), "shelf-mcp-"));
  mkdirSync(join(root, "App.xcodeproj"));
  writeFileSync(
    join(root, "App.xcodeproj/project.pbxproj"),
    `PRODUCT_BUNDLE_IDENTIFIER = com.example.notes;\nINFOPLIST_KEY_CFBundleDisplayName = Notes;\nINFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO;\n`,
  );
  mkdirSync(join(root, "App"));
  writeFileSync(
    join(root, "App/PrivacyInfo.xcprivacy"),
    build({
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyCollectedDataTypes: [],
      NSPrivacyAccessedAPITypes: [{ NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults", NSPrivacyAccessedAPITypeReasons: ["CA92.1"] }],
    } as never),
  );
  client = new Client({ name: "shelfready-test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", join(cliDir, "src/cli.ts"), "mcp"], cwd: cliDir, stderr: "pipe" }));
});

after(async () => {
  await client?.close();
  rmSync(root, { recursive: true, force: true });
});

test("mcp: handshake, server info and instructions", () => {
  assert.equal(client.getServerVersion()?.name, "shelfready");
  assert.match(client.getInstructions() ?? "", /shelfready\.yaml/);
  assert.ok(client.getServerCapabilities()?.tools);
});

test("mcp: lists every tool with a schema and annotations", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["app_privacy", "check", "checklist", "init", "listing", "migrate", "pages", "scan", "sdk_info", "tick"]);
  for (const t of tools) {
    assert.equal(t.inputSchema.type, "object", t.name);
    assert.ok(t.description && t.description.length > 40, t.name);
    assert.equal(typeof t.annotations?.readOnlyHint, "boolean", t.name);
  }
});

test("mcp: the go-live flow from scan to checklist", async () => {
  const s = await call("scan");
  assert.deepEqual(s.structuredContent?.bundleIdentifiers, ["com.example.notes"]);

  const noFile = await call("check");
  assert.equal(noFile.isError, true);
  assert.match(noFile.content[0]!.text, /init/);

  const init = await call("init", { country: "DE", email: "hi@example.com", brand: "Example", voice: "I", baseUrl: "https://example.com/notes/", agentsNote: true });
  assert.match(readFileSync(join(root, "AGENTS.md"), "utf8"), /shelfready check/);
  assert.equal(init.isError, undefined, init.content[0]?.text);
  assert.ok(existsSync(join(root, "shelfready.yaml")));
  assert.equal((await call("init", { country: "DE", email: "x@example.com" })).isError, true, "refuses to overwrite");

  const c = await call("check");
  assert.equal(c.structuredContent?.errors, 0, c.content[0]!.text);

  const preview = await call("pages", { write: false });
  assert.deepEqual(preview.structuredContent?.written, []);
  assert.ok(!existsSync(join(root, "shelfready/pages")));
  assert.match(preview.content[0]!.text, /privacy/i);

  const pages = await call("pages", { swiftui: "App/LegalView.swift" });
  assert.ok(existsSync(join(root, "shelfready/pages/privacy.md")));
  assert.ok(existsSync(join(root, "shelfready/pages/impressum.md")), "DE needs an Impressum");
  assert.match(readFileSync(join(root, "App/LegalView.swift"), "utf8"), /struct LegalView/);
  assert.equal(pages.isError, undefined);

  const escape = await call("pages", { out: "../outside" });
  assert.equal(escape.isError, true);
  assert.match(escape.content[0]!.text, /outside the repository/);

  const privacy = await call("app_privacy", { write: "fastlane/app_privacy_details.json" });
  assert.match(privacy.content[0]!.text, /Data Not Collected/);
  assert.ok(existsSync(join(root, "fastlane/app_privacy_details.json")));

  const tick = await call("tick", { ids: ["trademark"] });
  assert.equal(tick.isError, undefined, tick.content[0]?.text);
  assert.match(readFileSync(join(root, "shelfready.yaml"), "utf8"), /trademark: "?\d{4}-\d{2}-\d{2}/);
  const auto = await call("tick", { ids: ["privacy-manifest"] });
  assert.equal(auto.isError, true, "automatic items can't be ticked");

  const list = await call("checklist");
  const items = list.structuredContent?.items as { id: string; status: string }[];
  assert.equal(items.find((i) => i.id === "trademark")?.status, "done");
  assert.equal(items.find((i) => i.id === "privacy-manifest")?.status, "done");

  assert.match((await call("migrate")).content[0]!.text, /already schema/);
});

test("mcp: sdk_info lists and looks up the knowledge base", async () => {
  const all = await client.callTool({ name: "sdk_info", arguments: {} }) as Result;
  assert.ok((all.structuredContent?.sdks as unknown[]).length >= 20);
  const sentry = await client.callTool({ name: "sdk_info", arguments: { name: "sentry-cocoa" } }) as Result;
  assert.equal(sentry.structuredContent?.found, true);
  assert.match(sentry.content[0]!.text, /CRASH_DATA|CrashData|crash/i);
  const unknown = await client.callTool({ name: "sdk_info", arguments: { name: "nope-sdk" } }) as Result;
  assert.equal(unknown.structuredContent?.found, false);
});

test("mcp: unknown tool is a protocol error", async () => {
  await assert.rejects(client.callTool({ name: "nope", arguments: {} }), /Unknown tool/);
});

test("plugin: version and MCP pin match the npm package", () => {
  const pkg = JSON.parse(readFileSync(join(cliDir, "package.json"), "utf8")).version;
  const plugin = JSON.parse(readFileSync(join(cliDir, "../plugin/.claude-plugin/plugin.json"), "utf8")).version;
  const args: string[] = JSON.parse(readFileSync(join(cliDir, "../plugin/.mcp.json"), "utf8")).mcpServers.shelfready.args;
  assert.equal(plugin, pkg, "plugin/.claude-plugin/plugin.json version");
  assert.ok(args.includes(`shelfready@${pkg}`), `plugin/.mcp.json should run shelfready@${pkg}, has ${args.join(" ")}`);
  const server = JSON.parse(readFileSync(join(cliDir, "../server.json"), "utf8"));
  assert.equal(server.version, pkg, "server.json version");
  assert.equal(server.packages[0].version, pkg, "server.json package version");
  assert.equal(server.name, JSON.parse(readFileSync(join(cliDir, "package.json"), "utf8")).mcpName, "server.json name = package.json mcpName");
  assert.ok(server.description.length <= 100, "MCP registry descriptions are limited to 100 characters");
});
