import { test } from "node:test";
import assert from "node:assert/strict";
import { distanceM, evaluateAttendance, type AttSite } from "./attendance.ts";

const SITE: AttSite[] = [{ id: "s1", lat: 24.7136, lng: 46.6753, radius_m: 100, max_accuracy_m: 100 }];
const ev = (lat: number, o: { acc?: number; now?: string; wd?: number; last?: { atLocal: string; lat: number; lng: number } } = {}) =>
  evaluateAttendance({ lat, lng: 46.6753, accuracy: o.acc ?? 20, sites: SITE, kind: "IN", nowLocal: o.now ?? "2026-10-11T08:30", weekday: o.wd ?? 0,
    workStart: "08:00", graceMinutes: 15, workDays: [0, 1, 2, 3, 4], last: o.last ?? null });

test("attendance evaluation (same cases as test_attendance.py)", () => {
  assert.equal(Math.round(distanceM(24.7136, 46.6753, 24.7138, 46.6753)), 22);
  const r = ev(24.714);
  assert.deepEqual([r.status, r.distance_m, r.late_minutes], ["ACCEPTED", 44, 15]);
  assert.equal(ev(24.72).reason, "OUTSIDE");
  assert.equal(ev(24.714, { acc: 150 }).reason, "LOW_ACCURACY");
  const edge = ev(24.71465, { acc: 40 });
  assert.deepEqual([edge.status, edge.flags], ["ACCEPTED", ["FAR_ACCURACY"]]);
  assert.ok(ev(24.714, { now: "2026-10-09T08:00", wd: 5 }).flags.includes("OFF_DAY"));
  assert.equal(ev(24.714, { now: "2026-10-11T08:10" }).late_minutes, 0);
  assert.ok(ev(24.714, { last: { atLocal: "2026-10-11T08:25", lat: 21.4858, lng: 39.1925 } }).flags.includes("IMPOSSIBLE_TRAVEL"));
});
