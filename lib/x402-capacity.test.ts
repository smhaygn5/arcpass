import assert from "node:assert/strict";
import test from "node:test";
import { createKeyedTaskQueue } from "./x402-capacity.ts";

test("serializes capacity work for one resource without blocking another resource", async () => {
  const runExclusive = createKeyedTaskQueue();
  const timeline: string[] = [];

  await Promise.all([
    runExclusive("xres_first", async () => {
      timeline.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 15));
      timeline.push("first:end");
    }),
    runExclusive("xres_first", async () => {
      timeline.push("second:start");
      timeline.push("second:end");
    }),
    runExclusive("xres_other", async () => {
      timeline.push("other:start");
      timeline.push("other:end");
    }),
  ]);

  assert.ok(timeline.indexOf("second:start") > timeline.indexOf("first:end"));
  assert.ok(timeline.indexOf("other:start") < timeline.indexOf("first:end"));
});
