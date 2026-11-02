import { AlertTriangle, Check, Lock, type LucideIcon } from "lucide-react";
import { usePermissions } from "@/app/auth/permissions";
import { cn } from "@/app/components/ui/utils";
import { useAlignmentChecklist } from "@/app/pages/console/components/drive-debug/alignment-checklist/alignment-checklist-provider";
import { useConsoleNav } from "@/app/pages/console/hooks/use-console-nav";
import { useWizardCapabilities } from "../use-wizard-capabilities";
import { wizardBtnSecondary } from "../wizard-buttons";
import { WizardStepHeading } from "../wizard-step-heading";
import type { WizardCapability, WizardCapabilityState, WizardView } from "../wizard-state";

const STATE_ICON: Record<WizardCapabilityState, { icon: LucideIcon; className: string }> = {
  ready: { icon: Check, className: "text-show" },
  attention: { icon: AlertTriangle, className: "text-warning" },
  locked: { icon: Lock, className: "text-muted-foreground" },
};

type StepReviewProps = {
  onNavigate: (view: WizardView) => void;
};

export const StepReview = ({ onNavigate }: StepReviewProps) => {
  const capabilities = useWizardCapabilities();
  const { navigate } = useConsoleNav();
  const { can } = usePermissions();
  const { openDialog } = useAlignmentChecklist();

  const actionFor = (capability: WizardCapability): { label: string; onClick: () => void } | null => {
    if (capability.state === "ready") {
      if (capability.id === "preview" && can("action.view")) {
        return { label: "去编排动作", onClick: () => navigate("sequences") };
      }
      if (capability.id === "debug" && can("build.debug")) {
        return { label: "去调试", onClick: () => navigate("devices", { devicesTab: "debug" }) };
      }
      return null;
    }
    if (capability.id === "show") return { label: "查看确认项", onClick: openDialog };
    const target = capability.targetStep;
    return target ? { label: "去处理", onClick: () => onNavigate(target) } : null;
  };

  const mapEntries = [
    {
      label: "工程结构",
      detail: "所有物体和设备的完整参数，物体挂载也在这里",
      onClick: () => navigate("devices", { devicesTab: "structure" }),
    },
    ...(can("build.debug")
      ? [
          {
            label: "调试",
            detail: "逐台设原点、点动，确认运动范围",
            onClick: () => navigate("devices", { devicesTab: "debug" }),
          },
        ]
      : []),
    {
      label: "规则",
      detail: "互锁保护、顺序控制和故障响应",
      onClick: () => navigate("devices", { devicesTab: "rules" }),
    },
  ];

  return (
    <div className="space-y-5">
      <WizardStepHeading
        title="工程现在能做什么"
        description="这一步不会让设备运动。还没满足的项不用一次做完，随时可以回来。"
      />

      <ul className="space-y-1 rounded-md bg-muted p-2">
        {capabilities.map((capability) => {
          const { icon: Icon, className } = STATE_ICON[capability.state];
          const action = actionFor(capability);
          return (
            <li
              key={capability.id}
              className="flex min-h-12 items-center gap-3 rounded-md bg-input-background px-3 py-2"
            >
              <Icon className={cn("h-4 w-4 shrink-0", className)} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-body-md text-foreground">{capability.label}</span>
                <span className="block text-body-sm text-muted-foreground">{capability.detail}</span>
              </span>
              {action ? (
                <button type="button" className={wizardBtnSecondary} onClick={action.onClick}>
                  {action.label}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      <section className="space-y-2">
        <h3 className="text-heading-md font-semibold text-foreground">之后去哪里继续</h3>
        <div className="grid grid-cols-2 gap-2">
          {mapEntries.map((entry) => (
            <button
              key={entry.label}
              type="button"
              onClick={entry.onClick}
              className="flex min-w-0 flex-col items-start gap-0.5 rounded-md bg-muted p-3 text-left hover:bg-accent"
            >
              <span className="text-body-md font-medium text-foreground">{entry.label}</span>
              <span className="text-body-sm text-muted-foreground">{entry.detail}</span>
            </button>
          ))}
          <div className="flex min-w-0 flex-col gap-0.5 rounded-md bg-muted p-3">
            <span className="text-body-md font-medium text-foreground">3D 视口</span>
            <span className="text-body-sm text-muted-foreground">
              拖入形状、摆放物体，把电机拖到吊点上
            </span>
          </div>
        </div>
      </section>
    </div>
  );
};
