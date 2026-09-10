import { AlertTriangle, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Checkbox } from "@/app/components/ui/checkbox";
import { ScrollArea } from "@/app/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { cn } from "@/app/components/ui/utils";
import { AddHostForm } from "../add-host-form";
import { CollabField } from "../collab-field";
import { CollabSection } from "../collab-section";
import { FAILOVER_OPTIONS, SYNC_CONTENT_LABELS } from "../collab-constants";
import { COLLAB_SURFACES } from "../collab-surfaces";
import type { HostRecord, PrimaryBackupState } from "../collab-types";
import { HostListItem } from "../host-list-item";
import { TopologyDiagram } from "../topology-diagram";

type PrimaryBackupPanelProps = {
  state: PrimaryBackupState;
  onChange: (state: PrimaryBackupState) => void;
};

export const PrimaryBackupPanel = ({ state, onChange }: PrimaryBackupPanelProps) => {
  const [showAddForm, setShowAddForm] = useState(false);

  const primaryHost = useMemo(
    () => state.hosts.find((host) => host.role === "primary"),
    [state.hosts],
  );
  const standbyHost = useMemo(
    () => state.hosts.find((host) => host.role === "standby"),
    [state.hosts],
  );

  const update = (patch: Partial<PrimaryBackupState>) => {
    onChange({ ...state, ...patch });
  };

  const handleRescan = () => {
    toast.info("正在扫描网络（演示）");
  };

  const handleAddHost = (host: Omit<HostRecord, "id" | "configured">) => {
    const newHost: HostRecord = {
      ...host,
      id: `h-${Date.now()}`,
      configured: false,
    };
    update({ hosts: [...state.hosts, newHost] });
    setShowAddForm(false);
    toast.success("主机已添加（演示）");
  };

  const toggleSyncContent = (key: keyof PrimaryBackupState["syncContent"], checked: boolean) => {
    update({
      syncContent: { ...state.syncContent, [key]: checked },
    });
  };

  return (
    <ScrollArea className={cn("min-h-0 flex-1", COLLAB_SURFACES.content)}>
      <div className="flex flex-col gap-4 p-4">
        <TopologyDiagram primaryHost={primaryHost} standbyHost={standbyHost} />

        <CollabSection
          title="网络中发现的主机"
          action={
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setShowAddForm(true)}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                添加主机
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={handleRescan}
              >
                <Search className="h-3.5 w-3.5" aria-hidden />
                重新扫描
              </Button>
            </div>
          }
        >
          <div className={cn("flex flex-col gap-2 rounded-md p-3", COLLAB_SURFACES.section)}>
            {showAddForm && (
              <AddHostForm
                existingIps={state.hosts.map((host) => host.ip)}
                onConfirm={handleAddHost}
                onCancel={() => setShowAddForm(false)}
              />
            )}
            {state.hosts.map((host) => (
              <HostListItem
                key={host.id}
                host={host}
                selected={state.selectedHostId === host.id}
                onSelect={() => update({ selectedHostId: host.id })}
              />
            ))}
          </div>
        </CollabSection>

        <div className={cn("rounded-md p-4", COLLAB_SURFACES.section)}>
          <div className="grid grid-cols-2 gap-x-8 gap-y-4">
            <CollabField label="故障切换">
              <Select
                value={state.failoverMode}
                onValueChange={(value) =>
                  update({ failoverMode: value as PrimaryBackupState["failoverMode"] })
                }
              >
                <SelectTrigger className="w-full bg-input-background" aria-label="故障切换">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FAILOVER_OPTIONS.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CollabField>

            <CollabField label="切换延迟 (s)">
              <Input
                type="number"
                showStepper
                min={1}
                step={1}
                className="w-full"
                value={state.switchDelay}
                onChange={(event) =>
                  update({ switchDelay: Math.max(1, Number(event.target.value) || 0) })
                }
                aria-label="切换延迟"
              />
            </CollabField>

            <CollabField label="心跳间隔 (ms)">
              <Input
                type="number"
                showStepper
                min={100}
                step={100}
                className="w-full"
                value={state.heartbeatInterval}
                onChange={(event) =>
                  update({ heartbeatInterval: Math.max(100, Number(event.target.value) || 0) })
                }
                aria-label="心跳间隔"
              />
            </CollabField>

            <CollabField label="同步内容">
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {SYNC_CONTENT_LABELS.map(({ key, label }) => (
                  <label
                    key={key}
                    className="flex cursor-pointer items-center gap-2 text-body-sm text-foreground"
                  >
                    <Checkbox
                      checked={state.syncContent[key]}
                      onCheckedChange={(checked) => toggleSyncContent(key, checked === true)}
                      aria-label={label}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </CollabField>
          </div>
        </div>

        <div className={cn("rounded-md p-4", COLLAB_SURFACES.elevated)}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-warning">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                <span className="text-label-caps">手动控制</span>
              </div>
              <p className="mt-1 text-body-sm text-warning/80">
                当前主控机负责所有控制，切换将产生短暂中断
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "border-warning text-warning hover:bg-warning-surface hover:text-warning",
                )}
                onClick={() => toast.success("已切换到备控机（演示）")}
              >
                切换到备控机
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => toast.success("已强制切换（演示）")}
              >
                强制切换
              </Button>
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
};
