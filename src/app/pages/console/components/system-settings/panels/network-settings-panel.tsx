import { Input } from "@/app/components/ui/input";
import { NETWORK_PLACEHOLDER } from "../system-settings-constants";
import { SettingsFieldRow } from "../settings-field-row";
import { SettingsSection } from "../settings-section";

export const NetworkSettingsPanel = () => (
  <div className="flex max-w-2xl flex-col gap-8">
    <SettingsSection title="网络配置">
      <SettingsFieldRow label="本机 IP">
        <Input
          defaultValue={NETWORK_PLACEHOLDER.ip}
          className="w-48 bg-input-background font-mono tabular-nums"
        />
      </SettingsFieldRow>
      <SettingsFieldRow label="子网掩码">
        <Input
          defaultValue={NETWORK_PLACEHOLDER.subnet}
          className="w-48 bg-input-background font-mono tabular-nums"
        />
      </SettingsFieldRow>
      <SettingsFieldRow label="默认网关">
        <Input
          defaultValue={NETWORK_PLACEHOLDER.gateway}
          className="w-48 bg-input-background font-mono tabular-nums"
        />
      </SettingsFieldRow>
      <SettingsFieldRow label="DNS">
        <Input
          defaultValue={NETWORK_PLACEHOLDER.dns}
          className="w-48 bg-input-background font-mono tabular-nums"
        />
      </SettingsFieldRow>
      <SettingsFieldRow label="通讯端口">
        <Input
          defaultValue={NETWORK_PLACEHOLDER.port}
          className="w-48 bg-input-background font-mono tabular-nums"
        />
      </SettingsFieldRow>
    </SettingsSection>
  </div>
);
