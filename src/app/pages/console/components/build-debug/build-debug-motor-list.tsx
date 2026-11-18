import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { DisplayAttribute } from "@shared/config";
import { cn } from "@/app/components/ui/utils";
import type { Motor } from "@/app/pages/console/components/right-sidebar/config-wizard/config-wizard-types";
import { formatMotorDisplayName } from "@/app/pages/console/hooks/motor-mid";
import { formatPlcDisplayName } from "@/app/pages/console/hooks/plc-display-name";
import {
  getCachedMotorModelConfig,
  preloadMotorModelConfigs,
} from "@/app/pages/console/hooks/motor-config";
import { idsInRange, resolveSelectionMode } from "@/app/pages/console/hooks/selection-range";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import { BuildDebugBar } from "./build-debug-bar";
import { evaluateMotorAlarms, telemetryStateValue, type MotorAlarmFlags } from "./build-debug-logic";
import { useBuildDebug } from "./build-debug-context";
import {
  formatStateAttrDisplay,
  resolveStateAttrRawValue,
  stateAttrToneClass,
  variablevariableStateAttri,
} from "./build-debug-state-attrs";
import { MOCK_STATE_IDS, type BuildMotorTelemetry } from "./build-debug-types";
import {
  DEBUG_FIXED_READOUT_IDS,
  DebugReadout,
  POSITION_READOUT,
  SPEED_READOUT,
  TEMPERATURE_READOUT,
  TORQUE_READOUT,
  debugReadoutMeta,
  formatDebugPositionReadout,
  formatDebugSpeedReadout,
} from "./debug-readout";
import { MotorStatusBadge, resolveMotorStatusBadge } from "./motor-status-badge";

const toolbarBtn =
  "shrink-0 rounded-md px-2 py-1.5 text-body-sm text-primary hover:bg-accent disabled:pointer-events-none disabled:opacity-40";

/**
 * checkbox | name | p: 位置 | s: 速度 | t: 温度 | m: 力矩 | …variable | 运行态
 * 数值列按 11px 等宽字放得下「前缀: 值」（如 p: -12345.6）
 */
const rowGridStyle = (dynamicCount: number): CSSProperties => ({
  gridTemplateColumns: [
    "1.25rem",
    "minmax(0,1fr)",
    "4.75rem",
    "4.25rem",
    "3rem",
    "3.25rem",
    ...(dynamicCount > 0 ? [`repeat(${dynamicCount}, minmax(3rem,auto))`] : []),
    "4.5rem",
  ].join(" "),
});

const FIXED_VALUE_COLS = 4;

const readoutCell = "text-left";

const variableAttrsForModel = (productModel: string): DisplayAttribute[] =>
  variablevariableStateAttri(
    getCachedMotorModelConfig(productModel)?.variableStateAttri ?? [],
  ).filter((attr) => !DEBUG_FIXED_READOUT_IDS.has(attr.id));

type MotorListRow = {
  motor: Motor;
  telemetry: BuildMotorTelemetry;
  alarms: MotorAlarmFlags;
  displayP: number;
  online: boolean;
  selectable: boolean;
  variableAttrs: DisplayAttribute[];
};

type MotorListGroup = {
  id: string;
  title: string;
  /** 受控物体 id；未绑定组为 null */
  objectId: number | null;
  rows: MotorListRow[];
};

export const BuildDebugMotorList = () => {
  const displayUnit = useSessionDisplayLengthUnit();
  const { motors, objects, plcs, getObjectMotors, getPlcUnassignedMotors } = useProjectStore();
  const {
    arm,
    disarm,
    primaryMotorId,
    selectedMotorIds,
    coupledObjectIds,
    toggleMotor,
    selectMotors,
    clearSelection,
    displayPositionOf,
    telemetryOf,
    imbalancedInObject,
    isMotorOnline,
    isMotorSelectable,
    isObjectDecoupled,
    setObjectDecoupled,
    setAllObjectsDecoupled,
  } = useBuildDebug();

  // 进入调试 tab 即启用；离开 tab 自动关闭
  useEffect(() => {
    arm();
    return () => disarm();
  }, [arm, disarm]);

  const [query, setQuery] = useState("");
  const [catalogTick, setCatalogTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void preloadMotorModelConfigs().then(() => {
      if (!cancelled) setCatalogTick((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const emptyImbalance = new Set<number>();

    const buildRows = (
      motorList: ReturnType<typeof getObjectMotors>,
      imbalanced: ReadonlySet<number>,
      groupSearchKey: string,
    ) =>
      motorList
        .map((motor) => {
          const telemetry = telemetryOf(motor.id);
          const alarms = evaluateMotorAlarms(telemetry, imbalanced, motor.id);
          const online = isMotorOnline(motor.id);
          return {
            motor,
            telemetry,
            alarms,
            displayP: displayPositionOf(motor.id),
            online,
            selectable: isMotorSelectable(motor.id),
            variableAttrs: variableAttrsForModel(motor.productModel),
          };
        })
        .filter((row) => {
          if (!q) return true;
          return (
            formatMotorDisplayName(motors, row.motor).toLowerCase().includes(q) ||
            groupSearchKey.toLowerCase().includes(q)
          );
        });

    const unboundGroups: MotorListGroup[] = plcs
      .map((plc) => {
        const title = `未绑定 · ${formatPlcDisplayName(plcs, plc)}`;
        return {
          id: `unbound-${plc.id}`,
          title,
          objectId: null,
          rows: buildRows(getPlcUnassignedMotors(plc.id), emptyImbalance, title),
        };
      })
      .filter((group) => group.rows.length > 0);

    const objectGroups: MotorListGroup[] = objects
      .map((object) => ({
        id: String(object.id),
        title: object.name,
        objectId: object.id,
        rows: buildRows(
          getObjectMotors(object.id),
          imbalancedInObject(object.id),
          object.name,
        ),
      }))
      .filter((group) => group.rows.length > 0);

    // 主控未绑定分组置顶
    return [...unboundGroups, ...objectGroups];
  }, [
    objects,
    plcs,
    getObjectMotors,
    getPlcUnassignedMotors,
    imbalancedInObject,
    telemetryOf,
    displayPositionOf,
    isMotorOnline,
    isMotorSelectable,
    query,
    motors,
    catalogTick,
  ]);

  const selectableIds = useMemo(
    () => groups.flatMap((group) => group.rows.filter((row) => row.selectable).map((row) => row.motor.id)),
    [groups],
  );

  const handleSelectMotor = (
    motorId: number,
    selectable: boolean,
    mode: "replace" | "toggle" | "range",
  ) => {
    if (!selectable) return;
    if (mode === "toggle") {
      toggleMotor(motorId, true);
      return;
    }
    if (mode === "range") {
      const anchor = primaryMotorId ?? [...selectedMotorIds].at(-1) ?? null;
      const next = idsInRange(selectableIds, anchor, motorId);
      selectMotors(next, motorId);
      return;
    }
    if (selectedMotorIds.has(motorId) && selectedMotorIds.size === 1) {
      clearSelection();
      return;
    }
    if (selectedMotorIds.has(motorId)) {
      toggleMotor(motorId, true);
      return;
    }
    selectMotors([motorId], motorId);
  };

  const allSelectableSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedMotorIds.has(id));

  const anyObjectCoupled = objects.some((object) => coupledObjectIds.has(object.id));

  const handleToggleSelectAll = () => {
    if (selectableIds.length === 0) return;
    if (allSelectableSelected) {
      clearSelection();
      return;
    }
    selectMotors(selectableIds, selectableIds[0] ?? null);
  };

  const handleToggleGroupSelect = (rows: MotorListRow[]) => {
    const ids = rows.filter((row) => row.selectable).map((row) => row.motor.id);
    if (ids.length === 0) return;
    const allSelected = ids.every((id) => selectedMotorIds.has(id));
    if (allSelected) {
      const next = [...selectedMotorIds].filter((id) => !ids.includes(id));
      if (next.length === 0) clearSelection();
      else selectMotors(next, next[0] ?? null);
      return;
    }
    selectMotors(ids, ids[0] ?? null);
  };

  return (
    <div data-guide="console-real-axis-debug-list" className="flex min-h-0 flex-1 flex-col bg-background">
      {/* <PanelHeader title="调试 · 电机列表" /> */}

      <div className="flex shrink-0 items-center gap-2 bg-muted px-2 pt-1.5">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索电机 / 物体 / 主控"
          aria-label="搜索电机"
          className="min-w-0 flex-1 rounded-sm border border-border/60 bg-input-background px-2 py-1.5 text-body-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
        />
        <span className="shrink-0 font-mono text-mono-sm tabular-nums text-muted-foreground">
          已选 {selectedMotorIds.size} 台
        </span>
        <button
          type="button"
          className={toolbarBtn}
          disabled={selectableIds.length === 0}
          aria-pressed={allSelectableSelected}
          onClick={handleToggleSelectAll}
        >
          {allSelectableSelected ? "取消全选" : "全选"}
        </button>
        <button
          type="button"
          className={toolbarBtn}
          disabled={!anyObjectCoupled}
          onClick={() => setAllObjectsDecoupled(true)}
        >
          解耦
        </button>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto bg-muted p-2">
        {groups.length === 0 && (
          <p className="px-3 py-6 text-center text-body-sm text-muted-foreground">无匹配电机</p>
        )}

        {groups.map(({ id, title, objectId, rows }) => {
          const decoupled = objectId ? isObjectDecoupled(objectId) : true;
          const groupSelectable = rows.some((row) => row.selectable);

          return (
            <section key={id} className="overflow-hidden rounded-md bg-background">
              <div className="flex h-9 items-center justify-between gap-2 bg-card px-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-body-sm font-medium text-foreground">{title}</span>
                  <span className="shrink-0 font-mono text-mono-sm tabular-nums text-muted-foreground">
                    {rows.length}
                  </span>
                  {objectId && !decoupled && (
                    <span className="shrink-0 rounded-full bg-secondary/20 px-1.5 py-0.5 text-[11px] text-secondary">
                      耦合
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {objectId && !decoupled && (
                    <button
                      type="button"
                      className="text-body-sm text-primary hover:underline"
                      onClick={() => setObjectDecoupled(objectId, true)}
                    >
                      解耦
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-body-sm text-primary hover:underline disabled:pointer-events-none disabled:opacity-40"
                    disabled={!groupSelectable}
                    onClick={() => handleToggleGroupSelect(rows)}
                  >
                    全选
                  </button>
                </div>
              </div>

              <ul className="space-y-px p-1">
                {rows.map((row) => {
                  const selected = selectedMotorIds.has(row.motor.id);
                  const primary = primaryMotorId === row.motor.id;
                  const { selectable, online } = row;
                  const blockedByCouple = online && !selectable;

                  return (
                    <li key={row.motor.id}>
                      <div
                        role="button"
                        tabIndex={selectable ? 0 : -1}
                        aria-pressed={selected}
                        aria-disabled={!selectable}
                        aria-label={`${formatMotorDisplayName(motors, row.motor)}${
                          !online ? " 未连接" : blockedByCouple ? " 耦合中不可选" : ""
                        }`}
                        onClick={(event) => {
                          handleSelectMotor(
                            row.motor.id,
                            selectable,
                            resolveSelectionMode(event),
                          );
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleSelectMotor(
                              row.motor.id,
                              selectable,
                              resolveSelectionMode(event),
                            );
                          }
                        }}
                        className={cn(
                          "grid items-center gap-x-2",
                          "min-h-7 rounded-sm border-l-2 px-2 outline-none focus-visible:ring-1 focus-visible:ring-ring",
                          selectable ? "cursor-pointer" : "cursor-not-allowed opacity-50",
                          primary
                            ? "border-l-primary bg-accent"
                            : selected
                              ? "border-l-primary/60 bg-accent/60"
                              : row.alarms.any && selectable
                                ? "border-l-warning bg-warning/15"
                                : "border-l-transparent bg-background",
                        )}
                        style={rowGridStyle(row.variableAttrs.length)}
                      >
                        {/* 复选框追加 / 移出选中；点整行仍为单选 */}
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={!selectable}
                          tabIndex={-1}
                          aria-label={`${selected ? "移出" : "追加"}选中 ${formatMotorDisplayName(motors, row.motor)}`}
                          onClick={(event) => event.stopPropagation()}
                          onChange={() => handleSelectMotor(row.motor.id, selectable, "toggle")}
                          className={cn("accent-primary", selectable && "cursor-pointer")}
                        />
                        <span className="truncate font-mono text-body-sm tabular-nums text-foreground">
                          {formatMotorDisplayName(motors, row.motor)}
                        </span>

                        {online ? (
                          <>
                            <DebugReadout
                              meta={POSITION_READOUT}
                              value={formatDebugPositionReadout(row.displayP, displayUnit)}
                              valueClassName="text-foreground"
                              className={readoutCell}
                            />
                            <DebugReadout
                              meta={SPEED_READOUT}
                              value={formatDebugSpeedReadout(row.telemetry, displayUnit)}
                              valueClassName="text-foreground"
                              className={readoutCell}
                            />
                            <DebugReadout
                              meta={TEMPERATURE_READOUT}
                              value={`${(
                                telemetryStateValue(
                                  row.telemetry,
                                  MOCK_STATE_IDS.actualTemperature,
                                ) ?? 0
                              ).toFixed(0)}°`}
                              valueClassName={
                                row.alarms.temperature ? "text-warning" : "text-muted-foreground"
                              }
                              className={readoutCell}
                            />
                            <DebugReadout
                              meta={TORQUE_READOUT}
                              value={`${(
                                telemetryStateValue(
                                  row.telemetry,
                                  MOCK_STATE_IDS.actualTorque,
                                ) ?? 0
                              ).toFixed(0)}%`}
                              valueClassName={
                                row.alarms.torqueImbalance
                                  ? "text-warning"
                                  : "text-muted-foreground"
                              }
                              className={readoutCell}
                            />
                            {row.variableAttrs.map((attr) => {
                              const pos = row.telemetry.values[MOCK_STATE_IDS.actualPosition];
                              const originOffset =
                                typeof pos === "number" ? pos - row.displayP : 0;
                              const raw = resolveStateAttrRawValue(
                                attr.id,
                                row.telemetry,
                                originOffset,
                              );
                              return (
                                <DebugReadout
                                  key={attr.id}
                                  meta={debugReadoutMeta(attr)}
                                  value={formatStateAttrDisplay(attr, raw, displayUnit)}
                                  valueClassName={stateAttrToneClass(attr.id, row.alarms)}
                                  className={readoutCell}
                                />
                              );
                            })}
                            <MotorStatusBadge
                              kind={resolveMotorStatusBadge({
                                online,
                                blockedByCouple,
                                status: row.telemetry.status,
                              })}
                              className="justify-self-start"
                            />
                          </>
                        ) : (
                          <>
                            <span
                              className="font-mono text-mono-sm tabular-nums text-muted-foreground"
                              style={{
                                gridColumn: `span ${FIXED_VALUE_COLS + row.variableAttrs.length}`,
                              }}
                            />
                            <MotorStatusBadge
                              kind={{ type: "runtime", status: "powerOff" }}
                              className="justify-self-start"
                            />
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <BuildDebugBar className="rounded-none bg-card" />
    </div>
  );
};
