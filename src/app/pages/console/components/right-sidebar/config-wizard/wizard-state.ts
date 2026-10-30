import type {
  ControlledObject,
  Motor,
  Plc,
} from "@/app/pages/console/components/right-sidebar/config-wizard/config-wizard-types";
import {
  CONTROL_TYPE_RULES,
  controlTypeHasNoDriveAxes,
} from "@/app/project/configuration-rules";
import { formatPlcDisplayName } from "@/app/pages/console/hooks/plc-display-name";
import type { WizardMeta, WizardStepKey } from "@/app/project/project-document-types";
import { countBoundAxesOnObject } from "@/app/pages/console/hooks/binding-utils";
import { reconcileMotors } from "@/app/pages/console/hooks/plc-reconciliation";
import type { PlcRuntimeState } from "@/app/pages/console/hooks/plc-runtime-types";

export type { WizardStepKey } from "@/app/project/project-document-types";

export const WIZARD_STEPS = [
  { key: "objects", label: "受控物体", skippable: false },
  { key: "hardware", label: "主控与驱动单元", skippable: true },
  { key: "binding", label: "驱动轴绑定", skippable: true },
  { key: "review", label: "参数确认", skippable: false },
] as const satisfies readonly { key: WizardStepKey; label: string; skippable: boolean }[];

export const SKIPPABLE_STEPS = new Set<WizardStepKey>(
  WIZARD_STEPS.filter((step) => step.skippable).map((step) => step.key),
);

export type WizardReviewSetup = {
  objects: ControlledObject[];
  plcs: Plc[];
  motors: Motor[];
  simulationOnly: boolean;
};

export type WizardReviewRuntime = {
  getPlcRuntime: (plcId: number) => PlcRuntimeState;
};

export type ReviewIssueSeverity = "blocking" | "warning";

export type ReviewIssueCode =
  | "axis-minimum"
  | "motor-count-mismatch"
  | "plc-disconnected"
  | "unbound-axes"
  | "simulation-only";

export type ReviewIssue = {
  code: ReviewIssueCode;
  severity: ReviewIssueSeverity;
  message: string;
  targetStep: WizardStepKey;
};

export const getReviewIssues = (
  setup: WizardReviewSetup,
  runtime: WizardReviewRuntime,
): ReviewIssue[] => {
  const issues: ReviewIssue[] = [];

  if (setup.simulationOnly) {
    issues.push({
      code: "simulation-only",
      severity: "warning",
      message: "仅离线仿真",
      targetStep: "hardware",
    });
    return issues;
  }

  for (const object of setup.objects) {
    if (controlTypeHasNoDriveAxes(object.controlType)) continue;
    const minimum = CONTROL_TYPE_RULES[object.controlType].minimumDriveAxes;
    if (object.axes.length < minimum) {
      issues.push({
        code: "axis-minimum",
        severity: "blocking",
        message: `${object.name} 驱动轴不足（至少 ${minimum} 轴）`,
        targetStep: "objects",
      });
    }
  }

  for (const plc of setup.plcs) {
    const plcRuntime = runtime.getPlcRuntime(plc.id);
    const configuredMotors = setup.motors.filter((motor) => motor.plcId === plc.id);
    const configuredCount = configuredMotors.length;
    const reconciliation = reconcileMotors(
      plc.id,
      configuredMotors,
      plcRuntime.discoveredMotors,
    );

    if (plcRuntime.connection === "disconnected") {
      issues.push({
        code: "plc-disconnected",
        severity: "warning",
        message: `${formatPlcDisplayName(setup.plcs, plc)} 未连接`,
        targetStep: "hardware",
      });
    }

    if (
      plcRuntime.connection === "abnormal" &&
      plcRuntime.reason === "countMismatch"
    ) {
      issues.push({
        code: "motor-count-mismatch",
        severity: "blocking",
        message: `${formatPlcDisplayName(setup.plcs, plc)} 配置 ${configuredCount} 台，实际发现 ${plcRuntime.discoveredMotors.length} 台`,
        targetStep: "hardware",
      });
    } else if (
      (plcRuntime.connection === "connected" || plcRuntime.connection === "abnormal") &&
      (reconciliation.missing.length > 0 || reconciliation.discoveredOnly.length > 0)
    ) {
      issues.push({
        code: "motor-count-mismatch",
        severity: "blocking",
        message: `${formatPlcDisplayName(setup.plcs, plc)} 仍有未对账的电机差异`,
        targetStep: "hardware",
      });
    }
  }

  const bindableAxes = setup.objects
    .filter((object) => !controlTypeHasNoDriveAxes(object.controlType))
    .reduce((count, object) => count + object.axes.length, 0);
  const boundAxes = setup.objects.reduce(
    (count, object) => count + countBoundAxesOnObject(object, setup.motors),
    0,
  );

  if (bindableAxes > 0 && boundAxes < bindableAxes) {
    issues.push({
      code: "unbound-axes",
      severity: "blocking",
      message: `仍有 ${bindableAxes - boundAxes} 个驱动轴未绑定`,
      targetStep: "binding",
    });
  }

  return issues;
};

export const hasBlockingReviewIssues = (issues: ReviewIssue[]): boolean =>
  issues.some((issue) => issue.severity === "blocking");

/** 向导的视图：一个认识页，加四个步骤 */
export type WizardView = "intro" | WizardStepKey;

export type WizardSetup = Pick<WizardReviewSetup, "objects" | "plcs" | "motors">;

export type WizardCounts = {
  objects: number;
  /** 需要绑定的吊点；占位、轨道车这类无驱动轴的物体不算 */
  axes: number;
  boundAxes: number;
  motors: number;
  plcs: number;
};

export const getWizardCounts = ({ objects, plcs, motors }: WizardSetup): WizardCounts => {
  const bindable = objects.filter((object) => !controlTypeHasNoDriveAxes(object.controlType));
  return {
    objects: objects.length,
    axes: bindable.reduce((count, object) => count + object.axes.length, 0),
    boundAxes: bindable.reduce(
      (count, object) => count + countBoundAxesOnObject(object, motors),
      0,
    ),
    motors: motors.length,
    plcs: plcs.length,
  };
};

export type WizardStepProgress = "empty" | "partial" | "done";

/** 进度全部从工程数据推导：不记录「已完成」「已跳过」，没配的步骤就是还没配 */
export const getWizardStepProgress = (
  step: WizardStepKey,
  setup: WizardSetup,
): WizardStepProgress => {
  const counts = getWizardCounts(setup);
  switch (step) {
    case "objects": {
      if (counts.objects === 0) return "empty";
      const incomplete = setup.objects.some(
        (object) =>
          !object.name.trim() ||
          object.axes.length < CONTROL_TYPE_RULES[object.controlType].minimumDriveAxes,
      );
      return incomplete ? "partial" : "done";
    }
    case "hardware":
      if (counts.plcs === 0) return "empty";
      return counts.motors === 0 ? "partial" : "done";
    case "binding":
      if (counts.axes === 0) return counts.objects > 0 ? "done" : "empty";
      if (counts.boundAxes === 0) return "empty";
      return counts.boundAxes < counts.axes ? "partial" : "done";
    case "review":
      return WIZARD_WORK_STEPS.every((key) => getWizardStepProgress(key, setup) === "done")
        ? "done"
        : "empty";
  }
};

const WIZARD_WORK_STEPS = ["objects", "hardware", "binding"] as const;

/** 下一个还没做完的步骤；都做完了就是检查 */
export const getNextWizardStep = (setup: WizardSetup): WizardStepKey =>
  WIZARD_WORK_STEPS.find((step) => getWizardStepProgress(step, setup) !== "done") ?? "review";

/** 回到上次的位置；没有记录时，空工程从认识页开始，否则从还没做完的步骤开始 */
export const resolveInitialWizardView = (
  stored: WizardView | null,
  setup: WizardSetup,
): WizardView => {
  if (stored) return stored;
  const empty =
    setup.objects.length === 0 && setup.plcs.length === 0 && setup.motors.length === 0;
  return empty ? "intro" : getNextWizardStep(setup);
};

const OBJECT_PLACEMENT_GAP_MM = 1000;

/** 向导新建的物体沿 X 依次排开，避免都叠在原点；挂载的子物体是相对坐标，不参与计算 */
export const nextObjectPlacementX = (
  objects: readonly ControlledObject[],
  width: number,
): number => {
  const roots = objects.filter((object) => object.parentId == null);
  if (roots.length === 0) return 0;
  const rightEdge = Math.max(...roots.map((object) => object.position.x + object.dimensions.w / 2));
  return rightEdge + OBJECT_PLACEMENT_GAP_MM + width / 2;
};

export type WizardCapabilityId = "preview" | "connect" | "debug" | "linked" | "show";

/** ready = 现在就能做；attention = 配置有问题要处理；locked = 前置条件还没到 */
export type WizardCapabilityState = "ready" | "attention" | "locked";

export type WizardCapability = {
  id: WizardCapabilityId;
  label: string;
  state: WizardCapabilityState;
  detail: string;
  /** 要解决这一项该去的步骤 */
  targetStep?: WizardStepKey;
};

/** 工程现在能做什么：单台调试只看主控连接，绑定只影响按物体联动 */
export const getWizardCapabilities = (
  setup: WizardSetup,
  runtime: WizardReviewRuntime,
  options: { alignmentConfirmed: boolean },
): WizardCapability[] => {
  const counts = getWizardCounts(setup);
  const connectedPlcIds = new Set(
    setup.plcs
      .filter((plc) => runtime.getPlcRuntime(plc.id).connection === "connected")
      .map((plc) => plc.id),
  );
  const allConnected = counts.plcs > 0 && connectedPlcIds.size === counts.plcs;
  const connectedMotors = setup.motors.filter((motor) => connectedPlcIds.has(motor.plcId)).length;
  const blocking = getReviewIssues({ ...setup, simulationOnly: false }, runtime).filter(
    (issue) => issue.severity === "blocking",
  );

  const preview: WizardCapability =
    counts.axes > 0
      ? {
          id: "preview",
          label: "3D 预览、编排动作",
          state: "ready",
          detail: "没有设备也可以先做",
        }
      : {
          id: "preview",
          label: "3D 预览、编排动作",
          state: "attention",
          detail: "还没有可运动的受控物体",
          targetStep: "objects",
        };

  const connect: WizardCapability =
    counts.plcs === 0
      ? {
          id: "connect",
          label: "连接设备",
          state: "locked",
          detail: "还没有配置主控，不影响 3D 和动作",
          targetStep: "hardware",
        }
      : allConnected
        ? {
            id: "connect",
            label: "连接设备",
            state: "ready",
            detail: `${counts.plcs} 个主控已连接`,
          }
        : {
            id: "connect",
            label: "连接设备",
            state: "attention",
            detail: `${connectedPlcIds.size}/${counts.plcs} 个主控已连接`,
            targetStep: "hardware",
          };

  const debug: WizardCapability =
    connectedMotors > 0
      ? {
          id: "debug",
          label: "单台调试",
          state: "ready",
          detail: "可以逐台设原点、点动",
        }
      : {
          id: "debug",
          label: "单台调试",
          state: "locked",
          detail: "需要主控已连接，并配置了驱动单元",
          targetStep: "hardware",
        };

  const linked = ((): WizardCapability => {
    const base = { id: "linked", label: "按物体联动" } as const;
    if (counts.axes === 0) {
      return {
        ...base,
        state: "locked",
        detail: "需要可运动的受控物体",
        targetStep: "objects",
      };
    }
    if (counts.motors === 0) {
      return {
        ...base,
        state: "locked",
        detail: "需要配置主控和驱动单元",
        targetStep: "hardware",
      };
    }
    const first = blocking[0];
    if (first) {
      return {
        ...base,
        state: "attention",
        detail: blocking.length > 1 ? `${first.message} 等 ${blocking.length} 项` : first.message,
        targetStep: first.targetStep,
      };
    }
    if (!allConnected) {
      return {
        ...base,
        state: "locked",
        detail: "全部吊点已绑定，连接主控后可用",
        targetStep: "hardware",
      };
    }
    return { ...base, state: "ready", detail: "全部吊点已绑定" };
  })();

  const show: WizardCapability = options.alignmentConfirmed
    ? { id: "show", label: "进入演出模式", state: "ready", detail: "物理对齐已确认" }
    : {
        id: "show",
        label: "进入演出模式",
        state: "locked",
        detail: "进入前要完成物理对齐确认",
      };

  return [preview, connect, debug, linked, show];
};

export type WizardStepContext = WizardReviewSetup & {
  meta: WizardMeta;
};

export const validateWizardStep = (step: WizardStepKey, ctx: WizardStepContext): string | null => {
  if (ctx.meta.skippedSteps.includes(step)) return null;

  switch (step) {
    case "objects":
      if (ctx.objects.length === 0) return "请至少添加一个受控物体";
      if (ctx.objects.some((object) => !object.name.trim())) return "请填写所有物体名称";
      return null;
    case "hardware":
      return ctx.plcs.length === 0 ? "请至少添加一个主控" : null;
    case "binding":
      return null;
    case "review":
      return null;
    default:
      return null;
  }
};

export const isWizardStepDone = (
  step: WizardStepKey,
  ctx: WizardStepContext,
  runtime?: WizardReviewRuntime,
): boolean => {
  if (ctx.meta.skippedSteps.includes(step)) return false;

  switch (step) {
    case "objects":
      return (
        ctx.objects.length > 0 &&
        ctx.objects.every((object) => object.name.trim().length > 0) &&
        !ctx.objects.some((object) => {
          if (controlTypeHasNoDriveAxes(object.controlType)) return false;
          return object.axes.length < CONTROL_TYPE_RULES[object.controlType].minimumDriveAxes;
        })
      );
    case "hardware":
      return ctx.plcs.length > 0;
    case "binding": {
      const bindableAxes = ctx.objects
        .filter((object) => !controlTypeHasNoDriveAxes(object.controlType))
        .reduce((count, object) => count + object.axes.length, 0);
      if (bindableAxes === 0) return true;
      const bound = ctx.objects.reduce(
        (count, object) => count + countBoundAxesOnObject(object, ctx.motors),
        0,
      );
      return bound > 0;
    }
    case "review":
      if (!runtime) return false;
      return !hasBlockingReviewIssues(getReviewIssues(ctx, runtime));
    default:
      return false;
  }
};
