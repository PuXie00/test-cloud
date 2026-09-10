import type { MouseEvent } from "react";
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
import type { ObjectDeletionImpact } from "@/app/project/project-object-deletion";
import { formatObjectDeletionImpact } from "@/app/pages/console/hooks/object-deletion-impact-format";
import type { DeleteImpact } from "./project-structure-tree-data";

type DeleteImpactDialogProps = {
  impact?: DeleteImpact | null;
  objectImpact?: ObjectDeletionImpact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Return `false` to keep the dialog open (blocks AlertDialogAction auto-close). */
  onConfirm: () => boolean | void;
  error?: string | null;
};

export const DeleteImpactDialog = ({
  impact = null,
  objectImpact = null,
  open,
  onOpenChange,
  onConfirm,
  error = null,
}: DeleteImpactDialogProps) => {
  if (!impact && !objectImpact) return null;

  const objectView = objectImpact ? formatObjectDeletionImpact(objectImpact) : null;
  const title = objectView
    ? `确认${objectView.confirmLabel}`
    : `确认${impact!.confirmLabel}`;
  const confirmLabel = objectView?.confirmLabel ?? impact!.confirmLabel;
  const summary = objectView?.summary ?? impact!.summary;

  const handleConfirmClick = (event: MouseEvent<HTMLButtonElement>) => {
    const allowClose = onConfirm();
    if (allowClose === false) {
      event.preventDefault();
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-card">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-body-sm text-muted-foreground">
              <p>{summary}</p>
              {objectView && objectView.detailLines.length > 0 ? (
                <ul className="list-disc space-y-1 pl-5">
                  {objectView.detailLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
              {objectView && objectView.warningLines.length > 0 ? (
                <ul className="list-disc space-y-1 pl-5">
                  {objectView.warningLines.map((line) => (
                    <li key={line} className="text-warning">
                      {line}
                    </li>
                  ))}
                </ul>
              ) : null}
              {error ? (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirmClick}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export type { DeleteImpact };
