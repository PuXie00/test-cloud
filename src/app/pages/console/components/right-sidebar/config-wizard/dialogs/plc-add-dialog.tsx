import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useMemo } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Form } from "@/app/components/ui/forms";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import {
  getDefaultPlcRegistryEntry,
  plcModelSelectOptions,
} from "@/app/pages/console/hooks/motor-config";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { formatPlcDisplayName } from "@/app/pages/console/hooks/plc-display-name";

type PlcAddDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type PlcAddFormValues = {
  ip: string;
  masterTypeId: string;
};

export const PlcAddDialog = ({ open, onOpenChange }: PlcAddDialogProps) => {
  const { plcs, addPlc } = useProjectStore();

  const masterTypeOptions = useMemo(() => plcModelSelectOptions(), [open]);
  const defaultMaster = useMemo(() => getDefaultPlcRegistryEntry(), [open]);

  const initialValues = useMemo<PlcAddFormValues>(() => {
    const nextIndex = plcs.length;
    return {
      ip: `192.168.1.3${nextIndex}`,
      masterTypeId: masterTypeOptions[0]?.value ?? defaultMaster.productModel,
    };
  }, [open, plcs.length, masterTypeOptions, defaultMaster.productModel]);

  const handleFinish = (values: PlcAddFormValues) => {
    const plc = addPlc({
      ip: values.ip,
      masterTypeId: values.masterTypeId,
    });
    if (!plc) return;
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="bg-background/80 backdrop-blur-sm" />
        <DialogPrimitive.Content className="fixed top-[50%] left-[50%] z-50 w-full max-w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-card shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
          <div className="bg-muted px-4 py-3">
            <DialogTitle className="text-heading-md font-semibold">手动添加主控</DialogTitle>
          </div>
          <Form
            key={`plc-add-${plcs.length}`}
            layout="vertical"
            initialValues={initialValues}
            onFinish={handleFinish}
            onFinishFailed={() => toast.warning("请检查表单填写")}
            className="space-y-3 bg-background p-4"
          >
            <Form.Item label="IP 地址" name="ip" rules={[{ required: true, message: "请输入 IP" }]}>
              <Input placeholder="IP 地址" aria-label="IP 地址" />
            </Form.Item>
            <Form.Item label="主控型号" name="masterTypeId">
              <Select options={masterTypeOptions} aria-label="主控型号" />
            </Form.Item>
            <div className="-mx-4 -mb-4 flex justify-end gap-2 bg-muted px-4 py-3">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-md border border-border px-3 py-2 text-body-sm"
              >
                取消
              </button>
              <button
                type="submit"
                className="rounded-md bg-primary px-4 py-2 text-body-sm font-semibold text-primary-foreground"
              >
                添加
              </button>
            </div>
          </Form>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
};
