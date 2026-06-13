import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export const PREVENTIO_DIR = join(homedir(), ".preventio");
export const HOLDS_DIR = join(PREVENTIO_DIR, "holds");
export const CONFIG_FILE = join(PREVENTIO_DIR, "config.json");
export const STATUS_FILE = join(PREVENTIO_DIR, "status.json");
export const PID_FILE = join(PREVENTIO_DIR, "daemon.pid");
export const LOG_FILE = join(PREVENTIO_DIR, "daemon.log");

export function ensureDirs(): void {
  mkdirSync(HOLDS_DIR, { recursive: true });
}
