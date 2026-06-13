import {
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { readPid, isAlive } from "./core/state.js";

const LABEL = "com.preventio.daemon";

/**
 * Stop whatever daemon is currently recorded in the pid file — including an
 * orphan one a Claude Code hook may have spawned — so the service manager can
 * own a single clean instance.
 */
function stopExistingDaemon(): void {
  const pid = readPid();
  if (pid && isAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone or not ours
    }
  }
}

/** Absolute node path, preferring a stable Homebrew symlink over a version-pinned Cellar path. */
function nodePath(): string {
  const exec = process.execPath;
  for (const prefix of ["/opt/homebrew", "/usr/local"]) {
    if (exec.startsWith(`${prefix}/Cellar/node/`)) {
      const stable = `${prefix}/bin/node`;
      try {
        realpathSync(stable);
        return stable;
      } catch {
        // symlink missing; fall through
      }
    }
  }
  return exec;
}

function run(cmd: string, args: string[]): void {
  execFileSync(cmd, args, { stdio: "ignore" });
}

// ---------- macOS (LaunchAgent) ----------

function macPlistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

function macPlist(node: string, cli: string, log: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${node}</string>
        <string>${cli}</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ProcessType</key>
    <string>Interactive</string>
    <key>StandardOutPath</key>
    <string>${log}</string>
    <key>StandardErrorPath</key>
    <string>${log}</string>
</dict>
</plist>
`;
}

function installMac(node: string, cli: string): string {
  mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
  mkdirSync(join(homedir(), ".preventio"), { recursive: true });
  const plistPath = macPlistPath();
  const log = join(homedir(), ".preventio", "daemon.log");
  writeFileSync(plistPath, macPlist(node, cli, log));

  const uid = process.getuid?.() ?? 0;
  try {
    run("launchctl", ["bootout", `gui/${uid}/${LABEL}`]);
  } catch {
    // not loaded yet
  }
  stopExistingDaemon();
  try {
    run("launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
  } catch {
    run("launchctl", ["load", "-w", plistPath]); // legacy fallback
  }
  try {
    run("launchctl", ["kickstart", "-k", `gui/${uid}/${LABEL}`]);
  } catch {
    // RunAtLoad already started it
  }
  return plistPath;
}

function uninstallMac(): void {
  const plistPath = macPlistPath();
  const uid = process.getuid?.() ?? 0;
  try {
    run("launchctl", ["bootout", `gui/${uid}/${LABEL}`]);
  } catch {
    try {
      run("launchctl", ["unload", "-w", plistPath]);
    } catch {
      // not loaded
    }
  }
  if (existsSync(plistPath)) unlinkSync(plistPath);
}

// ---------- Linux (systemd user unit) ----------

function linuxUnitPath(): string {
  return join(homedir(), ".config", "systemd", "user", "preventio.service");
}

function installLinux(node: string, cli: string): string {
  const dir = join(homedir(), ".config", "systemd", "user");
  mkdirSync(dir, { recursive: true });
  const unitPath = linuxUnitPath();
  // Headless on Linux: a systemd user service usually has no GUI session for a tray.
  writeFileSync(
    unitPath,
    `[Unit]
Description=Preventio keep-awake daemon
After=graphical-session.target

[Service]
Type=simple
ExecStart=${node} ${cli} start --no-tray
Restart=on-failure

[Install]
WantedBy=default.target
`,
  );
  stopExistingDaemon();
  run("systemctl", ["--user", "daemon-reload"]);
  run("systemctl", ["--user", "enable", "--now", "preventio.service"]);
  return unitPath;
}

function uninstallLinux(): void {
  try {
    run("systemctl", ["--user", "disable", "--now", "preventio.service"]);
  } catch {
    // not enabled
  }
  const unitPath = linuxUnitPath();
  if (existsSync(unitPath)) unlinkSync(unitPath);
  try {
    run("systemctl", ["--user", "daemon-reload"]);
  } catch {
    // ignore
  }
}

// ---------- Windows (Startup launcher) ----------

function windowsVbsPath(): string {
  const appData =
    process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  return join(
    appData,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup",
    "preventio.vbs",
  );
}

function installWindows(node: string, cli: string): string {
  const vbsPath = windowsVbsPath();
  mkdirSync(join(vbsPath, ".."), { recursive: true });
  const cmd = `"${node}" "${cli}" start`;
  const literal = `"${cmd.replace(/"/g, '""')}"`;
  writeFileSync(
    vbsPath,
    `Set s = CreateObject("WScript.Shell")\r\ns.Run ${literal}, 0, False\r\n`,
  );
  stopExistingDaemon();
  try {
    run("wscript", [vbsPath]); // start now, hidden
  } catch {
    // will start at next login regardless
  }
  return vbsPath;
}

function uninstallWindows(): void {
  const vbsPath = windowsVbsPath();
  if (existsSync(vbsPath)) unlinkSync(vbsPath);
}

// ---------- public API ----------

export function installService(cli: string): void {
  const node = nodePath();
  try {
    let path: string;
    switch (process.platform) {
      case "darwin":
        path = installMac(node, cli);
        break;
      case "linux":
        path = installLinux(node, cli);
        break;
      case "win32":
        path = installWindows(node, cli);
        break;
      default:
        console.error(`Unsupported platform: ${process.platform}`);
        process.exit(1);
    }
    console.log(`Installed Preventio to start at login.`);
    console.log(`  service file: ${path!}`);
    console.log(`  node:         ${node}`);
    console.log(`Run "preventio uninstall-service" to remove it.`);
  } catch (err) {
    console.error(`Failed to install service: ${String(err)}`);
    if (process.platform === "linux") {
      console.error(
        "A systemd user session is required (try `loginctl enable-linger $USER`).",
      );
    }
    process.exit(1);
  }
}

export function uninstallService(): void {
  switch (process.platform) {
    case "darwin":
      uninstallMac();
      break;
    case "linux":
      uninstallLinux();
      break;
    case "win32":
      uninstallWindows();
      break;
    default:
      console.error(`Unsupported platform: ${process.platform}`);
      process.exit(1);
  }
  console.log("Removed Preventio login service.");
}
