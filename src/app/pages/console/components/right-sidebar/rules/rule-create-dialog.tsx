import { useNavigate } from "react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { RuleTemplatePicker, type RuleTemplateChoice } from "./rule-template-picker";

type RuleCreateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const toEditorUrl = (choice: RuleTemplateChoice) =>
  choice === "blank" ? "/console/rule/new?template=blank" : `/console/rule/new?template=${choice}`;

export const RuleCreateDialog = ({ open, onOpenChange }: RuleCreateDialogProps) => {
  const navigate = useNavigate();

  const handleConfirm = (choice: RuleTemplateChoice) => {
    onOpenChange(false);
    navigate(toEditorUrl(choice));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(640px,90vh)] overflow-hidden p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b border-border px-4 py-3 text-left">
          <DialogTitle className="text-heading-md">新建规则</DialogTitle>
          <DialogDescription className="text-body-sm">
            创建前先选择模板类型，可在编辑器中继续调整。
          </DialogDescription>
        </DialogHeader>
        <div className="px-4 pb-4">
          <RuleTemplatePicker
            showHeader={false}
            onConfirm={handleConfirm}
            onCancel={() => onOpenChange(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};
