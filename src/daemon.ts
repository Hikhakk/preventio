import { watch, FSWatcher } from "node:fs";
import { Inhibitor } from "./core/inhibitor.js";
import {
  listHolds,
  reap,
  shouldInhibit,
  activeReason,
  addHold,
  removeHold,
} from "./core/holds.js";
import {
  readConfig,
  writeConfig,
  writeStatus,
  writePid,
  removePid,
  daemonRunning,
} from "./core/state.js";
import { HOLDS_DIR, CONFIG_FILE, ensureDirs } from "./core/paths.js";
import { initTray, type TrayHandle } from "./tray.js";

export async function runDaemon({
  withTray,
}: {
  withTray: boolean;
}): Promise<void> {
  if (daemonRunning()) {
    console.error("[preventio] daemon already running");
    return;
  }
  ensureDirs();
  writePid(process.pid);

  // A misbehaving tray must never take the daemon down with it.
  process.on("unhandledRejection", (err) =>
    console.error(`[preventio] unhandled rejection: ${String(err)}`),
  );

  const inhibitor = new Inhibitor();
  let tray: TrayHandle | null = null;

  let debounce: NodeJS.Timeout | null = null;
  const scheduleRecompute = () => {
    if (debounce) return;
    debounce = setTimeout(() => {
      debounce = null;
      recompute();
    }, 100);
  };

  function recompute() {
    const now = Date.now();
    reap(now);
    const holds = listHolds();
    const cfg = readConfig();
    const inhibit = shouldInhibit(holds, now);
    inhibitor.apply(inhibit, cfg.keepDisplay);
    const status = {
      inhibiting: inhibit,
      reason: activeReason(holds, now),
      keepDisplay: cfg.keepDisplay,
      holdCount: holds.length,
      holds: holds.map((h) => ({ type: h.type, id: h.id })),
      updatedAt: now,
      pid: process.pid,
    };
    writeStatus(status);
    tray?.render(status);
  }

  const watchers: FSWatcher[] = [];
  try {
    watchers.push(watch(HOLDS_DIR, scheduleRecompute));
  } catch {
    // fall back to the interval below
  }
  try {
    watchers.push(watch(CONFIG_FILE, scheduleRecompute));
  } catch {
    // config file may not exist yet; interval + SIGHUP cover it
  }

  const interval = setInterval(recompute, 60_000);

  let shuttingDown = false;
  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(interval);
    if (debounce) clearTimeout(debounce);
    for (const w of watchers) {
      try {
        w.close();
      } catch {
        // ignore
      }
    }
    inhibitor.stop();
    tray?.destroy();
    removePid();
    process.exit(0);
  }

  if (withTray) {
    tray = await initTray({
      onToggleManual: () => {
        const hasManual = listHolds().some((h) => h.type === "manual");
        if (hasManual) removeHold("manual", "manual");
        else addHold("manual", "manual");
        recompute();
      },
      onToggleDisplay: () => {
        writeConfig({ keepDisplay: !readConfig().keepDisplay });
        recompute();
      },
      onQuit: shutdown,
    });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGHUP", recompute);

  recompute();
  console.error(
    `[preventio] daemon started (pid ${process.pid}, ${
      tray ? "tray" : "headless"
    })`,
  );

  // Keep the process alive (the interval already does this; this is belt-and-suspenders).
  await new Promise<never>(() => {});
}
