import * as DialogPrimitive from "@radix-ui/react-dialog";
import { RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  HA_OPTIONAL_PART_LABELS,
  validateHaSettings,
  type HaLocalIp,
  type HaOptionalPart,
  type HaRole,
  type HaSettings,
} from "@shared/ha/types";
import { usePermissions } from "@/app/auth/permissions";
import { useHaState } from "@/app/hot-standby/ha-state-provider";
import { useHaProjectSync } from "@/app/hot-standby/ha-project-sync-provider";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { ScrollArea } from "@/app/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { cn } from "@/app/components/ui/utils";
import { COLLAB_SURFACES } from "../collaboration/collab-surfaces";
import { describePeer, HA_ROLE_LABELS, HA_SYNC_STATE_LABELS, type HaTone } from "./hot-standby-labels";

export type HotStandbyDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const OPTIONAL_PARTS: HaOptionalPart[] = ["motion", "rules", "meta", "models"];

const TONE_TEXT: Record<HaTone, string> = {
  ok: "text-show",
  warn: "text-warning",
  idle: "text-muted-foreground",
};

const TONE_DOT: Record<HaTone, string> = {
  ok: "bg-show",
  warn: "bg-warning",
  idle: "bg-muted-foreground",
};

const Section = ({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) => (
  <section className={cn("flex flex-col gap-3 rounded-lg p-3", COLLAB_SURFACES.section)}>
    <div className="flex min-h-8 items-center justify-between gap-2">
      <h3 className="text-label-caps text-foreground">{title}</h3>
      {action}
    </div>
    {children}
  </section>
);

// 用 div 不用 label：label 会把点击转给里面第一个按钮（角色切换、刷新 IP）
const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <div className="flex flex-col gap-2">
    <span className="text-body-sm text-muted-foreground">{label}</span>
    {children}
    {hint ? <span className="text-body-sm text-muted-foreground">{hint}</span> : null}
  </div>
);

const StatusDot = ({ tone }: { tone: HaTone }) => (
  <span className={cn("h-2 w-2 shrink-0 rounded-full", TONE_DOT[tone])} aria-hidden />
);

/**
 * 主备热备（替代原「多机协作」演示页，方案第 4、11 节）：
 * 设置（角色、本机名称、本机 IP、主机 IP、同步范围）、开启 / 关闭、链路和工程状态。
 * 设置存在本机（主进程），开着热备时只有同步范围能改。
 */
export const HotStandbyDialog = ({ open, onOpenChange }: HotStandbyDialogProps) => {
  const api = window.haAPI;
  const state = useHaState();
  const { snapshot: sync, resync } = useHaProjectSync();
  const canManage = usePermissions().can("collab.manage");
  const [form, setForm] = useState<HaSettings | null>(null);
  const [savedJson, setSavedJson] = useState("");
  const [localIps, setLocalIps] = useState<HaLocalIp[]>([]);
  const [busy, setBusy] = useState<"save" | "start" | "stop" | null>(null);

  const refreshIps = useCallback(async () => {
    if (!api) return;
    try {
      setLocalIps(await api.listLocalIps());
    } catch {
      setLocalIps([]);
    }
  }, [api]);

  useEffect(() => {
    if (!open || !api) return;
    let cancelled = false;
    void Promise.all([api.getSettings(), api.listLocalIps()])
      .then(([settings, ips]) => {
        if (cancelled) return;
        setForm(settings);
        setSavedJson(JSON.stringify(settings));
        setLocalIps(ips);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, api]);

  const enabled = state?.enabled ?? false;
  const dirty = form !== null && JSON.stringify(form) !== savedJson;
  const locked = !canManage || enabled || busy !== null;
  const problem = form ? validateHaSettings(form) : null;

  const ipOptions = useMemo(() => {
    const list = [...localIps];
    if (form?.localIp && !list.some((item) => item.address === form.localIp)) {
      list.unshift({ address: form.localIp, iface: "不在本机网卡里" });
    }
    return list;
  }, [localIps, form?.localIp]);

  const patch = (next: Partial<HaSettings>) => setForm((prev) => (prev ? { ...prev, ...next } : prev));

  const save = async (): Promise<boolean> => {
    if (!api || !form) return false;
    const result = await api.saveSettings(form);
    if (!result.ok) {
      toast.error(result.message);
      return false;
    }
    setForm(result.data);
    setSavedJson(JSON.stringify(result.data));
    return true;
  };

  const handleSave = async () => {
    setBusy("save");
    try {
      if (await save()) toast.success("热备设置已保存");
    } finally {
      setBusy(null);
    }
  };

  const handleStart = async () => {
    if (!api || !form) return;
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy("start");
    try {
      if (dirty && !(await save())) return;
      const result = await api.start();
      if (!result.ok) toast.error(result.message);
      else toast.success(form.role === "primary" ? "热备已开启，等待备机连接" : "热备已开启，正在连接主机");
    } finally {
      setBusy(null);
    }
  };

  const handleStop = async () => {
    if (!api) return;
    setBusy("stop");
    try {
      const result = await api.stop();
      if (!result.ok) toast.error(result.message);
      else toast.success("热备已关闭");
    } finally {
      setBusy(null);
    }
  };

  const setRole = (role: HaRole) => patch({ role });

  const setScope = (part: HaOptionalPart, checked: boolean) =>
    setForm((prev) => (prev ? { ...prev, syncScope: { ...prev.syncScope, [part]: checked } } : prev));

  const role = form?.role ?? state?.role ?? "primary";
  const peers = state?.peers ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="bg-background/80 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className={cn(
            COLLAB_SURFACES.shell,
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "fixed top-[50%] left-[50%] z-50 flex max-h-[calc(100vh-2rem)] w-full max-w-[720px]",
            "-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg",
            "shadow-[0_4px_24px_rgba(0,0,0,0.4)] duration-200 outline-none",
          )}
          aria-describedby={undefined}
        >
          <div className={cn("flex h-12 shrink-0 items-center justify-between px-4", COLLAB_SURFACES.chrome)}>
            <DialogTitle className="text-heading-lg font-semibold text-foreground">主备热备</DialogTitle>
            <DialogPrimitive.Close
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
              aria-label="关闭"
            >
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>
          <DialogDescription className="sr-only">主机和备机之间的热备同步设置与状态</DialogDescription>

          <ScrollArea className={cn("min-h-0 flex-1", COLLAB_SURFACES.content)}>
            <div className="flex flex-col gap-4 p-4">
              {!api ? (
                <p className="text-body-md text-muted-foreground">当前环境不支持主备热备。</p>
              ) : null}

              <Section
                title="状态"
                action={
                  enabled ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-10"
                      disabled={!canManage || busy !== null}
                      onClick={() => void handleStop()}
                    >
                      {busy === "stop" ? "正在关闭…" : "关闭热备"}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      className="h-10"
                      disabled={!api || !canManage || busy !== null || form === null}
                      onClick={() => void handleStart()}
                    >
                      {busy === "start" ? "正在开启…" : "开启热备"}
                    </Button>
                  )
                }
              >
                <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md px-3 py-2", COLLAB_SURFACES.recessed)}>
                  <span className="flex items-center gap-2 text-body-md text-foreground">
                    <StatusDot tone={enabled ? "ok" : "idle"} />
                    {enabled ? "热备已开启" : "热备未开启"}
                  </span>
                  <span className="text-body-md text-foreground">
                    本机 {state?.hostName ?? form?.hostName ?? "—"} · {HA_ROLE_LABELS[state?.role ?? role]}
                  </span>
                  <span className="font-mono text-mono-sm tabular-nums text-muted-foreground">
                    {state?.localIp || form?.localIp || "未选 IP"}
                  </span>
                  <span className="text-body-sm text-muted-foreground">
                    当前工程：{state?.localProject?.name ?? "没有打开工程"}
                  </span>
                </div>

                {enabled && peers.length === 0 ? (
                  <p className="px-1 text-body-sm text-muted-foreground">还没有备机连上来</p>
                ) : null}
                {peers.map((peer) => {
                  const detail = describePeer(peer, state?.localProject ?? null);
                  const syncState =
                    detail.tone !== "ok"
                      ? null
                      : state?.role === "primary"
                        ? (sync.standbys[peer.ip] ?? "checking")
                        : sync.phase;
                  return (
                    <div
                      key={peer.ip}
                      className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md px-3 py-2", COLLAB_SURFACES.recessed)}
                    >
                      <span className="flex items-center gap-2 text-body-md text-foreground">
                        <StatusDot tone={detail.tone} />
                        {peer.hostName ?? (state?.role === "standby" ? "主机" : "备机")}
                      </span>
                      <span className="font-mono text-mono-sm tabular-nums text-muted-foreground">{peer.ip}</span>
                      <span className={cn("text-body-sm", TONE_TEXT[detail.tone])}>{detail.text}</span>
                      {syncState ? (
                        <span
                          className={cn(
                            "text-body-sm",
                            syncState === "synced" ? "text-show" : "text-warning",
                          )}
                        >
                          {HA_SYNC_STATE_LABELS[syncState]}
                        </span>
                      ) : null}
                      {state?.role === "standby" && syncState && syncState !== "confirm" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          className="ml-auto h-10"
                          disabled={!canManage}
                          onClick={resync}
                        >
                          立即同步
                        </Button>
                      ) : null}
                    </div>
                  );
                })}

                {state?.deviceGate ? (
                  <p className="rounded-md bg-warning/10 px-3 py-2 text-body-sm text-warning">
                    {state.deviceGate}
                  </p>
                ) : null}
                {state?.error ? (
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-body-sm text-destructive">{state.error}</p>
                ) : null}
              </Section>

              {form ? (
                <Section title="设置">
                  {enabled ? (
                    <p className="text-body-sm text-muted-foreground">关闭热备后才能修改角色、名称和 IP。</p>
                  ) : null}
                  {!canManage ? (
                    <p className="text-body-sm text-muted-foreground">没有「主备热备」权限，只能查看。</p>
                  ) : null}

                  <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                    <Field label="本机角色">
                      <div className="flex gap-2" role="radiogroup" aria-label="本机角色">
                        {(["primary", "standby"] as const).map((value) => (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={form.role === value}
                            disabled={locked}
                            onClick={() => setRole(value)}
                            className={cn(
                              "h-10 flex-1 rounded-md text-body-md transition-colors disabled:opacity-50",
                              form.role === value
                                ? "bg-primary/15 text-primary"
                                : "bg-input-background text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {HA_ROLE_LABELS[value]}
                          </button>
                        ))}
                      </div>
                    </Field>

                    <Field label="本机名称" hint="提示里用，例如「物体 6 正在由 控台-A 操作」">
                      <Input
                        aria-label="本机名称"
                        value={form.hostName}
                        maxLength={32}
                        disabled={locked}
                        onChange={(event) => patch({ hostName: event.target.value })}
                        className="h-10"
                      />
                    </Field>

                    <Field label="本机 IP">
                      <div className="flex gap-2">
                        <Select
                          value={form.localIp || undefined}
                          disabled={locked}
                          onValueChange={(value) => patch({ localIp: value })}
                        >
                          <SelectTrigger className="h-10 flex-1 font-mono" aria-label="本机 IP">
                            <SelectValue placeholder="选择本机网卡的 IP" />
                          </SelectTrigger>
                          <SelectContent>
                            {ipOptions.map((item) => (
                              <SelectItem key={item.address} value={item.address}>
                                <span className="font-mono tabular-nums">{item.address}</span>
                                <span className="ml-2 text-muted-foreground">{item.iface}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-10 w-10"
                          aria-label="重新读取本机 IP"
                          disabled={locked}
                          onClick={() => void refreshIps()}
                        >
                          <RefreshCw />
                        </Button>
                      </div>
                    </Field>

                    {form.role === "standby" ? (
                      <Field label="主机 IP">
                        <Input
                          aria-label="主机 IP"
                          value={form.primaryIp}
                          placeholder="例如 192.168.0.100"
                          disabled={locked}
                          onChange={(event) => patch({ primaryIp: event.target.value })}
                          className="h-10 font-mono tabular-nums"
                        />
                      </Field>
                    ) : (
                      <div />
                    )}
                  </div>

                  <Field
                    label="同步范围"
                    hint={
                      form.role === "standby"
                        ? "备机跟随主机的同步范围。"
                        : "配置固定同步：PLC 只有一套，备机的配置必须和主机一样。"
                    }
                  >
                    {form.role === "primary" ? (
                      <div className="flex flex-wrap gap-x-6 gap-y-2">
                        <span className="flex h-10 items-center gap-2 text-body-md text-muted-foreground">
                          <Checkbox checked disabled aria-label="配置（固定同步）" />
                          配置
                        </span>
                        {OPTIONAL_PARTS.map((part) => (
                          <label key={part} className="flex h-10 items-center gap-2 text-body-md text-foreground">
                            <Checkbox
                              checked={form.syncScope[part]}
                              disabled={!canManage || busy !== null}
                              onCheckedChange={(checked) => setScope(part, checked === true)}
                            />
                            {HA_OPTIONAL_PART_LABELS[part]}
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </Field>
                </Section>
              ) : null}
            </div>
          </ScrollArea>

          <div className={cn("flex h-14 shrink-0 items-center justify-end gap-2 px-4", COLLAB_SURFACES.chrome)}>
            <Button type="button" variant="ghost" className="h-10" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
            <Button
              type="button"
              className="h-10"
              disabled={!canManage || !dirty || busy !== null}
              onClick={() => void handleSave()}
            >
              {busy === "save" ? "正在保存…" : "保存设置"}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
};
