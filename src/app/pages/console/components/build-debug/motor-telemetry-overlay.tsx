import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/app/components/ui/utils";
import { formatMotorDisplayName } from "@/app/pages/console/hooks/motor-mid";
import { idsInRange, resolveSelectionMode } from "@/app/pages/console/hooks/selection-range";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { useViz3DContext } from "@/app/pages/console/3d/Viz3DProvider";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import { formatLengthFamilyValue } from "@/app/project/display-length-units";
import { evaluateMotorAlarms } from "./build-debug-logic";
import { useBuildDebugOptional } from "@/app/pages/console/components/build-debug/build-debug-context";
import { motorStatusDotClass } from "./motor-status-badge";

type ScreenAnchor = {
  motorId: string;
  objectId: string;
  x: number;
  y: number;
  visible: boolean;
};

const CLUSTER_PX = 36;
const CAMERA_AGGREGATE_DIST = 28;

/** 同物体吊点在屏幕上过近时聚合为「N 轴」 */
const shouldAggregateObject = (anchors: ScreenAnchor[], cameraDist: number | null): boolean => {
  if (anchors.length < 2) return false;
  if (cameraDist !== null && cameraDist > CAMERA_AGGREGATE_DIST) return true;
  for (let i = 0; i < anchors.length; i += 1) {
    for (let j = i + 1; j < anchors.length; j += 1) {
      const dx = anchors[i]!.x - anchors[j]!.x;
      const dy = anchors[i]!.y - anchors[j]!.y;
      if (Math.hypot(dx, dy) < CLUSTER_PX) return true;
    }
  }
  return false;
};

/** 武装后视口：吊点徽章（详情看右侧列表） */
export const MotorTelemetryOverlay = () => {
  const engine = useViz3DContext();
  const buildDebug = useBuildDebugOptional();
  const displayUnit = useSessionDisplayLengthUnit();
  const { findMotor, getObjectMotors, motors } = useProjectStore();
  const hostRef = useRef<HTMLDivElement>(null);
  const [anchors, setAnchors] = useState<ScreenAnchor[]>([]);
  const [cameraDist, setCameraDist] = useState<number | null>(null);
  const [expandedObjectIds, setExpandedObjectIds] = useState<Set<string>>(() => new Set());

  const armed = buildDebug?.armed ?? false;

  useEffect(() => {
    if (!armed) {
      setAnchors([]);
      return;
    }
    let raf = 0;
    const tick = () => {
      const host = hostRef.current;
      if (host) {
        const { clientWidth, clientHeight } = host;
        setAnchors(engine.getBoundHoistScreenPositions(clientWidth, clientHeight));
        const pose = engine.getPose();
        if (pose) {
          const dx = pose.position.x - pose.target.x;
          const dy = pose.position.y - pose.target.y;
          const dz = pose.position.z - pose.target.z;
          setCameraDist(Math.sqrt(dx * dx + dy * dy + dz * dz));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [armed, engine]);

  const byObject = useMemo(() => {
    const map = new Map<string, ScreenAnchor[]>();
    for (const a of anchors) {
      if (!a.visible) continue;
      const list = map.get(a.objectId) ?? [];
      list.push(a);
      map.set(a.objectId, list);
    }
    return map;
  }, [anchors]);

  if (!buildDebug || !armed) return null;

  const {
    primaryMotorId,
    selectedMotorIds,
    selectMotors,
    toggleMotor,
    clearSelection,
    telemetryOf,
    displayPositionOf,
    imbalancedInObject,
    isMotorOnline,
  } = buildDebug;

  const badges: Array<
    | { kind: "motor"; anchor: ScreenAnchor }
    | { kind: "cluster"; objectId: string; x: number; y: number; count: number }
  > = [];

  for (const [objectId, list] of byObject) {
    const expanded = expandedObjectIds.has(objectId);
    const aggregate = !expanded && shouldAggregateObject(list, cameraDist);
    if (aggregate) {
      const x = list.reduce((s, a) => s + a.x, 0) / list.length;
      const y = list.reduce((s, a) => s + a.y, 0) / list.length;
      badges.push({ kind: "cluster", objectId, x, y, count: list.length });
      continue;
    }
    for (const anchor of list) {
      badges.push({ kind: "motor", anchor });
    }
  }

  const orderedOnlineMotorIds = badges.flatMap((item) =>
    item.kind === "motor" && isMotorOnline(Number(item.anchor.motorId))
      ? [Number(item.anchor.motorId)]
      : [],
  );

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {badges.map((item) => {
        if (item.kind === "cluster") {
          return (
            <button
              key={`cluster-${item.objectId}`}
              type="button"
              aria-label={`${item.count} 轴聚合`}
              onClick={() => {
                setExpandedObjectIds((prev) => {
                  const next = new Set(prev);
                  next.add(item.objectId);
                  return next;
                });
                const motors = getObjectMotors(Number(item.objectId));
                if (motors[0]) {
                  buildDebug.selectMotors([motors[0].id], motors[0].id);
                }
              }}
              className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-card px-2 py-1 font-mono text-mono-sm text-foreground shadow-sm hover:bg-accent"
              style={{ left: item.x, top: item.y }}
            >
              {item.count} 轴
            </button>
          );
        }

        const { anchor } = item;
        const motorId = Number(anchor.motorId);
        const objectId = Number(anchor.objectId);
        const motor = findMotor(motorId);
        const telemetry = telemetryOf(motorId);
        const alarms = evaluateMotorAlarms(
          telemetry,
          imbalancedInObject(objectId),
          motorId,
        );
        const primary = primaryMotorId === motorId;
        const selected = selectedMotorIds.has(motorId);
        const online = isMotorOnline(motorId);

        return (
          <button
            key={anchor.motorId}
            type="button"
            aria-label={`吊点 ${motor ? formatMotorDisplayName(motors, motor) : anchor.motorId}${online ? "" : " 未连接"}`}
            aria-pressed={selected}
            onClick={(event) => {
              if (!online) return;
              const mode = resolveSelectionMode(event);
              if (mode === "toggle") {
                toggleMotor(motorId, true);
                return;
              }
              if (mode === "range") {
                const anchorId =
                  primaryMotorId ?? [...selectedMotorIds].at(-1) ?? null;
                selectMotors(
                  idsInRange(orderedOnlineMotorIds, anchorId, motorId),
                  motorId,
                );
                return;
              }
              if (selected && selectedMotorIds.size === 1) {
                clearSelection();
                return;
              }
              if (selected) {
                toggleMotor(motorId, true);
                return;
              }
              selectMotors([motorId], motorId);
            }}
            className={cn(
              "pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-card/95 px-1.5 py-0.5 font-mono text-mono-sm tabular-nums shadow-sm",
              online ? "" : "cursor-not-allowed opacity-50",
              primary
                ? "ring-1 ring-primary"
                : selected
                  ? "ring-1 ring-primary/50"
                  : alarms.any && online
                    ? "ring-1 ring-warning"
                    : "",
            )}
            style={{ left: anchor.x, top: anchor.y }}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                online ? motorStatusDotClass(telemetry.status) : motorStatusDotClass("powerOff"),
              )}
              aria-hidden
            />
            <span className="text-foreground">
              {motor ? formatMotorDisplayName(motors, motor) : "?"}
            </span>
            <span className="text-muted-foreground">
              {online
                ? formatLengthFamilyValue(displayPositionOf(motorId), "mm", displayUnit, {
                    canonicalPrecision: 1,
                  })
                : "离线"}
            </span>
          </button>
        );
      })}
    </div>
  );
};
