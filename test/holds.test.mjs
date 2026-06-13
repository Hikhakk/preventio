import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Redirect the state dir into a throwaway HOME before importing the module.
const tmp = mkdtempSync(join(tmpdir(), "preventio-test-"));
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;

const {
  addHold,
  removeHold,
  removeHoldsByPrefix,
  listHolds,
  reap,
  isExpired,
  shouldInhibit,
  activeReason,
} = await import("../dist/core/holds.js");

const MIN = 60_000;

test("add/remove a manual hold flips shouldInhibit", () => {
  const now = 1_000_000;
  assert.equal(shouldInhibit(listHolds(), now), false);

  addHold("manual", "manual", now);
  assert.equal(listHolds().length, 1);
  assert.equal(shouldInhibit(listHolds(), now), true);
  assert.equal(activeReason(listHolds(), now), "manual");

  removeHold("manual", "manual");
  assert.equal(listHolds().length, 0);
  assert.equal(shouldInhibit(listHolds(), now), false);
  assert.equal(activeReason(listHolds(), now), null);
});

test("session leases expire after 30 minutes and are reaped", () => {
  const t0 = 2_000_000;
  addHold("session", "s1", t0);

  assert.equal(isExpired(listHolds()[0], t0 + 29 * MIN), false);
  assert.equal(isExpired(listHolds()[0], t0 + 31 * MIN), true);
  assert.equal(activeReason(listHolds(), t0 + 5 * MIN), "claude");

  reap(t0 + 31 * MIN);
  assert.equal(listHolds().length, 0);
});

test("tool holds survive long runs but can be removed explicitly", () => {
  const t0 = 3_000_000;
  addHold("tool", "s2:Bash", t0);

  // Still active an hour into a long, input-less tool call.
  assert.equal(shouldInhibit(listHolds(), t0 + 60 * MIN), true);
  reap(t0 + 60 * MIN);
  assert.equal(listHolds().length, 1);

  removeHold("tool", "s2:Bash");
  assert.equal(listHolds().length, 0);
});

test("removeHoldsByPrefix clears a session's tool holds", () => {
  const t0 = 4_000_000;
  addHold("tool", "sess:Bash", t0);
  addHold("tool", "sess:Read", t0);
  addHold("tool", "other:Bash", t0);

  removeHoldsByPrefix("tool", "sess:");
  const ids = listHolds().map((h) => h.id);
  assert.deepEqual(ids, ["other:Bash"]);

  removeHold("tool", "other:Bash");
  assert.equal(listHolds().length, 0);
});
