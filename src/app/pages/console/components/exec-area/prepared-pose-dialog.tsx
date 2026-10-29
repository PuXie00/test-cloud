import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";

type PreparedPoseDialogProps = {
  open: boolean;
  onCancelReady: () => void;
  onReprepare: () => void;
};

export const PreparedPoseDialog = ({ open, onCancelReady, onReprepare }: PreparedPoseDialogProps) => (
  <AlertDialog open={open}>
    <AlertDialogContent className="border-0 bg-card shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
      <AlertDialogHeader>
        <AlertDialogTitle className="text-sm font-semibold leading-5 text-foreground">
          设备在准备后被移动过
        </AlertDialogTitle>
        <AlertDialogDescription className="text-body-md text-foreground">
          设备离开了准备时的位置，准备时算好的接入方案已经不准，不能直接 GO。重新准备会按现在的位置再算一次。
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <button
          type="button"
          className="h-10 rounded-md border border-border px-3 text-foreground hover:bg-accent"
          onClick={onCancelReady}
        >
          取消准备
        </button>
        <button
          type="button"
          className="h-10 rounded-md bg-primary px-3 font-semibold text-primary-foreground"
          onClick={onReprepare}
        >
          重新准备
        </button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
