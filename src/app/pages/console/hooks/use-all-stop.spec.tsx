// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAllStop } from "./use-all-stop";

const { emergencyStopAll, clearAll, resetAllSlots, allStopAll } = vi.hoisted(() => ({
  emergencyStopAll: vi.fn(),
  clearAll: vi.fn(),
  resetAllSlots: vi.fn(),
  allStopAll: vi.fn<() => Promise<boolean>>(),
}));

vi.mock("./use-exec-cards", () => ({ useExecCardActions: () => ({ emergencyStopAll, clearAll }) }));
vi.mock("./use-executor-slots", () => ({ useExecutorSlotActions: () => ({ resetAllSlots }) }));
vi.mock("./plc-runtime-provider", () => ({ usePlcRuntime: () => ({ allStopAll }) }));

afterEach(() => vi.clearAllMocks());

const pressAllStop = async () => {
  const { result } = renderHook(() => useAllStop());
  await act(async () => {
    result.current();
  });
};

describe("useAllStop", () => {
  it("clears the task cards and every fader slot once the PLC accepts the all-stop", async () => {
    allStopAll.mockResolvedValue(true);
    await pressAllStop();
    expect(emergencyStopAll).toHaveBeenCalledTimes(1);
    expect(allStopAll).toHaveBeenCalledTimes(1);
    expect(clearAll).toHaveBeenCalledTimes(1);
    expect(resetAllSlots).toHaveBeenCalledTimes(1);
  });

  it("keeps the cards and slots when the all-stop fails", async () => {
    allStopAll.mockResolvedValue(false);
    await pressAllStop();
    expect(emergencyStopAll).toHaveBeenCalledTimes(1);
    expect(clearAll).not.toHaveBeenCalled();
    expect(resetAllSlots).not.toHaveBeenCalled();
  });
});
