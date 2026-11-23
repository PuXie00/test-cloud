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
import { axisTypeLabel, type AxisTypeRewrite } from "@/app/pages/console/hooks/binding-utils";
import { formatMotorDisplayName } from "@/app/pages/console/hooks/motor-mid";
import type { Motor } from "./config-wizard/config-wizard-types";

type AxisTypeRewriteConfirmDialogProps = {
  rewrites: readonly AxisTypeRewrite[];
  motors: readonly Motor[];
  onConfirm: () => void;
  onCancel: () => void;
};

export const AxisTypeRewriteConfirmDialog = ({
  rewrites,
  motors,
  onConfirm,
  onCancel,
}: AxisTypeRewriteConfirmDialogProps) => {
  const handleOpenChange = (open: boolean) => {
    if (!open) onCancel();
  };

  return (
    <AlertDialog open={rewrites.length > 0} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="bg-card">
        <AlertDialogHeader>
          <AlertDialogTitle>改写电机轴类型</AlertDialogTitle>
          <AlertDialogDescription>
            以下电机的轴类型与绑定物体的控制类型不一致。确认后改写轴类型并绑定，取消则不绑定。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="max-h-60 overflow-y-auto rounded-md bg-background px-4 py-2">
          {rewrites.map(({ motor, from, to }) => (
            <li key={motor.id} className="flex items-center justify-between gap-4 py-1">
              <span className="min-w-0 truncate font-mono text-mono-md tabular-nums text-foreground">
                {formatMotorDisplayName(motors, motor)}
              </span>
              <span className="shrink-0 text-body-sm">
                <span className="text-muted-foreground">{axisTypeLabel(from)}</span>
                <span className="px-2 text-muted-foreground" aria-hidden>
                  →
                </span>
                <span className="text-warning">{axisTypeLabel(to)}</span>
              </span>
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>取消绑定</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>改写并绑定</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
