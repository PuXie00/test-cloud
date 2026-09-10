import { useMemo, useState } from "react";
import { CollapsePanel } from "@/app/components/ics/collapse-panel";
import { Form } from "@/app/components/ui/forms";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import {
  getDefaultPlcRegistryEntry,
  plcModelSelectOptions,
} from "@/app/pages/console/hooks/motor-config";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import type { Plc } from "../config-wizard/config-wizard-types";
import { MasterConnectionSummary } from "./master-connection-summary";
import { MotorReconciliationPanel } from "./motor-reconciliation-panel";

type PlcFormProps = { plcId: number };

type PlcFormValues = Pick<Plc, "ip" | "masterTypeId">;

export const PlcForm = ({ plcId }: PlcFormProps) => {
  const { findPlc, updatePlc } = useProjectStore();
  const [reconciliationOpen, setReconciliationOpen] = useState(false);
  const plc = findPlc(plcId);

  const masterTypeOptions = useMemo(() => plcModelSelectOptions(), []);
  const defaultMasterId = getDefaultPlcRegistryEntry().productModel;

  if (!plc) return null;

  const handleValuesChange = (_changed: Partial<PlcFormValues>, all: PlcFormValues) => {
    updatePlc(plcId, {
      ip: all.ip,
      masterTypeId: all.masterTypeId,
    });
  };

  const initialValues: PlcFormValues = {
    ip: plc.ip,
    masterTypeId: plc.masterTypeId || defaultMasterId,
  };

  return (
    <div className="min-w-0 space-y-2 p-3">
      <CollapsePanel title="主控配置">
        <Form
          key={plcId}
          layout="horizontal"
          labelWidth={96}
          className="space-y-3"
          initialValues={initialValues}
          onValuesChange={handleValuesChange}
        >
          <Form.Item label="IP 地址" name="ip">
            <Input aria-label="IP 地址" />
          </Form.Item>
          <Form.Item label="主控型号" name="masterTypeId">
            <Select options={masterTypeOptions} aria-label="主控型号" />
          </Form.Item>
        </Form>
      </CollapsePanel>

      <MasterConnectionSummary
        plcId={plcId}
        onOpenReconciliation={() => setReconciliationOpen(true)}
      />

      <MotorReconciliationPanel
        key={reconciliationOpen ? `${plcId}-open` : `${plcId}-closed`}
        plcId={plcId}
        defaultOpen={reconciliationOpen}
      />
    </div>
  );
};
