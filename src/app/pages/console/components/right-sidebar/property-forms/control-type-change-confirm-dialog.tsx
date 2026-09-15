import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import type { ControlTypeChangeImpact } from "@/app/pages/console/hooks/control-type-change";

type ControlTypeChangeConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetLabel: string;
  impact: ControlTypeChangeImpact;
  onConfirm: () => void;
};

const SummaryRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between gap-4 py-1">
    <span className="text-body-sm text-muted-foreground">{label}</span>
    <span className="font-mono text-mono-md tabular-nums text-foreground">{value}</span>
  </div>
);

export const ControlTypeChangeConfirmDialog = ({
  open,
  onOpenChange,
  targetLabel,
  impact,
  onConfirm,
}: ControlTypeChangeConfirmDialogProps) => {
  const hasMotion = impact.affectedSequenceTracks > 0;
  const hasAny = impact.changed;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-card">
        <AlertDialogHeader>
          <AlertDialogTitle>切换控制类型为「{targetLabel}」</AlertDialogTitle>
          <AlertDialogDescription>本次切换将产生以下变更，请确认：</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-md bg-background px-4 py-2">
          {impact.removedDriveAxes > 0 && (
            <SummaryRow
              label="删除驱动轴"
              value={`${impact.removedDriveAxes} 个（解绑 ${impact.unboundMotors} 台电机）`}
            />
          )}
          {impact.axisTypeChangeMotors > 0 && (
            <SummaryRow label="电机轴类型变更" value={`${impact.axisTypeChangeMotors} 台`} />
          )}
          {hasMotion && (
            <SummaryRow
              label="清理运动数据"
              value={`${impact.affectedSequenceTracks} 条轨道 / ${impact.affectedBlocks} 个片段`}
            />
          )}
          {!hasAny && (
            <SummaryRow label="无需要确认的变更" value="—" />
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>确认切换</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
