import { Checkbox } from "@/app/components/ui/checkbox";
import { Label } from "@/app/components/ui/label";
import { Slider } from "@/app/components/ui/slider";
import { Switch } from "@/app/components/ui/switch";
import { SettingsFieldRow } from "../settings-field-row";
import { SettingsSection } from "../settings-section";

export const NotificationsPanel = () => (
  <div className="flex max-w-2xl flex-col gap-8">
    <SettingsSection title="通知与声音">
      <SettingsFieldRow label="提示音">
        <Switch defaultChecked aria-label="提示音开关" />
        <Slider defaultValue={[70]} max={100} step={1} className="w-32" />
        <span className="w-10 text-right font-mono text-mono-sm tabular-nums text-muted-foreground">
          70%
        </span>
      </SettingsFieldRow>

      <SettingsFieldRow label="报警音">
        <Switch defaultChecked aria-label="报警音开关" />
        <Slider defaultValue={[85]} max={100} step={1} className="w-32" />
        <span className="w-10 text-right font-mono text-mono-sm tabular-nums text-muted-foreground">
          85%
        </span>
      </SettingsFieldRow>

      <SettingsFieldRow label="报警级别">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Checkbox id="alarm-warning" defaultChecked />
            <Label htmlFor="alarm-warning" className="text-body-md text-foreground">
              警告
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="alarm-fault" defaultChecked />
            <Label htmlFor="alarm-fault" className="text-body-md text-foreground">
              故障
            </Label>
          </div>
        </div>
      </SettingsFieldRow>
    </SettingsSection>
  </div>
);
