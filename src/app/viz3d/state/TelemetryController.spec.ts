import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneObjectHandle } from "../objects/SceneObjectRegistry";
import type { DomLabelRenderer } from "../labels/DomLabelRenderer";
import type { TelemetrySnapshotInput } from "../types";
import { TelemetryController } from "./TelemetryController";

beforeEach(() => {
  Object.assign(globalThis, {
    document: {
      createElement: () => ({ className: "", textContent: "", dataset: {}, remove: () => undefined }),
    },
  });
});

const fakeHandle = (id: string, name: string) => ({
  id,
  getConfig: () => ({ id, name, position: { x: 0, y: 0, z: 0 } }),
  setStatus: vi.fn(),
  applyRuntimeTransform: vi.fn(),
  getLabelAnchorWorldPosition: () => ({ x: 0, y: 0, z: 0 }),
});

const snapshot = (id: string, name: string, x: number): TelemetrySnapshotInput => ({
  snapshotId: id,
  name,
  status: "running",
  deviceType: "mover",
  values: { x },
  speed: 0,
  torquePercent: 0,
});

describe("TelemetryController 同名物体", () => {
  it("两个同名物体各自收到自己的遥测", () => {
    const a = fakeHandle("1", "吊杆");
    const b = fakeHandle("2", "吊杆");
    const handles = new Map<string, ReturnType<typeof fakeHandle>>([
      ["1", a],
      ["2", b],
    ]);
    const controller = new TelemetryController(
      {
        list: () => [...handles.values()] as unknown as SceneObjectHandle[],
        get: (id) => handles.get(id) as unknown as SceneObjectHandle | undefined,
      },
      { add: vi.fn(), remove: vi.fn() } as unknown as DomLabelRenderer,
      () => undefined,
      () => undefined,
    );

    controller.applyTelemetry([snapshot("1", "吊杆", 100), snapshot("2", "吊杆", 2000)]);

    expect(a.applyRuntimeTransform).toHaveBeenCalledTimes(1);
    expect(b.applyRuntimeTransform).toHaveBeenCalledTimes(1);
    const xA = a.applyRuntimeTransform.mock.calls[0]?.[0].position.x;
    const xB = b.applyRuntimeTransform.mock.calls[0]?.[0].position.x;
    expect(xA).not.toBe(xB);

    // 只发物体 2 的遥测，只动物体 2
    controller.applyTelemetry([snapshot("2", "吊杆", 3000)]);
    expect(a.applyRuntimeTransform).toHaveBeenCalledTimes(1);
    expect(b.applyRuntimeTransform).toHaveBeenCalledTimes(2);
    controller.dispose();
  });
});
