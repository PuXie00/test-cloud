// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { ProjectProvider } from "@/app/project/project-provider";
import {
  installMemoryProjectAPI,
  uninstallMemoryProjectAPI,
} from "@/app/project/install-memory-project-api";
import { GZ_2025_RECORD } from "@/app/project/test-fixtures";
import { ProjectStoreProvider, useProjectStore } from "./use-project-store";
import { useProject } from "@/app/project/use-project";
import {
  persistTransformPayloadsBatch,
  type UpdateObjectsBatchFn,
} from "../3d/viz3d-transform-persist";
import {
  idleTransformDragSession,
  onTransformDragSettled,
  onTransformDragStart,
  shouldAbortEngineOnTransformStart,
  shouldPersistTransformDragEnd,
} from "../3d/viz3d-transform-session";
import { shouldAbortFailedTransformCommit } from "@/app/viz3d/tools/transform-commit-guard";
import type { TransformEndPayload } from "@/app/viz3d";

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    ProjectProvider,
    null,
    createElement(ProjectStoreProvider, null, children),
  );

const renderStoreAndProject = () =>
  renderHook(() => ({ store: useProjectStore(), project: useProject() }), { wrapper });

const openFixtureProject = async (
  result: ReturnType<typeof renderStoreAndProject>["result"],
) => {
  await waitFor(() => expect(result.current.project.loading).toBe(false));
  await act(async () => {
    await result.current.project.openProject(GZ_2025_RECORD.folderName);
  });
};

describe("ProjectStore document persist", () => {
  beforeEach(() => {
    installMemoryProjectAPI();
  });

  afterEach(() => {
    uninstallMemoryProjectAPI();
  });

  it("starts empty before hydration and writes new object to document", async () => {
    const { result } = renderStoreAndProject();

    await waitFor(() => expect(result.current.project.loading).toBe(false));

    await act(async () => {
      await result.current.project.openProject(GZ_2025_RECORD.folderName);
    });

    const beforeCount =
      result.current.project.currentProject?.document?.setup.controlledObjects.length ?? 0;

    await act(async () => {
      result.current.store.addObjectFromShape("cube");
      await Promise.resolve();
    });

    const after = result.current.project.currentProject?.document?.setup.controlledObjects ?? [];
    expect(after.length).toBe(beforeCount + 1);
    expect(after[after.length - 1].shapePreset).toBe("cube");
  });

  it("applies multi-point axes configuration through the store", async () => {
    const { result } = renderStoreAndProject();

    await waitFor(() => expect(result.current.project.loading).toBe(false));

    await act(async () => {
      await result.current.project.openProject(GZ_2025_RECORD.folderName);
    });

    let objectId = "";
    await act(async () => {
      result.current.store.addObjectFromShape("cube");
      const created = result.current.store.objects.at(-1);
      objectId = created?.id ?? "";
      result.current.store.updateObject(objectId, { controlType: "multiPointSwing" });
    });

    const object = result.current.store.objects.find((item) => item.id === objectId);
    expect(object?.controlType).toBe("multiPointSwing");
    expect(object?.axes.length).toBeGreaterThanOrEqual(4);

    let applyResult: { applied: boolean; reason?: string } = { applied: false };
    await act(async () => {
      applyResult = result.current.store.applyMultiPointAxesConfiguration(objectId, {
        axes: (object?.axes ?? []).map((axis, index) => ({
          ...axis,
          mount: {
            x: index % 2 === 0 ? -400 : 400,
            z: index < 2 ? -400 : 400,
          },
        })),
        safetyRadius: 1200,
        initialTiltDirection: 30,
        mountRotation: 15,
        mountLayout: { kind: "custom" },
        unbindAxisKeys: [],
        bindAxisMotors: [],
      });
      await Promise.resolve();
    });

    expect(applyResult).toEqual({ applied: true });
    expect(result.current.store.objects.find((item) => item.id === objectId)).toMatchObject({
      safetyRadius: 1200,
      initialTiltDirection: 30,
      mountRotation: 15,
    });
  });

  it("updateObject position persists without re-hydrate resetting store", async () => {
    const { result } = renderStoreAndProject();

    await waitFor(() => expect(result.current.project.loading).toBe(false));

    await act(async () => {
      await result.current.project.openProject(GZ_2025_RECORD.folderName);
    });

    const objectId =
      result.current.project.currentProject?.document?.setup.controlledObjects[0]?.id;
    expect(objectId).toBeTruthy();

    const nextPosition = { x: 10, y: 6, z: -4 };

    await act(async () => {
      result.current.store.updateObject(objectId!, { position: nextPosition });
      await Promise.resolve();
    });

    const storeObject = result.current.store.objects.find((o) => o.id === objectId);
    expect(storeObject?.position).toEqual(nextPosition);

    await waitFor(() => {
      const docObject = result.current.project.currentProject?.document?.setup.controlledObjects.find(
        (o) => o.id === objectId,
      );
      expect(docObject?.position).toEqual(nextPosition);
    });

    expect(result.current.store.objects.find((o) => o.id === objectId)?.position).toEqual(
      nextPosition,
    );
  });

  it("undoes and redoes one setup operation without self-hydration rollback", async () => {
    const { result } = renderStoreAndProject();
    await openFixtureProject(result);
    const beforeCount = result.current.store.objects.length;

    act(() => {
      result.current.store.addObjectFromShape("cube");
    });
    expect(result.current.store.objects).toHaveLength(beforeCount + 1);
    expect(result.current.project.undoLabel).toBe("新增受控物体");

    act(() => {
      result.current.project.undoProjectConfiguration();
    });
    await waitFor(() => {
      expect(result.current.store.objects).toHaveLength(beforeCount);
    });

    act(() => {
      result.current.project.redoProjectConfiguration();
    });
    await waitFor(() => {
      expect(result.current.store.objects).toHaveLength(beforeCount + 1);
    });
  });

  it("does not overwrite authoritative setup with stale local ref after history restore", async () => {
    const { result } = renderStoreAndProject();
    await openFixtureProject(result);

    const existingId = result.current.store.objects[0]?.id;
    expect(existingId).toBeTruthy();
    const beforeCount =
      result.current.project.currentProject!.document!.setup.controlledObjects.length;

    const motorId = result.current.store.motors[0]?.id;
    expect(motorId).toBeTruthy();
    act(() => {
      result.current.store.setMotorSelected(motorId!, false);
    });
    expect(result.current.store.motors.find((motor) => motor.id === motorId)?.selected).toBe(
      false,
    );

    act(() => {
      result.current.store.addObjectFromShape("cube");
    });
    const addedId = result.current.store.objects.at(-1)?.id;
    expect(addedId).toBeTruthy();
    expect(result.current.project.undoLabel).toBe("新增受控物体");

    act(() => {
      result.current.project.undoProjectConfiguration();
      // Same tick: effect has not rehydrated; patch must baseline from document.setup.
      result.current.store.updateObject(existingId!, {
        position: { x: 10, y: 20, z: 30 },
      });
    });

    const docObjects =
      result.current.project.currentProject!.document!.setup.controlledObjects;
    expect(docObjects).toHaveLength(beforeCount);
    expect(docObjects.find((object) => object.id === addedId)).toBeUndefined();
    expect(docObjects.find((object) => object.id === existingId)?.position).toEqual({
      x: 10,
      y: 20,
      z: 30,
    });
    expect(result.current.store.objects.find((object) => object.id === addedId)).toBeUndefined();
    expect(result.current.store.objects.find((object) => object.id === existingId)?.position).toEqual(
      { x: 10, y: 20, z: 30 },
    );
    // Ephemeral selection must survive authoritative re-baseline inside patchSetup.
    expect(result.current.store.motors.find((motor) => motor.id === motorId)?.selected).toBe(
      false,
    );
  });

  it("setMotorSelected does not persist selected; history only if persist normalizes", async () => {
    const { result } = renderStoreAndProject();
    await openFixtureProject(result);

    const motorId = result.current.store.motors[0]?.id;
    expect(motorId).toBeTruthy();
    expect(result.current.project.canUndo).toBe(false);

    // Warm persist path so incidental discoveryId normalization is not attributed to selected.
    act(() => {
      result.current.store.setMotorSelected(motorId!, true);
    });
    const setupAfterWarm = result.current.project.currentProject!.document!.setup;
    const revisionAfterWarm = result.current.project.documentRevision.value;
    const canUndoAfterWarm = result.current.project.canUndo;

    act(() => {
      result.current.store.setMotorSelected(motorId!, false);
    });

    expect(result.current.store.motors.find((motor) => motor.id === motorId)?.selected).toBe(
      false,
    );
    expect(
      result.current.project.currentProject!.document!.setup.motors.find(
        (motor) => motor.id === motorId,
      ),
    ).not.toHaveProperty("selected");
    expect(result.current.project.currentProject!.document!.setup).toBe(setupAfterWarm);
    expect(result.current.project.documentRevision.value).toBe(revisionAfterWarm);
    expect(result.current.project.canUndo).toBe(canUndoAfterWarm);
  });

  it("persists multi-object transforms with one batch update", () => {
    const updateObjectsBatch = vi.fn<UpdateObjectsBatchFn>();
    const firstPayload: TransformEndPayload = {
      id: "obj-a",
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    const secondPayload: TransformEndPayload = {
      id: "obj-b",
      position: { x: 4, y: 5, z: 6 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };

    persistTransformPayloadsBatch(updateObjectsBatch, [firstPayload, secondPayload]);

    expect(updateObjectsBatch).toHaveBeenCalledTimes(1);
    expect(updateObjectsBatch.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it("records one history step for a batch object update", async () => {
    const { result } = renderStoreAndProject();
    await openFixtureProject(result);

    const ids = result.current.store.objects.slice(0, 2).map((object) => object.id);
    expect(ids).toHaveLength(2);

    act(() => {
      result.current.store.updateObjectsBatch(
        ids.map((id, index) => ({
          id,
          patch: { position: { x: 100 + index, y: 200, z: 300 } },
        })),
      );
    });

    expect(result.current.project.undoLabel).toBe("批量修改受控物体");
    expect(result.current.project.canUndo).toBe(true);

    act(() => {
      result.current.project.undoProjectConfiguration();
    });
    await waitFor(() => {
      expect(result.current.project.canUndo).toBe(false);
    });
  });

  it("rehydrates store from disk when reopening the same project id", async () => {
    const { result } = renderStoreAndProject();
    await openFixtureProject(result);

    const objectId = result.current.store.objects[0]?.id;
    expect(objectId).toBeTruthy();
    const originalPosition = {
      ...result.current.store.objects.find((object) => object.id === objectId)!.position,
    };

    act(() => {
      result.current.store.updateObject(objectId!, { position: { x: 10, y: 6, z: -4 } });
    });
    expect(result.current.store.objects.find((object) => object.id === objectId)?.position).toEqual({
      x: 10,
      y: 6,
      z: -4,
    });

    await act(async () => {
      await result.current.project.openProject(GZ_2025_RECORD.folderName);
    });

    await waitFor(() => {
      expect(result.current.project.documentRevision.origin).toBe("version-restore");
      expect(
        result.current.store.objects.find((object) => object.id === objectId)?.position,
      ).toEqual(originalPosition);
    });
  });

  it("returns null when addObjectFromShape persist fails", async () => {
    const { result } = renderStoreAndProject();
    await waitFor(() => expect(result.current.project.loading).toBe(false));

    let created: ReturnType<typeof result.current.store.addObjectFromShape> = null;
    act(() => {
      created = result.current.store.addObjectFromShape("cube");
    });

    expect(created).toBeNull();
    expect(result.current.store.objects).toHaveLength(0);
  });

  it("uses production transform session and commit-guard helpers", () => {
    // Sync session pairing (Viz3DTransformSync) — not Babylon detach/release order.
    const rejected = onTransformDragStart(false);
    expect(shouldAbortEngineOnTransformStart(rejected)).toBe(true);
    expect(shouldPersistTransformDragEnd(rejected)).toBe(false);
    expect(onTransformDragSettled()).toEqual(idleTransformDragSession());

    const owned = onTransformDragStart(true);
    expect(shouldAbortEngineOnTransformStart(owned)).toBe(false);
    expect(shouldPersistTransformDragEnd(owned)).toBe(true);

    // Engine abort predicate (Viz3DEngine onCommit / commitMultiTransform).
    expect(
      shouldAbortFailedTransformCommit({
        mode: "single",
        targetId: null,
        canEdit: true,
        hasHandle: true,
        payloadCount: 0,
      }),
    ).toBe(true);
    expect(
      shouldAbortFailedTransformCommit({
        mode: "single",
        targetId: "obj-a",
        canEdit: false,
        hasHandle: true,
        payloadCount: 0,
      }),
    ).toBe(true);
    expect(
      shouldAbortFailedTransformCommit({
        mode: "multi",
        targetId: null,
        canEdit: true,
        hasHandle: true,
        payloadCount: 0,
      }),
    ).toBe(true);
    expect(
      shouldAbortFailedTransformCommit({
        mode: "multi",
        targetId: null,
        canEdit: true,
        hasHandle: true,
        payloadCount: 2,
      }),
    ).toBe(false);
  });
});
