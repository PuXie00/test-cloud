import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { cn } from "@/app/components/ui/utils";
import { HOST_ROLE_LABEL } from "./collab-constants";
import { COLLAB_SURFACES } from "./collab-surfaces";
import type { HostRecord, HostRole } from "./collab-types";

type AddHostFormProps = {
  existingIps: string[];
  onConfirm: (host: Omit<HostRecord, "id" | "configured">) => void;
  onCancel: () => void;
};

export const AddHostForm = ({ existingIps, onConfirm, onCancel }: AddHostFormProps) => {
  const [hostname, setHostname] = useState("");
  const [ip, setIp] = useState("");
  const [role, setRole] = useState<HostRole>("observer");
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = () => {
    const trimmedName = hostname.trim();
    const trimmedIp = ip.trim();

    if (!trimmedName) {
      setError("请输入主机名");
      return;
    }

    const ipv4Pattern =
      /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$/;

    if (!ipv4Pattern.test(trimmedIp)) {
      setError("请输入有效的 IPv4 地址");
      return;
    }

    if (existingIps.includes(trimmedIp)) {
      setError("该 IP 已存在于列表中");
      return;
    }

    onConfirm({ hostname: trimmedName, ip: trimmedIp, role });
  };

  return (
    <div className={cn("flex flex-col gap-3 rounded-md p-3", COLLAB_SURFACES.recessed)}>
      <div className="grid grid-cols-3 gap-3">
        <Input
          value={hostname}
          onChange={(event) => {
            setHostname(event.target.value);
            setError(null);
          }}
          placeholder="主机名"
          className="bg-background"
          aria-label="主机名"
        />
        <Input
          value={ip}
          onChange={(event) => {
            setIp(event.target.value);
            setError(null);
          }}
          placeholder="IP 地址"
          className="bg-background font-mono tabular-nums"
          aria-label="IP 地址"
        />
        <Select value={role} onValueChange={(value) => setRole(value as HostRole)}>
          <SelectTrigger className="bg-background" aria-label="角色">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(HOST_ROLE_LABEL) as HostRole[]).map((roleId) => (
              <SelectItem key={roleId} value={roleId}>
                {HOST_ROLE_LABEL[roleId]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error && (
        <p className="text-body-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          取消
        </Button>
        <Button type="button" size="sm" onClick={handleConfirm}>
          确认
        </Button>
      </div>
    </div>
  );
};
