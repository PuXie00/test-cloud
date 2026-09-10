import { useConfigWizard } from "@/app/pages/console/hooks/use-config-wizard";
import { usePlcRuntime } from "@/app/pages/console/hooks/plc-runtime-provider";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { cn } from "@/app/components/ui/utils";
import { getReviewIssues } from "../wizard-state";

export const StepReview = () => {
  const { meta, setCurrentStep } = useConfigWizard();
  const { objects, plcs, motors } = useProjectStore();
  const { getPlcRuntime } = usePlcRuntime();

  const issues = getReviewIssues(
    { objects, plcs, motors, simulationOnly: meta.simulationOnly },
    { getPlcRuntime },
  );

  if (issues.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-heading-md text-foreground">参数确认</p>
        <div className="rounded-md bg-muted p-4">
          <p className="text-body-sm text-show">参数完整</p>
          <p className="mt-1 text-body-sm text-muted-foreground">
            默认参数已通过描述配置校验，无需重复确认。
          </p>
        </div>
      </div>
    );
  }

  const blocking = issues.filter((issue) => issue.severity === "blocking");
  const warnings = issues.filter((issue) => issue.severity === "warning");

  return (
    <div className="space-y-5">
      <p className="text-heading-md text-foreground">参数确认</p>

      {blocking.length > 0 ? (
        <section className="space-y-2">
          <p className="text-label-caps text-destructive">阻断项</p>
          <ul className="space-y-2">
            {blocking.map((issue) => (
              <li
                key={`${issue.code}-${issue.message}`}
                className="flex items-center justify-between gap-3 rounded-md bg-input-background px-3 py-2"
              >
                <span className="text-body-sm text-foreground">{issue.message}</span>
                <button
                  type="button"
                  onClick={() => setCurrentStep(issue.targetStep)}
                  className="shrink-0 rounded-md border border-border px-2 py-1 text-body-sm text-primary hover:bg-accent"
                >
                  前往处理
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {warnings.length > 0 ? (
        <section className="space-y-2">
          <p className="text-label-caps text-warning">警告</p>
          <ul className="space-y-2">
            {warnings.map((issue) => (
              <li
                key={`${issue.code}-${issue.message}`}
                className="flex items-center justify-between gap-3 rounded-md bg-accent/40 px-3 py-2"
              >
                <span className="text-body-sm text-foreground">{issue.message}</span>
                <button
                  type="button"
                  onClick={() => setCurrentStep(issue.targetStep)}
                  className="shrink-0 rounded-md border border-border px-2 py-1 text-body-sm text-primary hover:bg-accent"
                >
                  前往处理
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
};
