import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { ScreenRect } from "@/app/viz3d";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { cn } from "@/app/components/ui/utils";
import { mToMm } from "@/app/project/length-units";
import { useConsoleNav } from "../hooks/use-console-nav";
import { useProjectStore } from "../hooks/use-project-store";
import { useSelection } from "../hooks/use-selection";
import { useViz3DContext } from "./Viz3DProvider";
import { toast } from "sonner";
import { useProject } from "@/app/project/use-project";
import { createDefaultSavedView } from "@/app/project/saved-view";
import {
  isShapePresetDrag,
  placementYForShape,
  readShapePresetDrag,
} from "./shape-preset-drop";
import {
  isMotorHoistDrag,
  readMotorHoistDrag,
} from "./motor-hoist-drop";
import { DeleteImpactDialog } from "../components/right-sidebar/delete-impact-dialog";
import { BoxSelectOverlay } from "./overlays/BoxSelectOverlay";
import { SceneBuildContextMenuContent } from "./overlays/SceneBuildContextMenu";
import { MotorTelemetryOverlay } from "../components/build-debug/motor-telemetry-overlay";
import { ViewportOverlay } from "./overlays/ViewportOverlay";
import { GoReadyOverlay } from "./overlays/GoReadyOverlay";
import { useSceneObjectEditActions } from "./use-scene-object-edit-actions";
import { resolveContextMenuObjectId } from "./context-menu-pick";
import {
  isOverDragThreshold,
  resolvePointerDownKind,
  resolveViewportDragFinish,
  shouldFinishViewportDrag,
} from "./viewport-pointer-gestures";

type DragState = {
  startX: number;
  startY: number;
  startOffsetX: number;
  startOffsetY: number;
  pointerId: number;
  additive: boolean;
};

const toCanvasRelativeRect = (
  startOffsetX: number,
  startOffsetY: number,
  endOffsetX: number,
  endOffsetY: number,
): ScreenRect => ({
  left: Math.min(startOffsetX, endOffsetX),
  top: Math.min(startOffsetY, endOffsetY),
  width: Math.abs(endOffsetX - startOffsetX),
  height: Math.abs(endOffsetY - startOffsetY),
});

const ViewportSlotContext = createContext<object | null>(null);

export const ViewportSlotProvider = ({ children }: { children: ReactNode }) => (
  <ViewportSlotContext.Provider value={{}}>{children}</ViewportSlotContext.Provider>
);

export const useViewportSlot = () => {
  const ctx = useContext(ViewportSlotContext);
  if (!ctx) {
    throw new Error("useViewportSlot must be used within ViewportSlotProvider");
  }
  return ctx;
};

type ViewportSlotProps = {
  className?: string;
};

/** 3D 视口槽位：canvas 内嵌，Babylon 引擎 mount/unmount 生命周期 */
export const ViewportSlot = ({ className }: ViewportSlotProps) => {
  const engine = useViz3DContext();
  const { currentProject } = useProject();
  const { activeNav } = useConsoleNav();
  const { addObjectFromShape, bindMotorsFromAxis } = useProjectStore();
  const { replaceSelection, setTreeFocus, clearSelection } = useSelection();
  const buildMode = activeNav === "devices";

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const lastContextMenuPickMmRef = useRef<{ x: number; z: number } | null>(null);
  const {
    copySelection,
    pasteClipboard,
    requestDeleteSelection,
    canCopy,
    canPaste,
    canDelete,
    deleteImpact,
    deleteOpen,
    setDeleteOpen,
    confirmDelete,
    deleteError,
  } = useSceneObjectEditActions({
    getPasteAnchorXZ: () => lastContextMenuPickMmRef.current,
  });
  const [boxRect, setBoxRect] = useState<ScreenRect | null>(null);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextMenuPoint, setContextMenuPoint] = useState({ x: 0, y: 0 });
  const [contextMenuObjectId, setContextMenuObjectId] = useState<string | null>(null);
  const appliedViewProjectIdRef = useRef<string | null>(null);

  const handleContextMenuOpenChange = useCallback(
    (open: boolean) => {
      setContextMenuOpen(open);
      // Closing always restores orbit; opening disables it so RMB drag won't fight the menu.
      engine.setOrbitEnabled(!open);
    },
    [engine],
  );

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) {
      return;
    }

    engine.mount(canvas);

    const handleWheel = (event: WheelEvent) => {
      engine.applyWheelZoom(event.deltaY);
      event.preventDefault();
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    const observer = new ResizeObserver(() => {
      engine.resize();
    });
    observer.observe(container);

    return () => {
      canvas.removeEventListener("wheel", handleWheel);
      observer.disconnect();
      engine.unmount();
      appliedViewProjectIdRef.current = null;
    };
  }, [engine]);

  // 打开/切换工程后恢复落盘视角；引擎异步 ready 前会排队
  useEffect(() => {
    if (!currentProject) {
      appliedViewProjectIdRef.current = null;
      return;
    }
    const projectId = currentProject.id;

    const view = currentProject.document?.view ?? createDefaultSavedView();
    const apply = () => {
      engine.applySavedView(view);
      appliedViewProjectIdRef.current = projectId;
    };

    apply();
    const handleReady = () => {
      apply();
    };
    engine.events.on("ready", handleReady);
    return () => {
      engine.events.off("ready", handleReady);
    };
  }, [currentProject?.id, currentProject?.document?.view, engine]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const isEditableTarget = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        t.isContentEditable
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      // `.` 聚焦选中物体：任意模式均可用，且不依赖画布焦点（选择可在树/面板中完成）。
      if (event.key === ".") {
        event.preventDefault();
        engine.focusSelection();
        return;
      }

      // 其余编辑快捷键仅在搭建模式且画布聚焦时生效，避免与树/表单快捷键冲突。
      if (!buildMode) return;
      if (document.activeElement !== el) return;

      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copySelection();
        return;
      }
      if (mod && event.key.toLowerCase() === "v") {
        event.preventDefault();
        pasteClipboard("shortcut");
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        requestDeleteSelection();
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [buildMode, copySelection, pasteClipboard, requestDeleteSelection, engine]);

  useEffect(() => {
    if (!buildMode && contextMenuOpen) {
      handleContextMenuOpenChange(false);
    }
  }, [buildMode, contextMenuOpen, handleContextMenuOpenChange]);

  // Safety: never leave orbit disabled after unmount / menu teardown.
  useEffect(() => {
    return () => {
      engine.setOrbitEnabled(true);
    };
  }, [engine]);

  const clearDrag = useCallback(() => {
    dragRef.current = null;
    setBoxRect(null);
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const kind = resolvePointerDownKind(event.button);
    if (kind === "camera") {
      event.preventDefault();
      return;
    }
    if (kind !== "boxSelect") {
      return;
    }

    event.currentTarget.focus({ preventScroll: true });

    if (contextMenuOpen) {
      handleContextMenuOpenChange(false);
    } else {
      engine.setOrbitEnabled(true);
    }

    if (engine.hitsTransformHandle(event.nativeEvent.offsetX, event.nativeEvent.offsetY)) {
      return;
    }

    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: event.nativeEvent.offsetX,
      startOffsetY: event.nativeEvent.offsetY,
      pointerId: event.pointerId,
      additive: event.shiftKey,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!isOverDragThreshold(dx, dy)) {
      setBoxRect(null);
      return;
    }
    setBoxRect(
      toCanvasRelativeRect(
        drag.startOffsetX,
        drag.startOffsetY,
        event.nativeEvent.offsetX,
        event.nativeEvent.offsetY,
      ),
    );
  };

  const finishDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const action = resolveViewportDragFinish({
      additive: drag.additive,
      dx: event.clientX - drag.startX,
      dy: event.clientY - drag.startY,
    });

    if (action.kind === "boxSelect") {
      engine.pickInRect(
        toCanvasRelativeRect(
          drag.startOffsetX,
          drag.startOffsetY,
          event.nativeEvent.offsetX,
          event.nativeEvent.offsetY,
        ),
        action.mode,
      );
    } else {
      engine.pickAt(event.nativeEvent.offsetX, event.nativeEvent.offsetY, action.mode, true);
    }

    clearDrag();
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!shouldFinishViewportDrag(event.button)) {
      return;
    }
    finishDrag(event);
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    clearDrag();
  };

  const handleLostPointerCapture = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    clearDrag();
  };

  const handleDragOver = useCallback(
    (event: ReactDragEvent<HTMLCanvasElement>) => {
      if (isMotorHoistDrag(event.dataTransfer)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "link";
        return;
      }
      if (!buildMode || !isShapePresetDrag(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [buildMode],
  );

  const handleDrop = useCallback(
    (event: ReactDragEvent<HTMLCanvasElement>) => {
      const motorIds = readMotorHoistDrag(event.dataTransfer);
      if (motorIds) {
        event.preventDefault();
        event.stopPropagation();
        const pick = engine.peekPickAt(event.nativeEvent.offsetX, event.nativeEvent.offsetY);
        if (pick?.kind !== "hoist-axis") {
          toast.warning("请拖到吊点上以绑定电机");
          return;
        }
        const ok = bindMotorsFromAxis(Number(pick.objectId), pick.axisKey, motorIds.map(Number));
        if (!ok) {
          toast.warning("该受控物体已绑定其他主控的驱动单元，不可跨主控混绑");
          return;
        }
        clearSelection();
        const focusMotorId = motorIds[0];
        if (focusMotorId) {
          setTreeFocus({ kind: "motor", id: Number(focusMotorId) });
        }
        return;
      }

      if (!buildMode) {
        return;
      }
      const shapeId = readShapePresetDrag(event.dataTransfer);
      if (!shapeId) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      const ground = engine.pickGroundAt(event.nativeEvent.offsetX, event.nativeEvent.offsetY);
      const obj = addObjectFromShape(shapeId, {
        x: ground ? mToMm(ground.x) : 0,
        y: placementYForShape(shapeId),
        z: ground ? mToMm(ground.z) : 0,
      });
      if (obj) {
        replaceSelection([obj.id]);
      }
    },
    [
      addObjectFromShape,
      bindMotorsFromAxis,
      buildMode,
      clearSelection,
      engine,
      replaceSelection,
      setTreeFocus,
    ],
  );

  const handleCanvasContextMenu = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!buildMode) {
      return;
    }
    const offsetX = event.nativeEvent.offsetX;
    const offsetY = event.nativeEvent.offsetY;
    const objectId = resolveContextMenuObjectId(engine.peekPickAt(offsetX, offsetY));
    setContextMenuObjectId(objectId);
    if (objectId && !engine.getSelection().includes(objectId)) {
      engine.setSelection([objectId]);
    }
    const ground = engine.pickGroundAt(offsetX, offsetY);
    lastContextMenuPickMmRef.current = ground
      ? { x: mToMm(ground.x), z: mToMm(ground.z) }
      : null;
    setContextMenuPoint({ x: event.clientX, y: event.clientY });
    handleContextMenuOpenChange(true);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative isolate min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg bg-canvas",
        className,
      )}
    >
      <canvas
        ref={canvasRef}
        aria-label="3D viewport canvas"
        data-viewport-context-trigger
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handleLostPointerCapture}
        onContextMenu={handleCanvasContextMenu}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className="absolute inset-0 size-full touch-none outline-none"
      />
      {buildMode ? (
        <>
          <DropdownMenu
            modal={false}
            open={contextMenuOpen}
            onOpenChange={handleContextMenuOpenChange}
          >
            <DropdownMenuTrigger asChild>
              <span
                aria-hidden
                className="pointer-events-none fixed size-px opacity-0"
                style={{ left: contextMenuPoint.x, top: contextMenuPoint.y }}
              />
            </DropdownMenuTrigger>
            <SceneBuildContextMenuContent
              copySelection={copySelection}
              pasteClipboard={pasteClipboard}
              requestDeleteSelection={requestDeleteSelection}
              canCopy={canCopy}
              canPaste={canPaste}
              canDelete={canDelete}
              contextObjectId={contextMenuObjectId}
            />
          </DropdownMenu>
          <DeleteImpactDialog
            objectImpact={deleteImpact}
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            onConfirm={confirmDelete}
            error={deleteError}
          />
        </>
      ) : null}
      <BoxSelectOverlay rect={boxRect} />
      <MotorTelemetryOverlay />
      <ViewportOverlay />
      <GoReadyOverlay />
    </div>
  );
};
