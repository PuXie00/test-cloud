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
import type { ProgramNode } from "../timeline/timeline-data";
import { useActionBuilder } from "../use-action-builder";

type SequenceDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** 节目里引用这条序列的次数 */
const countProgramRefs = (nodes: readonly ProgramNode[], sequenceId: string): number =>
  nodes.reduce(
    (count, node) =>
      count +
      (node.type === "sequence" && node.id === sequenceId ? 1 : 0) +
      countProgramRefs(node.children ?? [], sequenceId),
    0,
  );

export const SequenceDeleteDialog = ({ open, onOpenChange }: SequenceDeleteDialogProps) => {
  const { sequence, programs, handleDeleteSequence } = useActionBuilder();
  if (!sequence) return null;
  const refs = countProgramRefs(programs ?? [], String(sequence.id));

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-card">
        <AlertDialogHeader>
          <AlertDialogTitle>删除动作序列「{sequence.name}」</AlertDialogTitle>
          <AlertDialogDescription>
            {refs > 0
              ? `节目中有 ${refs} 处用到这条序列，删除后会一并移除。确定删除吗？`
              : "确定删除这条动作序列吗？"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDeleteSequence}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
