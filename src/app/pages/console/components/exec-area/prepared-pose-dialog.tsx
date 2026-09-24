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
  onConfirm: () => void;
};

export const PreparedPoseDialog = ({ open, onConfirm }: PreparedPoseDialogProps) => (
  <AlertDialog open={open}>
    <AlertDialogContent className="border-0 bg-card shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
      <AlertDialogHeader>
        <AlertDialogTitle className="text-sm font-semibold leading-5 text-foreground">
          当前未在准备位姿，请重新准备
        </AlertDialogTitle>
        <AlertDialogDescription className="sr-only">确认后需要重新准备。</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <button
          type="button"
          className="h-10 rounded-md bg-primary px-3 font-semibold text-primary-foreground"
          onClick={onConfirm}
        >
          确认
        </button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
