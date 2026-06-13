#!/usr/bin/env node
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  addHold,
  removeHold,
  removeHoldsByPrefix,
  listHolds,
  type HoldType,
} from "./core/holds.js";
import {
  writeConfig,
  readConfig,
  readStatus,
  daemonRunning,
  readPid,
  isAlive,
} from "./core/state.js";
import { runDaemon } from "./daemon.js";
import { installHooks, uninstallHooks } from "./hooks/install.js";

const CLI_PATH = fileURLToPath(import.meta.url);

function ensureDaemon(): void {
  if (daemonRunning()) return;
  const child = spawn(process.execPath, [CLI_PATH, "start", "--no-tray"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function nudgeDaemon(): void {
  const pid = readPid();
  if (pid && isAlive(pid)) {
    try {
      process.kill(pid, "SIGHUP");
    } catch {
      // best effort
    }
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

function printStatus(): void {
  const status = readStatus();
  const pid = readPid();
  const running = pid !== null && isAlive(pid);
  if (!status) {
    console.log(
      `Preventio: daemon ${running ? "running" : "not running"}, ${
        listHolds().length
      } hold(s).`,
    );
    return;
  }
  console.log(
    `Preventio: ${status.inhibiting ? "AWAKE" : "idle (sleep allowed)"}${
      status.reason ? ` — ${status.reason}` : ""
    }`,
  );
  console.log(`  daemon:        ${running ? `running (pid ${pid})` : "stopped"}`);
  console.log(`  keep screen:   ${status.keepDisplay ? "on" : "off"}`);
  console.log(`  active holds:  ${status.holdCount}`);
  for (const h of status.holds) {
    console.log(`    - ${h.type}: ${h.id}`);
  }
}

async function handleHook(event: string | undefined): Promise<void> {
  const raw = await readStdin();
  let data: { session_id?: string; tool_name?: string } = {};
  try {
    data = JSON.parse(raw);
  } catch {
    // hook may be invoked without payload; fall through with defaults
  }
  const session = data.session_id ?? "unknown";
  const tool = data.tool_name ?? "tool";

  switch (event) {
    case "SessionStart":
    case "UserPromptSubmit":
    case "Stop":
      addHold("session", session);
      ensureDaemon();
      break;
    case "PreToolUse":
      addHold("tool", `${session}:${tool}`);
      ensureDaemon();
      break;
    case "PostToolUse":
      removeHold("tool", `${session}:${tool}`);
      break;
    case "SessionEnd":
      removeHold("session", session);
      removeHoldsByPrefix("tool", `${session}:`);
      break;
  }
  process.exit(0);
}

function help(): void {
  console.log(`Preventio — keep your machine awake.

Usage:
  preventio start [--no-tray]   Start the daemon (with menu-bar tray by default)
  preventio on                  Keep awake now (manual hold)
  preventio off                 Release the manual hold
  preventio status              Show current state
  preventio keepdisplay on|off  Also keep the screen on (or not)
  preventio install-hooks       Auto-keep-awake while Claude Code runs
  preventio uninstall-hooks     Remove the Claude Code hooks

Low-level (used by hooks):
  preventio hold add|remove --type <session|tool> --id <id>
  preventio hook <EventName>    Reads hook JSON from stdin`);
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      "no-tray": { type: "boolean" },
      type: { type: "string" },
      id: { type: "string" },
    },
  });
  const [command, sub] = positionals;

  switch (command) {
    case "start":
      await runDaemon({ withTray: !values["no-tray"] });
      break;
    case "on":
      addHold("manual", "manual");
      ensureDaemon();
      console.log("Keep-awake ON (manual).");
      break;
    case "off":
      removeHold("manual", "manual");
      nudgeDaemon();
      console.log("Manual hold released.");
      break;
    case "status":
      printStatus();
      break;
    case "keepdisplay": {
      const enabled = sub === "on";
      writeConfig({ ...readConfig(), keepDisplay: enabled });
      ensureDaemon();
      nudgeDaemon();
      console.log(`Keep screen on: ${enabled ? "on" : "off"}.`);
      break;
    }
    case "hold": {
      const type = values.type as HoldType | undefined;
      const id = values.id;
      if (!type || !id) {
        console.error("hold requires --type and --id");
        process.exit(1);
      }
      if (sub === "add") {
        addHold(type, id);
        ensureDaemon();
      } else if (sub === "remove") {
        removeHold(type, id);
      } else {
        console.error("hold expects 'add' or 'remove'");
        process.exit(1);
      }
      break;
    }
    case "hook":
      await handleHook(sub);
      break;
    case "install-hooks":
      installHooks(CLI_PATH);
      break;
    case "uninstall-hooks":
      uninstallHooks();
      break;
    default:
      help();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
