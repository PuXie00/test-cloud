import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useEffect, useMemo } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { toast } from "sonner";
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Form } from "@/app/components/ui/forms";
import { formLabelClass } from "@/app/components/ui/forms/form-tokens";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import {
  getDefaultMotorRegistryEntry,
  motorModelSelectOptions,
} from "@/app/pages/console/hooks/motor-config";
import {
  DEFAULT_BUS_NO,
  getPlcBusLimitsForPlc,
  isBusNo,
  remainingBusSlots,
  type PlcBusLimits,
} from "@/app/pages/console/hooks/motor-bus";
import { formatMotorDisplayName } from "@/app/pages/console/hooks/motor-mid";
import { formatPlcDisplayName } from "@/app/pages/console/hooks/plc-display-name";
import { type InsertMotorsPosition } from "@/app/pages/console/hooks/setup-operations";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import type {
  BusNo,
  Motor,
  Plc,
} from "@/app/pages/console/components/right-sidebar/config-wizard/config-wizard-types";
type MotorAddDialogMode = "add" | "insert";

type MotorAddDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: MotorAddDialogMode;
  /** 锁定的所属主控，不可更改 */
  plcId: number;
  /** insert 模式：锚点电机 */
  anchorMotorId?: number;
  /** insert 模式：插入位置（由标题体现，不进表单） */
  initialPosition?: InsertMotorsPosition;
};

type MotorAddFormValues = {
  productModel: string;
  count: number;
  busNo: string;
};

const BUS_OPTIONS = [
  { label: "C口", value: "0" },
  { label: "D口", value: "1" },
];

const resolveBusNo = (raw: unknown, fallback: BusNo = DEFAULT_BUS_NO): BusNo => {
  const value = Number(raw);
  return isBusNo(value) ? value : fallback;
};

const busCapacity = (limits: PlcBusLimits | null, busNo: BusNo): number | null => {
  if (!limits) return null;
  return busNo === 0 ? limits.maxAxisPerC : limits.maxAxisPerD;
};

const clampCount = (value: number, max: number) => {
  if (max <= 0) return 0;
  return Math.min(max, Math.max(1, Math.floor(value)));
};

type CountFieldProps = {
  plcId: number;
  motors: readonly Motor[];
  plcs: readonly Plc[];
};

const MotorAddCountField = ({ plcId, motors, plcs }: CountFieldProps) => {
  const { setValue } = useFormContext<MotorAddFormValues>();
  const watchedBusNo = useWatch<MotorAddFormValues, "busNo">({ name: "busNo" });
  const count = useWatch<MotorAddFormValues, "count">({ name: "count" });

  const busNo = resolveBusNo(watchedBusNo);
  const limits = getPlcBusLimitsForPlc(plcId, plcs);
  const capacity = busCapacity(limits, busNo);
  const remaining = remainingBusSlots(motors, plcId, busNo, limits);
  const countMax = Number.isFinite(remaining) ? remaining : Number.POSITIVE_INFINITY;
  const inputMax = Number.isFinite(countMax) ? countMax : undefined;

  useEffect(() => {
    const next = clampCount(Number(count) || 0, countMax);
    if (Number(count) !== next) {
      setValue("count", next, { shouldDirty: true });
    }
  }, [count, countMax, setValue]);

  const hint =
    capacity == null ? "容量未加载" : `还可添加 ${remaining}`;

  return (
    <div className="space-y-1.5">
      <label className={formLabelClass} htmlFor="motor-add-count">
        添加数量
      </label>
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1">
          <Form.Item
            name="count"
            noStyle
            rules={[{ required: true, message: "请输入数量" }]}
          >
            <Input
              id="motor-add-count"
              type="number"
              showStepper
              min={countMax > 0 ? 1 : 0}
              max={inputMax}
              step={1}
              disabled={Number.isFinite(countMax) && countMax <= 0}
              aria-label="添加数量"
              className="font-mono tabular-nums"
            />
          </Form.Item>
        </div>
        <span className="shrink-0 font-mono text-body-sm tabular-nums text-muted-foreground">
          {hint}
        </span>
      </div>
    </div>
  );
};

export const MotorAddDialog = ({
  open,
  onOpenChange,
  mode = "add",
  plcId,
  anchorMotorId,
  initialPosition = "after",
}: MotorAddDialogProps) => {
  const { plcs, motors, addMotor, insertMotorsRelative, findMotor } = useProjectStore();
  const defaultModel = getDefaultMotorRegistryEntry();
  const plc = plcs.find((item) => item.id === plcId);
  const anchor = anchorMotorId ? findMotor(anchorMotorId) : undefined;

  const busLimits = getPlcBusLimitsForPlc(plcId, plcs);
  const dPortDisabled = busLimits !== null && busLimits.maxAxisPerD <= 0;

  const initialValues = useMemo<MotorAddFormValues>(() => {
    const busNo =
      mode === "insert" && anchor ? anchor.busNo : DEFAULT_BUS_NO;
    const limits = getPlcBusLimitsForPlc(plcId, plcs);
    const remaining = remainingBusSlots(motors, plcId, busNo, limits);
    const countMax = Number.isFinite(remaining) ? remaining : Number.POSITIVE_INFINITY;
    return {
      productModel:
        mode === "insert" && anchor
          ? anchor.productModel
          : defaultModel.productModel,
      count: clampCount(1, countMax),
      busNo: String(busNo),
    };
  }, [
    open,
    mode,
    anchor?.productModel,
    anchor?.busNo,
    defaultModel.productModel,
    plcId,
    plcs,
    motors,
  ]);

  const modelOptions = useMemo(() => motorModelSelectOptions(), []);
  const busSelectOptions = BUS_OPTIONS.map((option) => ({
    ...option,
    disabled: option.value === "1" && dPortDisabled,
  }));

  const handleFinish = (values: MotorAddFormValues) => {
    // plcId 可为 0（全局实体 id 从 0 起），不能用 !plcId
    if (!plc) {
      toast.warning("请先添加 PLC");
      return;
    }
    const productModel = values.productModel || defaultModel.productModel;
    if (!productModel) {
      toast.warning("请选择产品型号");
      return;
    }
    const busNo = resolveBusNo(values.busNo);
    const limits = getPlcBusLimitsForPlc(plcId, plcs);
    const allowed = remainingBusSlots(motors, plcId, busNo, limits);
    const countMax = Number.isFinite(allowed) ? allowed : Number.POSITIVE_INFINITY;
    const count = clampCount(Number(values.count) || 0, countMax);
    if (count <= 0) {
      toast.warning("该从站口已达 PLC 最大接线数量");
      return;
    }

    if (mode === "insert") {
      if (anchorMotorId == null || !anchor) {
        toast.warning("缺少锚点电机");
        return;
      }
      const inserted = insertMotorsRelative(
        anchorMotorId,
        initialPosition,
        count,
        productModel,
        busNo,
      );
      if (inserted.length === 0) {
        toast.warning("该从站口已达 PLC 最大接线数量，无法插入");
        return;
      }
      const withoutDup = motors.filter((m) => !inserted.some((i) => i.id === m.id));
      const anchorIndex = withoutDup.findIndex((m) => m.id === anchorMotorId);
      const at =
        anchorIndex < 0
          ? withoutDup.length
          : initialPosition === "before"
            ? anchorIndex
            : anchorIndex + 1;
      const nextMotors = [
        ...withoutDup.slice(0, at),
        ...inserted,
        ...withoutDup.slice(at),
      ];
      toast.success(
        inserted.length === 1
          ? `已插入: ${formatMotorDisplayName(nextMotors, inserted[0]!)}`
          : `已插入 ${inserted.length} 个驱动单元`,
      );
      onOpenChange(false);
      return;
    }

    const createdList = addMotor({ productModel, plcId, busNo }, count);
    if (createdList.length === 0) {
      toast.warning("该从站口已达 PLC 最大接线数量");
      return;
    }
    const nextMotors = [...motors, ...createdList];
    toast.success(
      createdList.length === 1
        ? `已添加: ${formatMotorDisplayName(nextMotors, createdList[0]!)}`
        : `已添加 ${createdList.length} 个驱动单元`,
    );
    onOpenChange(false);
  };

  if (!open) return null;

  const title =
    mode === "insert"
      ? initialPosition === "before"
        ? "向上方插入驱动单元"
        : "向下方插入驱动单元"
      : "手动添加驱动单元";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="bg-background/80 backdrop-blur-sm" />
        <DialogPrimitive.Content className="fixed top-[50%] left-[50%] z-50 w-full max-w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-card shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
          <div className="bg-muted px-4 py-3">
            <DialogTitle className="text-heading-md font-semibold">{title}</DialogTitle>
          </div>
          <Form
            key={`motor-${mode}-${plcId}-${anchorMotorId ?? ""}-${initialPosition}-${motors.length}`}
            layout="vertical"
            initialValues={initialValues}
            onFinish={handleFinish}
            onFinishFailed={() => toast.warning("请检查表单填写")}
            className="space-y-3 bg-background p-4"
          >
            <Form.Item label="产品型号" name="productModel">
              <Select options={modelOptions} />
            </Form.Item>
            <Form.Item label="从站口" name="busNo">
              <Select options={busSelectOptions} aria-label="从站口" />
            </Form.Item>
            <MotorAddCountField plcId={plcId} motors={motors} plcs={plcs} />
            <Form.Item label="所属主控">
              <Input
                readOnly
                value={plc ? formatPlcDisplayName(plcs, plc) : "—"}
                aria-label="所属主控"
              />
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
                {mode === "insert" ? "插入" : "添加"}
              </button>
            </div>
          </Form>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
};
