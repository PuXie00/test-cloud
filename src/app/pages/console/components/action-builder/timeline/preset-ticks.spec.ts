import { expect, it } from "vitest";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import { createDefaultAxisProfiles } from "@/app/project/action-sequence/motion-profile";
import { visibleGeneratedAtMs } from "./preset-ticks";

it("omits wave boundary holds from generated ticks", () => {
  const resolved = resolveActionSequence({
    id: 1,
    name: "Seq",
    trajectoryMode: false,
    blocks: [
      {
        id: "wave-1",
        kind: "dynamic-preset",
        presetId: "dynamic-wave",
        startMs: 1000,
        endMs: 3000,
        orderedObjectIds: [7, 8],
        params: { baseV1: 1000, amplitude: 500, cycles: 1, direction: 1, staggerMs: 500 },
        profiles: createDefaultAxisProfiles(750),
      },
    ],
    segments: [],
  });
  expect(visibleGeneratedAtMs(resolved.poses, 7, "wave-1")).toEqual([1000, 1750, 2500]);
  expect(visibleGeneratedAtMs(resolved.poses, 8, "wave-1")).toEqual([1500, 2250, 3000]);
});
