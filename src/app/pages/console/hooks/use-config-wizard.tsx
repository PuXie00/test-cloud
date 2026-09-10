import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  WIZARD_META_STORAGE_KEY,
  WIZARD_STEPS,
} from "@/app/pages/console/components/right-sidebar/config-wizard/config-wizard-constants";
import type {
  WizardMeta,
  WizardStepKey,
  WizardStepState,
} from "@/app/pages/console/components/right-sidebar/config-wizard/config-wizard-types";
import {
  SKIPPABLE_STEPS,
  getReviewIssues,
  hasBlockingReviewIssues,
  isWizardStepDone,
  validateWizardStep,
} from "@/app/pages/console/components/right-sidebar/config-wizard/wizard-state";
import { usePlcRuntime } from "./plc-runtime-provider";
import { useProjectStore } from "./use-project-store";

const DEFAULT_META: WizardMeta = {
  currentStep: "objects",
  completedSteps: [],
  skippedSteps: [],
  simulationOnly: false,
  wizardCompleted: false,
};

const CURRENT_WIZARD_STEP_KEYS = new Set(WIZARD_STEPS.map((step) => step.key));

const normalizeMeta = (raw: Record<string, unknown>): WizardMeta => {
  if (
    typeof raw.currentStep !== "string" ||
    !CURRENT_WIZARD_STEP_KEYS.has(raw.currentStep as WizardStepKey)
  ) {
    return DEFAULT_META;
  }
  return { ...DEFAULT_META, ...raw } as WizardMeta;
};

const readMeta = (): WizardMeta => {
  if (typeof window === "undefined") return DEFAULT_META;
  try {
    const raw = window.localStorage.getItem(WIZARD_META_STORAGE_KEY);
    if (!raw) return DEFAULT_META;
    return normalizeMeta(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return DEFAULT_META;
  }
};

type ConfigWizardContextValue = {
  meta: WizardMeta;
  skipConfirmPending: boolean;
  alignedObjectIds: Set<number>;
  markAligned: (objectId: number) => void;
  setCurrentStep: (step: WizardStepKey) => void;
  goNext: () => boolean;
  goPrev: () => void;
  requestSkip: () => void;
  cancelSkipConfirm: () => void;
  completeWizard: () => boolean;
  getStepState: (step: WizardStepKey) => WizardStepState;
  canNavigateTo: (step: WizardStepKey) => boolean;
  validateCurrentStep: () => string | null;
  isCurrentStepSkipped: () => boolean;
};

const ConfigWizardContext = createContext<ConfigWizardContextValue | null>(null);

const stepIndex = (step: WizardStepKey) => WIZARD_STEPS.findIndex((item) => item.key === step);

export const ConfigWizardProvider = ({ children }: { children: ReactNode }) => {
  const { objects, plcs, motors } = useProjectStore();
  const { getPlcRuntime } = usePlcRuntime();
  const [meta, setMeta] = useState<WizardMeta>(readMeta);
  const [skipConfirmPending, setSkipConfirmPending] = useState(false);
  const [alignedObjectIds, setAlignedObjectIds] = useState<Set<number>>(() => new Set());

  const stepContext = useMemo(
    () => ({ objects, plcs, motors, simulationOnly: meta.simulationOnly, meta }),
    [meta, motors, objects, plcs],
  );

  const reviewRuntime = useMemo(
    () => ({ getPlcRuntime }),
    [getPlcRuntime],
  );

  const markAligned = useCallback((objectId: number) => {
    setAlignedObjectIds((current) => {
      if (current.has(objectId)) return current;
      const next = new Set(current);
      next.add(objectId);
      return next;
    });
  }, []);

  useEffect(() => {
    window.localStorage.setItem(WIZARD_META_STORAGE_KEY, JSON.stringify(meta));
  }, [meta]);

  const validateCurrentStep = useCallback((): string | null => {
    if (meta.currentStep === "review") {
      return hasBlockingReviewIssues(getReviewIssues(stepContext, reviewRuntime))
        ? "请先解决参数确认中的阻断项"
        : null;
    }
    return validateWizardStep(meta.currentStep, stepContext);
  }, [meta.currentStep, reviewRuntime, stepContext]);

  const deriveStepDone = useCallback(
    (step: WizardStepKey): boolean =>
      isWizardStepDone(step, stepContext, reviewRuntime),
    [reviewRuntime, stepContext],
  );

  const getStepState = useCallback(
    (step: WizardStepKey): WizardStepState => {
      if (meta.skippedSteps.includes(step)) return "skipped";
      if (step === meta.currentStep) return "current";
      if (deriveStepDone(step) || meta.completedSteps.includes(step)) return "done";
      return "pending";
    },
    [deriveStepDone, meta],
  );

  const maxReachableIndex = useMemo(() => {
    let max = 0;
    WIZARD_STEPS.forEach((step, index) => {
      const state = getStepState(step.key);
      if (state === "done" || state === "skipped" || state === "current") {
        max = Math.max(max, index);
      }
    });
    return max;
  }, [getStepState]);

  const canNavigateTo = useCallback(
    (step: WizardStepKey) => {
      const index = stepIndex(step);
      if (index < 0) return false;
      const state = getStepState(step);
      return state !== "pending" || index <= maxReachableIndex;
    },
    [getStepState, maxReachableIndex],
  );

  const setCurrentStep = useCallback(
    (step: WizardStepKey) => {
      if (!canNavigateTo(step)) return;
      setSkipConfirmPending(false);
      setMeta((current) => ({ ...current, currentStep: step }));
    },
    [canNavigateTo],
  );

  const markCurrentCompleted = useCallback(() => {
    setMeta((current) => ({
      ...current,
      completedSteps: current.completedSteps.includes(current.currentStep)
        ? current.completedSteps
        : [...current.completedSteps, current.currentStep],
    }));
  }, []);

  const goNext = useCallback(() => {
    const error = validateCurrentStep();
    if (error) {
      toast.warning(error);
      return false;
    }
    markCurrentCompleted();
    const index = stepIndex(meta.currentStep);
    const next = WIZARD_STEPS[index + 1];
    if (!next) return false;
    setSkipConfirmPending(false);
    setMeta((current) => ({ ...current, currentStep: next.key }));
    return true;
  }, [markCurrentCompleted, meta.currentStep, validateCurrentStep]);

  const goPrev = useCallback(() => {
    const index = stepIndex(meta.currentStep);
    const prev = WIZARD_STEPS[index - 1];
    if (!prev) return;
    setSkipConfirmPending(false);
    setMeta((current) => ({ ...current, currentStep: prev.key }));
  }, [meta.currentStep]);

  const requestSkip = useCallback(() => {
    if (!SKIPPABLE_STEPS.has(meta.currentStep)) return;
    if (!skipConfirmPending) {
      setSkipConfirmPending(true);
      return;
    }

    const stepDef = WIZARD_STEPS.find((item) => item.key === meta.currentStep);
    const skipped = meta.currentStep;
    const skippedSteps: WizardStepKey[] =
      skipped === "hardware"
        ? [...new Set<WizardStepKey>([...meta.skippedSteps, "hardware", "binding"])]
        : [...meta.skippedSteps, skipped];

    toast.warning(`已跳过"${stepDef?.label ?? ""}"，工程将只能进行离线仿真`);
    setSkipConfirmPending(false);

    const nextStep =
      skipped === "hardware"
        ? "review"
        : WIZARD_STEPS[stepIndex(skipped) + 1]?.key ?? meta.currentStep;

    setMeta((current) => ({
      ...current,
      skippedSteps,
      simulationOnly: skippedSteps.includes("hardware"),
      currentStep: nextStep,
    }));
  }, [meta.currentStep, meta.skippedSteps, skipConfirmPending]);

  const cancelSkipConfirm = useCallback(() => setSkipConfirmPending(false), []);

  const completeWizard = useCallback(() => {
    if (hasBlockingReviewIssues(getReviewIssues(stepContext, reviewRuntime))) {
      toast.error("请先解决参数确认中的阻断项");
      return false;
    }

    setMeta((current) => ({
      ...current,
      wizardCompleted: true,
      simulationOnly: current.skippedSteps.includes("hardware"),
      completedSteps: WIZARD_STEPS.map((step) => step.key),
    }));

    if (meta.skippedSteps.includes("hardware")) {
      toast.warning("配置向导完成，当前工程仅支持离线仿真");
    } else {
      toast.success("配置向导完成！设备已配置就绪");
    }
    return true;
  }, [meta.skippedSteps, reviewRuntime, stepContext]);

  const isCurrentStepSkipped = useCallback(
    () => meta.skippedSteps.includes(meta.currentStep),
    [meta.currentStep, meta.skippedSteps],
  );

  const value = useMemo<ConfigWizardContextValue>(
    () => ({
      meta,
      skipConfirmPending,
      alignedObjectIds,
      markAligned,
      setCurrentStep,
      goNext,
      goPrev,
      requestSkip,
      cancelSkipConfirm,
      completeWizard,
      getStepState,
      canNavigateTo,
      validateCurrentStep,
      isCurrentStepSkipped,
    }),
    [
      meta,
      skipConfirmPending,
      alignedObjectIds,
      markAligned,
      setCurrentStep,
      goNext,
      goPrev,
      requestSkip,
      cancelSkipConfirm,
      completeWizard,
      getStepState,
      canNavigateTo,
      validateCurrentStep,
      isCurrentStepSkipped,
    ],
  );

  return <ConfigWizardContext.Provider value={value}>{children}</ConfigWizardContext.Provider>;
};

export const useConfigWizard = () => {
  const ctx = useContext(ConfigWizardContext);
  if (!ctx) throw new Error("useConfigWizard must be used inside ConfigWizardProvider");
  return ctx;
};
