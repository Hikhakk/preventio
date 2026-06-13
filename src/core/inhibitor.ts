import { spawn, ChildProcess } from "node:child_process";

/**
 * Owns at most one OS-level "stay awake" child process. Call `apply` with the
 * desired state; the engine starts, stops, or restarts the child as needed.
 *
 *   macOS   -> caffeinate (-i prevent idle sleep, -d also keep display on)
 *   Windows -> PowerShell calling SetThreadExecutionState; the flag is cleared
 *              automatically when the process exits (i.e. when we kill it)
 *   Linux   -> systemd-inhibit blocking sleep/idle while a child sleeps forever
 */
export class Inhibitor {
  private child: ChildProcess | null = null;
  private activeKeepDisplay = false;

  apply(shouldInhibit: boolean, keepDisplay: boolean): void {
    if (!shouldInhibit) {
      this.stop();
      return;
    }
    if (this.child && this.activeKeepDisplay === keepDisplay) return; // already correct
    this.stop();
    this.start(keepDisplay);
  }

  stop(): void {
    if (!this.child) return;
    try {
      this.child.kill();
    } catch {
      // ignore
    }
    this.child = null;
  }

  private start(keepDisplay: boolean): void {
    const [cmd, args] = this.command(keepDisplay);
    try {
      const child = spawn(cmd, args, { stdio: "ignore" });
      child.on("error", (err) => {
        console.error(`[preventio] failed to start "${cmd}": ${err.message}`);
        if (this.child === child) this.child = null;
      });
      child.on("exit", () => {
        if (this.child === child) this.child = null;
      });
      this.child = child;
      this.activeKeepDisplay = keepDisplay;
    } catch (err) {
      console.error(`[preventio] could not inhibit sleep: ${String(err)}`);
    }
  }

  private command(keepDisplay: boolean): [string, string[]] {
    switch (process.platform) {
      case "darwin":
        // -i: prevent idle sleep, -m: prevent disk idle, -w: tie lifetime to us
        return [
          "caffeinate",
          [
            "-i",
            "-m",
            ...(keepDisplay ? ["-d"] : []),
            "-w",
            String(process.pid),
          ],
        ];
      case "win32": {
        const ES_CONTINUOUS = 0x80000000;
        const ES_SYSTEM_REQUIRED = 0x00000001;
        const ES_DISPLAY_REQUIRED = 0x00000002;
        let flags = ES_CONTINUOUS | ES_SYSTEM_REQUIRED;
        if (keepDisplay) flags |= ES_DISPLAY_REQUIRED;
        const script =
          "Add-Type -Name P -Namespace W -MemberDefinition " +
          "'[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint e);'; " +
          `[W.P]::SetThreadExecutionState([uint32]${flags >>> 0}); ` +
          "while ($true) { Start-Sleep -Seconds 3600 }";
        return [
          "powershell",
          ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
        ];
      }
      default:
        // Linux and other systemd-based systems
        return [
          "systemd-inhibit",
          [
            "--what=sleep:idle",
            "--who=preventio",
            "--why=Preventio keep-awake",
            "--mode=block",
            "sleep",
            "infinity",
          ],
        ];
    }
  }
}
