import {
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { HOLDS_DIR, ensureDirs } from "./paths.js";

export type HoldType = "manual" | "session" | "tool";

export interface Hold {
  type: HoldType;
  id: string;
  createdAt: number;
  refreshedAt: number;
}

/**
 * How long a hold of each type survives without being refreshed.
 * - manual: forever (until explicitly removed)
 * - session: a Claude Code session that goes silent is released after 30 min
 * - tool: a single tool call can run for a long time with no events, so it gets
 *   a generous ceiling that also bounds leakage if Claude Code crashes mid-call
 */
const TTL_BY_TYPE: Record<HoldType, number> = {
  manual: Infinity,
  session: 30 * 60_000,
  tool: 6 * 60 * 60_000,
};

function holdPath(type: HoldType, id: string): string {
  const encoded = Buffer.from(id, "utf8").toString("base64url");
  return join(HOLDS_DIR, `${type}__${encoded}.json`);
}

export function addHold(type: HoldType, id: string, now = Date.now()): void {
  ensureDirs();
  const path = holdPath(type, id);
  let createdAt = now;
  if (existsSync(path)) {
    try {
      createdAt = (JSON.parse(readFileSync(path, "utf8")) as Hold).createdAt;
    } catch {
      // corrupt file — treat as new
    }
  }
  const hold: Hold = { type, id, createdAt, refreshedAt: now };
  writeFileSync(path, JSON.stringify(hold));
}

export function removeHold(type: HoldType, id: string): void {
  try {
    unlinkSync(holdPath(type, id));
  } catch {
    // already gone
  }
}

export function removeHoldsByPrefix(type: HoldType, idPrefix: string): void {
  for (const hold of listHolds()) {
    if (hold.type === type && hold.id.startsWith(idPrefix)) {
      removeHold(hold.type, hold.id);
    }
  }
}

export function listHolds(): Hold[] {
  let files: string[];
  try {
    files = readdirSync(HOLDS_DIR);
  } catch {
    return [];
  }
  const holds: Hold[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const hold = JSON.parse(
        readFileSync(join(HOLDS_DIR, file), "utf8"),
      ) as Hold;
      if (hold && hold.type && typeof hold.refreshedAt === "number") {
        holds.push(hold);
      }
    } catch {
      // skip unreadable hold
    }
  }
  return holds;
}

export function isExpired(hold: Hold, now = Date.now()): boolean {
  const ttl = TTL_BY_TYPE[hold.type] ?? 0;
  return now - hold.refreshedAt > ttl;
}

/** Delete expired holds. Returns the holds that were removed. */
export function reap(now = Date.now()): Hold[] {
  const removed: Hold[] = [];
  for (const hold of listHolds()) {
    if (isExpired(hold, now)) {
      removeHold(hold.type, hold.id);
      removed.push(hold);
    }
  }
  return removed;
}

/** The machine should stay awake iff at least one live hold exists. */
export function shouldInhibit(holds: Hold[], now = Date.now()): boolean {
  return holds.some((hold) => !isExpired(hold, now));
}

/** A human-friendly reason for the current state, for status output and the tray. */
export function activeReason(
  holds: Hold[],
  now = Date.now(),
): "manual" | "claude" | null {
  const live = holds.filter((hold) => !isExpired(hold, now));
  if (live.length === 0) return null;
  if (live.some((hold) => hold.type === "manual")) return "manual";
  return "claude";
}
