import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const SETTINGS_FILE = join(homedir(), ".claude", "settings.json");

const EVENTS_PLAIN = ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"];
const EVENTS_MATCHED = ["PreToolUse", "PostToolUse"];
const ALL_EVENTS = [...EVENTS_PLAIN, ...EVENTS_MATCHED];

type HookCommand = { type: "command"; command: string; timeout?: number };
type HookEntry = { matcher?: string; hooks: HookCommand[] };
type Settings = { hooks?: Record<string, HookEntry[]>; [k: string]: unknown };

function command(cliPath: string, event: string): string {
  return `"${process.execPath}" "${cliPath}" hook ${event}`;
}

function isOurs(entry: HookEntry): boolean {
  return (
    Array.isArray(entry?.hooks) &&
    entry.hooks.some(
      (h) =>
        typeof h?.command === "string" &&
        h.command.includes(" hook ") &&
        (h.command.includes("preventio") || h.command.includes("cli.js")),
    )
  );
}

function readSettings(): Settings {
  if (!existsSync(SETTINGS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) as Settings;
  } catch (err) {
    throw new Error(
      `Could not parse ${SETTINGS_FILE} as JSON (${String(err)}). ` +
        `Fix or remove it, then retry.`,
    );
  }
}

function writeSettings(settings: Settings): void {
  mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n");
}

export function installHooks(cliPath: string): void {
  const settings = readSettings();
  settings.hooks ??= {};
  for (const event of ALL_EVENTS) {
    const existing = Array.isArray(settings.hooks[event])
      ? settings.hooks[event]
      : [];
    const cleaned = existing.filter((e) => !isOurs(e));
    const hookCmd: HookCommand = {
      type: "command",
      command: command(cliPath, event),
      timeout: 10,
    };
    const entry: HookEntry = EVENTS_MATCHED.includes(event)
      ? { matcher: "*", hooks: [hookCmd] }
      : { hooks: [hookCmd] };
    cleaned.push(entry);
    settings.hooks[event] = cleaned;
  }
  writeSettings(settings);
  console.log(`Installed Preventio hooks into ${SETTINGS_FILE}`);
  console.log("Claude Code will now keep this machine awake during sessions.");
}

export function uninstallHooks(): void {
  const settings = readSettings();
  if (!settings.hooks) {
    console.log("No Preventio hooks found.");
    return;
  }
  for (const event of Object.keys(settings.hooks)) {
    const list = settings.hooks[event];
    if (!Array.isArray(list)) continue;
    const cleaned = list.filter((e) => !isOurs(e));
    if (cleaned.length > 0) settings.hooks[event] = cleaned;
    else delete settings.hooks[event];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  writeSettings(settings);
  console.log("Removed Preventio hooks.");
}
