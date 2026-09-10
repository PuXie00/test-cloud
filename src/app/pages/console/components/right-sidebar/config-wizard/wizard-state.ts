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
