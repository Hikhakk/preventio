import {
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { CONFIG_FILE, STATUS_FILE, PID_FILE, ensureDirs } from "./paths.js";

export interface Config {
  keepDisplay: boolean;
}

export interface Status {
  inhibiting: boolean;
  reason: "manual" | "claude" | null;
  keepDisplay: boolean;
  holdCount: number;
  holds: { type: string; id: string }[];
  updatedAt: number;
  pid: number;
}

export function readConfig(): Config {
  try {
    const cfg = JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Partial<Config>;
    return { keepDisplay: Boolean(cfg.keepDisplay) };
  } catch {
    return { keepDisplay: false };
  }
}

export function writeConfig(config: Config): void {
  ensureDirs();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function readStatus(): Status | null {
  try {
    return JSON.parse(readFileSync(STATUS_FILE, "utf8")) as Status;
  } catch {
    return null;
  }
}

export function writeStatus(status: Status): void {
  ensureDirs();
  writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
}

export function readPid(): number | null {
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function writePid(pid: number): void {
  ensureDirs();
  writeFileSync(PID_FILE, String(pid));
}

export function removePid(): void {
  try {
    unlinkSync(PID_FILE);
  } catch {
    // already gone
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Is a daemon already running (and not this process)? */
export function daemonRunning(): boolean {
  const pid = readPid();
  return pid !== null && pid !== process.pid && isAlive(pid);
}

export { existsSync };
