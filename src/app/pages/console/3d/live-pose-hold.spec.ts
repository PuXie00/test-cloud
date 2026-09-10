import { afterEach, describe, expect, it } from "vitest";
import { getLivePoseHold, setLivePoseHold, subscribeLivePoseHold } from "./live-pose-hold";

afterEach(() => {
  setLivePoseHold(false);
});

describe("live-pose-hold", () => {
  it("notifies subscribers when the hold flag changes", () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeLivePoseHold(() => {
      seen.push(getLivePoseHold());
    });
    setLivePoseHold(true);
    setLivePoseHold(true);
    setLivePoseHold(false);
    unsubscribe();
    expect(seen).toEqual([true, false]);
  });
});
