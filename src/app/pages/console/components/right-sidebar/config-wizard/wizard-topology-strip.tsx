import { ChevronRight, Link2 } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { getWizardCounts, type WizardSetup, type WizardView } from "./wizard-state";

type SegmentProps = {
  label: string;
  value: string;
  active: boolean;
};

const Segment = ({ label, value, active }: SegmentProps) => (
  <span className={cn("whitespace-nowrap", active ? "text-primary" : "text-muted-foreground")}>
    {label}{" "}
    <span
      className={cn(
        "font-mono text-mono-md tabular-nums",
        active ? "text-primary" : "text-foreground",
      )}
    >
      {value}
    </span>
  </span>
);

const Arrow = () => <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />;

type WizardTopologyStripProps = {
  view: WizardView;
  setup: WizardSetup;
};

/** 搭建的结构一直摆在眼前：物体的吊点，通过绑定对应到主控带的驱动单元；当前步骤处理哪段就高亮哪段 */
export const WizardTopologyStrip = ({ view, setup }: WizardTopologyStripProps) => {
  const counts = getWizardCounts(setup);
  return (
    <div
      className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 bg-card px-4 py-1.5 text-body-sm"
      aria-label="工程结构概览"
    >
      <Segment label="受控物体" value={String(counts.objects)} active={view === "objects"} />
      <Arrow />
      <Segment label="吊点" value={String(counts.axes)} active={view === "objects"} />
      <Link2 className="ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <Segment
        label="已绑定"
        value={`${counts.boundAxes}/${counts.axes}`}
        active={view === "binding"}
      />
      <Link2 className="mr-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <Segment label="驱动单元" value={String(counts.motors)} active={view === "hardware"} />
      <Arrow />
      <Segment label="主控" value={String(counts.plcs)} active={view === "hardware"} />
    </div>
  );
};
