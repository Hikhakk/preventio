import { trayIcon } from "./core/icon.js";
import type { Status } from "./core/state.js";

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
    SysTray = mod.default ?? mod;
  } catch (err) {
    console.error(`[preventio] tray unavailable (systray2 not loaded): ${String(err)}`);
    return null;
  }

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
      systray.sendAction({ type: "update-item", item, seq_id: index });
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
