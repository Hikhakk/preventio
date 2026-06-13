import { createRequire } from "node:module";
import { chmodSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { trayIcon } from "./core/icon.js";
import type { Status } from "./core/state.js";

/**
 * systray2 ships its Go helper binaries without the execute bit, and the copy
 * it places in ~/.cache inherits that — so the very first launch fails with
 * EACCES. Make the relevant binaries executable before we start the tray.
 */
function ensureTrayBinaryExecutable(): void {
  if (process.platform === "win32") return; // .exe needs no chmod
  const bin =
    process.platform === "darwin"
      ? "tray_darwin_release"
      : "tray_linux_release";
  const chmod = (file: string) => {
    try {
      if (existsSync(file)) chmodSync(file, 0o755);
    } catch {
      // best effort
    }
  };
  try {
    const require = createRequire(import.meta.url);
    const pkgDir = dirname(require.resolve("systray2/package.json"));
    chmod(join(pkgDir, "traybin", bin));
  } catch {
    // systray2 not resolvable from here
  }
  try {
    const cacheRoot = join(homedir(), ".cache", "node-systray");
    for (const version of readdirSync(cacheRoot)) {
      chmod(join(cacheRoot, version, bin));
    }
  } catch {
    // no cache dir yet
  }
}

export interface TrayHandlers {
  onToggleManual(): void;
  onToggleDisplay(): void;
  onQuit(): void;
}

export interface TrayHandle {
  render(status: Status): void;
  destroy(): void;
}

const IDX_STATUS = 0;
const IDX_MANUAL = 1;
const IDX_DISPLAY = 2;
const IDX_QUIT = 4; // index 3 is the separator

function statusTitle(status: Status): string {
  if (!status.inhibiting) return "Idle — sleep allowed";
  if (status.reason === "manual") return "Awake — manual";
  return "Awake — Claude Code";
}

/**
 * Start the menu-bar / system-tray icon. Returns null (and logs) if the tray
 * can't be created — the daemon then keeps running headless.
 */
export async function initTray(
  handlers: TrayHandlers,
): Promise<TrayHandle | null> {
  let SysTray: any;
  try {
    const mod: any = await import("systray2");
    // systray2 is CJS compiled from `export default`, so under ESM the class
    // lands at mod.default.default; fall back through the other shapes.
    SysTray = mod.default?.default ?? mod.default ?? mod;
  } catch (err) {
    console.error(`[preventio] tray unavailable (systray2 not loaded): ${String(err)}`);
    return null;
  }

  ensureTrayBinaryExecutable();

  const icon = trayIcon();

  const items = [
    { title: "Idle — sleep allowed", tooltip: "", checked: false, enabled: false },
    { title: "Keep awake (manual)", tooltip: "Toggle manual keep-awake", checked: false, enabled: true },
    { title: "Also keep screen on", tooltip: "Prevent the display from sleeping too", checked: false, enabled: true },
    SysTray.separator,
    { title: "Quit", tooltip: "Stop Preventio", checked: false, enabled: true },
  ];

  let systray: any;
  try {
    systray = new SysTray({
      menu: {
        icon: icon.base64,
        isTemplateIcon: icon.isTemplate,
        title: "",
        tooltip: "Preventio",
        items,
      },
      debug: false,
      copyDir: true,
    });
  } catch (err) {
    console.error(`[preventio] tray failed to start: ${String(err)}`);
    return null;
  }

  // Wait for the helper process to come up before sending it anything.
  try {
    await Promise.race([
      systray.ready(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("tray ready timed out")), 5000),
      ),
    ]);
  } catch (err) {
    console.error(`[preventio] tray did not become ready: ${String(err)}`);
    try {
      systray.kill(false);
    } catch {
      // ignore
    }
    return null;
  }

  if (typeof systray.onError === "function") {
    systray.onError((err: unknown) =>
      console.error(`[preventio] tray error: ${String(err)}`),
    );
  }

  systray.onClick((action: any) => {
    try {
      switch (action.seq_id) {
        case IDX_MANUAL:
          handlers.onToggleManual();
          break;
        case IDX_DISPLAY:
          handlers.onToggleDisplay();
          break;
        case IDX_QUIT:
          handlers.onQuit();
          break;
      }
    } catch (err) {
      console.error(`[preventio] tray click error: ${String(err)}`);
    }
  });

  const update = (index: number, patch: Record<string, unknown>) => {
    const item = { ...items[index], ...patch };
    items[index] = item;
    try {
      const result = systray.sendAction({
        type: "update-item",
        item,
        seq_id: index,
      });
      // sendAction is async; swallow rejections so a tray hiccup never crashes us
      if (result && typeof result.catch === "function") result.catch(() => {});
    } catch {
      // tray may be shutting down
    }
  };

  return {
    render(status: Status) {
      update(IDX_STATUS, { title: statusTitle(status) });
      update(IDX_MANUAL, { checked: status.reason === "manual" });
      update(IDX_DISPLAY, { checked: status.keepDisplay });
    },
    destroy() {
      try {
        systray.kill(false);
      } catch {
        // ignore
      }
    },
  };
}
