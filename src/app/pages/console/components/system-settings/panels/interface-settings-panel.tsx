import { useState } from "react";
import { toast } from "sonner";
import { Label } from "@/app/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/app/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import {
  type DisplayLengthUnit,
  parseDisplayLengthUnit,
  readStoredDisplayLengthUnit,
  writeStoredDisplayLengthUnit,
} from "@/app/project/display-length-units";
import { SettingsFieldRow } from "../settings-field-row";
import { SettingsSection } from "../settings-section";

const DISPLAY_UNIT_OPTIONS: { value: DisplayLengthUnit; label: string }[] = [
  { value: "m", label: "米" },
  { value: "cm", label: "厘米" },
  { value: "mm", label: "毫米" },
  { value: "in", label: "英寸" },
];

export const InterfaceSettingsPanel = () => {
  const [storedUnit, setStoredUnit] = useState<DisplayLengthUnit>(() =>
    readStoredDisplayLengthUnit(),
  );

  const handleUnitChange = (next: DisplayLengthUnit) => {
    const ok = writeStoredDisplayLengthUnit(next);
    if (!ok) {
      toast.error("显示单位保存失败");
      return;
    }
    setStoredUnit(next);
    toast.message("显示单位将在重启后生效");
  };

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <SettingsSection title="界面设置">
        <SettingsFieldRow label="语言选择">
          <Select defaultValue="zh-cn">
            <SelectTrigger className="w-48 bg-input-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh-cn">简体中文</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </SettingsFieldRow>

        <SettingsFieldRow label="主题/样式">
          <Select defaultValue="dark">
            <SelectTrigger className="w-48 bg-input-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dark">深色</SelectItem>
              <SelectItem value="light">浅色</SelectItem>
            </SelectContent>
          </Select>
        </SettingsFieldRow>

        <SettingsFieldRow label="显示单位">
          <RadioGroup
            value={storedUnit}
            onValueChange={(v) => handleUnitChange(parseDisplayLengthUnit(v))}
            className="flex flex-row gap-4"
          >
            {DISPLAY_UNIT_OPTIONS.map((item) => (
              <div key={item.value} className="flex items-center gap-2">
                <RadioGroupItem value={item.value} id={`unit-${item.value}`} />
                <Label
                  htmlFor={`unit-${item.value}`}
                  className="cursor-pointer text-body-md normal-case tracking-normal text-muted-foreground peer-data-[state=checked]:text-foreground"
                >
                  {item.label}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </SettingsFieldRow>

        <SettingsFieldRow label="时间格式">
          <RadioGroup defaultValue="24h" className="flex flex-row gap-4">
            {[
              { value: "24h", label: "24 小时制" },
              { value: "12h", label: "12 小时制" },
            ].map((item) => (
              <div key={item.value} className="flex items-center gap-2">
                <RadioGroupItem value={item.value} id={`time-${item.value}`} />
                <Label
                  htmlFor={`time-${item.value}`}
                  className="cursor-pointer text-body-md normal-case tracking-normal text-muted-foreground peer-data-[state=checked]:text-foreground"
                >
                  {item.label}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </SettingsFieldRow>
      </SettingsSection>
    </div>
  );
};
