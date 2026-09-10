import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/app/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import {
  Dialog,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { cn } from "@/app/components/ui/utils";
import { getProjectAPI, ProjectIpcError, unwrapResult } from "@/app/project/project-ipc";
import type { ProjectModelEntry } from "@/types/electron";

export type ProjectModelLibraryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentModelId?: string | null;
  onApply: (modelId: string) => void;
};

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const toastIpcError = (err: unknown, fallback: string) => {
  if (err instanceof ProjectIpcError) {
    if (err.code === "CANCELLED") return;
    if (err.code === "TOO_LARGE") {
      toast.error("文件不能超过 10MB");
      return;
    }
    if (err.code === "INVALID_FORMAT") {
      toast.error("仅支持 GLB、OBJ");
      return;
    }
    if (err.code === "NO_PROJECT") {
      toast.error("请先打开工程");
      return;
    }
    toast.error(err.message || fallback);
    return;
  }
  toast.error(fallback);
};

export const ProjectModelLibraryDialog = ({
  open,
  onOpenChange,
  currentModelId,
  onApply,
}: ProjectModelLibraryDialogProps) => {
  const [models, setModels] = useState<ProjectModelEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectModelEntry | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshList = useCallback(async () => {
    setLoading(true);
    try {
      const list = unwrapResult(await getProjectAPI().models.list());
      setModels(list);
    } catch (err) {
      toastIpcError(err, "加载模型列表失败");
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelectedId(currentModelId ?? null);
    void refreshList();
  }, [open, currentModelId, refreshList]);

  const handleImport = async () => {
    setBusy(true);
    try {
      unwrapResult(await getProjectAPI().models.import());
      await refreshList();
      toast.success("模型已导入");
    } catch (err) {
      toastIpcError(err, "导入模型失败");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    setBusy(true);
    try {
      unwrapResult(await getProjectAPI().models.delete({ modelId: target.modelId }));
      if (selectedId === target.modelId) setSelectedId(null);
      await refreshList();
      toast.success(`已删除 ${target.fileName}`);
    } catch (err) {
      toastIpcError(err, "删除模型失败");
    } finally {
      setBusy(false);
    }
  };

  const handleApply = (modelId: string) => {
    onApply(modelId);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogPortal>
          <DialogOverlay className="bg-background/80 backdrop-blur-sm" />
          <DialogPrimitive.Content
            className={cn(
              "fixed top-[50%] left-[50%] z-50 flex w-full max-w-140 max-h-[calc(100vh-2rem)]",
              "-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg bg-card",
              "shadow-[0_4px_24px_rgba(0,0,0,0.4)] outline-none",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
              "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            )}
            aria-describedby={undefined}
          >
            <div className="flex h-12 shrink-0 items-center justify-between bg-muted px-4">
              <DialogTitle className="text-heading-md font-semibold text-foreground">
                工程模型库
              </DialogTitle>
              <DialogPrimitive.Close
                className="shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground"
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </DialogPrimitive.Close>
            </div>

            <DialogDescription className="sr-only">
              导入、选择或删除工程 Models 目录中的 GLB/OBJ 模型
            </DialogDescription>

            <div className="flex min-h-0 flex-1 flex-col gap-3 bg-background p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-body-sm text-muted-foreground">
                  支持 GLB / OBJ，单文件不超过 10MB
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void handleImport()}
                  aria-label="导入模型"
                >
                  导入
                </Button>
              </div>

              <div className="min-h-60 flex-1 overflow-y-auto rounded-md bg-muted p-2">
                {loading ? (
                  <p className="px-3 py-8 text-center text-body-sm text-muted-foreground">
                    加载中…
                  </p>
                ) : models.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 px-3 py-10">
                    <p className="text-body-sm text-muted-foreground">暂无模型，请先导入</p>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={() => void handleImport()}
                      aria-label="导入第一个模型"
                    >
                      导入模型
                    </Button>
                  </div>
                ) : (
                  <ul className="space-y-1" role="listbox" aria-label="模型列表">
                    {models.map((entry) => {
                      const isSelected = selectedId === entry.modelId;
                      const isCurrent = currentModelId === entry.modelId;
                      return (
                        <li key={entry.modelId}>
                          <div
                            role="option"
                            aria-selected={isSelected}
                            tabIndex={0}
                            className={cn(
                              "flex items-center gap-2 rounded-md border border-border/60 bg-input-background px-3 py-2",
                              "cursor-pointer outline-none transition-colors",
                              "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                              isSelected && "border-primary bg-accent",
                              isCurrent && !isSelected && "border-primary/60",
                            )}
                            onClick={() => setSelectedId(entry.modelId)}
                            onDoubleClick={() => handleApply(entry.modelId)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setSelectedId(entry.modelId);
                              }
                            }}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-body-md text-foreground">
                                {entry.fileName}
                                {isCurrent ? (
                                  <span className="ml-2 text-body-sm text-primary">当前</span>
                                ) : null}
                              </div>
                              <div className="mt-0.5 flex gap-3 font-mono text-mono-sm tabular-nums text-muted-foreground">
                                <span className="uppercase">{entry.ext}</span>
                                <span>{formatSize(entry.sizeBytes)}</span>
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="shrink-0 text-muted-foreground hover:text-destructive"
                              disabled={busy}
                              aria-label={`删除 ${entry.fileName}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                setPendingDelete(entry);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            <div className="flex shrink-0 justify-end gap-2 bg-muted px-4 py-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenChange(false)}
                aria-label="取消"
              >
                取消
              </Button>
              <Button
                type="button"
                disabled={!selectedId || busy}
                onClick={() => selectedId && handleApply(selectedId)}
                aria-label="应用模型"
              >
                应用
              </Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
      >
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除模型</AlertDialogTitle>
            <AlertDialogDescription className="text-body-sm text-muted-foreground">
              将从工程 Models 目录删除「{pendingDelete?.fileName}」。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleConfirmDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
