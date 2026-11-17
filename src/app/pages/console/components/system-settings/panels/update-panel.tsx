import { FolderOpen, Loader2, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  targetLabel,
  type StoredUpdatePackage,
  type UpdateCheckResult,
  type UpdateImportProgress,
  type UpdateRelation,
  type UpdateStatus,
} from "@shared/update/types";
import { Button } from "@/app/components/ui/button";
import { Progress } from "@/app/components/ui/progress";
import { cn } from "@/app/components/ui/utils";
import { useRunningActionIds } from "../../../hooks/action-run";
import { useAxisMotion } from "../../../hooks/axis-motion";
import { useConfirmProjectLeave } from "../../../hooks/project-leave-guard-provider";
import { SettingsSection } from "../settings-section";

const RELATION_TAG: Record<UpdateRelation, { label: string; className: string }> = {
  newer: { label: "可升级", className: "bg-show/15 text-show" },
  current: { label: "当前版本", className: "bg-accent text-foreground" },
  older: { label: "可回退", className: "bg-warning-surface text-warning" },
};

const formatSize = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const formatDate = (iso: string): string => (iso ? iso.slice(0, 10) : "—");

const percent = (received: number, total: number): number =>
  total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;

type Busy = "import" | "check" | "download" | "install" | null;

const IMPORT_STAGE_LABEL: Record<UpdateImportProgress["stage"], string> = {
  read: "正在读取升级包",
  extract: "正在解压",
  verify: "正在校验安装程序",
};

/** 导入升级包要好几秒（U 盘上的包更久），一直显示在做哪一步、做了多少 */
const ImportProgressRow = ({ progress }: { progress: UpdateImportProgress }) => {
  const hasTotal = progress.total > 0;
  const value = percent(progress.received, progress.total);
  return (
    <div role="status" aria-label="导入进度" className="flex flex-col gap-2 rounded-md bg-input-background px-3 py-3">
      <div className="flex items-center gap-2 text-body-sm text-foreground">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
        <span className="shrink-0">{IMPORT_STAGE_LABEL[progress.stage]}</span>
        <span className="min-w-0 truncate font-mono text-mono-sm text-muted-foreground">{progress.fileName}</span>
        {hasTotal ? (
          <span className="ml-auto shrink-0 font-mono text-mono-sm tabular-nums text-muted-foreground">{value}%</span>
        ) : null}
      </div>
      {hasTotal ? <Progress value={value} /> : null}
      <p className="text-body-sm text-muted-foreground">升级包比较大，需要一点时间；关掉设置窗口也会在后台继续。</p>
    </div>
  );
};

/**
 * 系统设置 › 软件更新：在线检查 / 下载（配了 YZ_UPDATE_URL 才有）、导入离线升级包、安装或回退到本机的升级包。
 * 安装时软件会退出并停掉 C++，所以有轴在动、有动作在运行时不让装（主进程也会再查一次轴状态）。
 */
export const UpdatePanel = () => {
  const api = window.updateAPI;
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [checkResult, setCheckResult] = useState<UpdateCheckResult | null>(null);
  const [installingVersion, setInstallingVersion] = useState<string | null>(null);
  const { movingAxisIds } = useAxisMotion();
  const runningActions = useRunningActionIds();
  const confirmLeave = useConfirmProjectLeave();

  const refresh = useCallback(async () => {
    if (!api) return;
    const result = await api.status();
    if (result.ok) {
      setStatus(result.data);
      setLoadError(null);
    } else {
      setLoadError(result.message);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 下载、导入都在主进程里跑，关掉设置再打开也能接着看进度
  useEffect(
    () => api?.onProgress((download) => setStatus((prev) => (prev ? { ...prev, download } : prev))),
    [api],
  );
  useEffect(
    () => api?.onImportProgress((importing) => setStatus((prev) => (prev ? { ...prev, importing } : prev))),
    [api],
  );

  if (!api) {
    return <p className="text-body-sm text-muted-foreground">只有安装版软件能在这里升级。</p>;
  }
  if (!status) {
    return <p className="text-body-sm text-muted-foreground">{loadError ?? "正在读取…"}</p>;
  }

  const packagesUsable = status.signingKeyConfigured;
  const installUsable = status.signingKeyConfigured && status.installSupported;
  const download = status.download;
  const importing = status.importing;

  const handleImport = async () => {
    setBusy("import");
    try {
      const picked = await api.pickPackage();
      if (!picked.ok) {
        if (picked.code !== "CANCELLED") toast.error(picked.message);
        return;
      }
      // 选完马上显示，不等主进程的第一条进度
      const { fileName, filePath, sizeBytes } = picked.data;
      setStatus((prev) =>
        prev ? { ...prev, importing: { fileName, stage: "read", received: 0, total: sizeBytes } } : prev,
      );
      const result = await api.importPackage({ filePath });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(`已加入升级包 v${result.data.version}`);
      await refresh();
    } finally {
      setStatus((prev) => (prev ? { ...prev, importing: null } : prev));
      setBusy(null);
    }
  };

  const handleCheck = async () => {
    setBusy("check");
    try {
      const result = await api.check();
      if (!result.ok) {
        setCheckResult(null);
        toast.error(result.message);
        return;
      }
      setCheckResult(result.data);
    } finally {
      setBusy(null);
    }
  };

  const handleDownload = async () => {
    setBusy("download");
    try {
      const result = await api.download();
      if (!result.ok) {
        if (result.code !== "CANCELLED") toast.error(result.message);
        return;
      }
      toast.success(`已下载 v${result.data.version}，可以在下面安装`);
      setCheckResult((prev) => (prev ? { ...prev, stored: true } : prev));
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const handleInstall = async (pkg: StoredUpdatePackage) => {
    if (movingAxisIds.length > 0) {
      toast.error(`${movingAxisIds.length} 个轴运动中，全部停止后再升级`);
      return;
    }
    if (runningActions.size > 0) {
      toast.error("有动作在运行，停止后再升级");
      return;
    }
    const rollback = pkg.relation === "older";
    const confirmed = await window.toolAPI.confirm({
      title: rollback ? "回退版本" : "安装升级",
      message: rollback ? `回退到 v${pkg.version}？` : `升级到 v${pkg.version}？`,
      detail: [
        "软件会关闭并断开设备连接，装完自动重新打开，期间不要关机。",
        status.target.platform === "linux"
          ? "软件关闭后会弹出系统授权窗口，需要输入管理员密码；取消的话软件会照原样重新打开。"
          : null,
        rollback
          ? "回退后，用新版本保存过的工程在旧版本里显示「版本过高」，可以在工程管理里从版本历史恢复升级前的备份。"
          : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
      confirmLabel: rollback ? "回退" : "安装",
      danger: rollback,
    });
    if (!confirmed) return;
    if (!(await confirmLeave("update"))) return;
    setBusy("install");
    setInstallingVersion(pkg.version);
    const result = await api.install({ version: pkg.version });
    // 成功时软件马上退出，按钮一直转着
    if (!result.ok) {
      toast.error(result.message);
      setBusy(null);
      setInstallingVersion(null);
    }
  };

  const checkSummary = (() => {
    if (busy === "check") return "正在检查…";
    if (!checkResult) return "还没检查";
    const { latest, relation, stored } = checkResult;
    if (relation !== "newer") return `已是最新版本（服务器上是 v${latest.version}）`;
    return stored ? `发现新版本 v${latest.version}，已下载，在下面安装` : `发现新版本 v${latest.version}`;
  })();
  const showDownload = checkResult?.relation === "newer" && !checkResult.stored;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <SettingsSection title="已安装版本">
        <div className="flex flex-col gap-2 rounded-md bg-muted p-4">
          <span className="font-mono text-mono-md tabular-nums text-foreground">
            v{status.currentVersion}
            <span className="text-muted-foreground"> · {targetLabel(status.target)}</span>
          </span>
          {!status.signingKeyConfigured ? (
            <p className="rounded-md bg-warning-surface px-3 py-2 text-body-sm text-warning">
              软件里没有配置升级签名公钥，不能导入或安装升级包。
            </p>
          ) : !status.installSupported ? (
            <p className="text-body-sm text-muted-foreground">
              不能在软件里安装（{status.installUnsupportedReason ?? "这个版本暂不支持"}），这里只能导入和查看升级包。
            </p>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection title="在线更新">
        <div className="flex flex-col gap-3 rounded-md bg-muted p-4">
          {status.onlineUrl ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="text-body-sm text-muted-foreground">{checkSummary}</span>
                <Button variant="secondary" disabled={busy !== null || download !== null} onClick={() => void handleCheck()}>
                  <RefreshCw className={cn("h-4 w-4", busy === "check" && "animate-spin")} aria-hidden />
                  检查更新
                </Button>
              </div>
              {showDownload && checkResult ? (
                <div className="flex flex-col gap-2 rounded-md bg-input-background px-3 py-3">
                  <span className="font-mono text-mono-sm tabular-nums text-muted-foreground">
                    v{checkResult.latest.version} · {formatDate(checkResult.latest.releasedAt)} ·{" "}
                    {formatSize(checkResult.latest.size)}
                  </span>
                  {checkResult.latest.notes ? (
                    <p className="whitespace-pre-line text-body-sm text-foreground">{checkResult.latest.notes}</p>
                  ) : null}
                  {download ? null : (
                    <div className="flex justify-end">
                      <Button disabled={!packagesUsable || busy !== null} onClick={() => void handleDownload()}>
                        下载
                      </Button>
                    </div>
                  )}
                </div>
              ) : null}
              {download ? (
                <div className="flex items-center gap-3" aria-label="下载进度">
                  <Progress className="flex-1" value={percent(download.received, download.total)} />
                  <span className="w-28 shrink-0 text-right font-mono text-mono-sm tabular-nums text-muted-foreground">
                    v{download.version} {percent(download.received, download.total)}%
                  </span>
                  <Button variant="ghost" onClick={() => void api.cancelDownload()} aria-label="取消下载">
                    <X className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-body-sm text-muted-foreground">还没有配置更新服务器，可以用下面的离线升级包升级。</p>
          )}
        </div>
      </SettingsSection>

      <SettingsSection title="升级包">
        <div className="flex flex-col gap-3 rounded-md bg-muted p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-body-sm text-muted-foreground">
              选一个 {targetLabel(status.target)} 的 .yzupd 升级包（比如从 U 盘），校验通过后加到下面
            </span>
            <Button
              variant="secondary"
              disabled={!packagesUsable || busy !== null || importing !== null}
              onClick={() => void handleImport()}
            >
              {importing ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <FolderOpen className="h-4 w-4" aria-hidden />
              )}
              {importing ? "正在导入…" : "选择升级包…"}
            </Button>
          </div>
          {importing ? <ImportProgressRow progress={importing} /> : null}
          {status.packages.length === 0 ? (
            <p className="text-body-sm text-muted-foreground">本机还没有升级包</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {status.packages.map((pkg) => {
                const tag = RELATION_TAG[pkg.relation];
                return (
                  <li key={pkg.version} className="flex flex-col gap-2 rounded-md bg-input-background px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="font-mono text-mono-md tabular-nums text-foreground">v{pkg.version}</span>
                        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-body-sm", tag.className)}>
                          {tag.label}
                        </span>
                        <span className="truncate font-mono text-mono-sm tabular-nums text-muted-foreground">
                          {formatDate(pkg.releasedAt)} · {formatSize(pkg.sizeBytes)}
                        </span>
                      </div>
                      {pkg.relation === "current" ? null : (
                        <Button
                          variant={pkg.relation === "newer" ? "default" : "secondary"}
                          disabled={!installUsable || busy !== null || download !== null || importing !== null}
                          onClick={() => void handleInstall(pkg)}
                        >
                          {installingVersion === pkg.version ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          ) : null}
                          {pkg.relation === "newer" ? "安装" : "回退到此版本"}
                        </Button>
                      )}
                    </div>
                    {pkg.notes ? (
                      <p className="whitespace-pre-line text-body-sm text-muted-foreground">{pkg.notes}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SettingsSection>
    </div>
  );
};
