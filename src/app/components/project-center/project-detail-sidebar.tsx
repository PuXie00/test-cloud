import { Copy, Download, History, Loader2, Play, Trash2 } from "lucide-react";
import { canOpenProject, formatVersionLabel } from "@/app/project/project-compat";
import type { ProjectRecord, ProjectVersionEntry } from "@/app/project/project-types";

type ProjectDetailSidebarProps = {
  project: ProjectRecord | null;
  opening?: boolean;
  onOpen: () => void;
  /** 下面几项没有对应权限时不传，按钮不显示 */
  onSaveAs?: () => void;
  onExport?: () => void;
  onDelete?: () => void;
  onRestore?: (entry: ProjectVersionEntry) => void;
};

const ghostAction =
  "flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border bg-transparent text-body-sm text-foreground transition-colors hover:bg-muted";

export const ProjectDetailSidebar = ({
  project,
  opening = false,
  onOpen,
  onSaveAs,
  onExport,
  onDelete,
  onRestore,
}: ProjectDetailSidebarProps) => {
  if (!project) {
    return (
      <aside className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-border bg-muted/30 p-6">
        <p className="text-body-sm text-muted-foreground">请选择左侧工程卡片查看详情</p>
      </aside>
    );
  }

  // 版本过高、读不了的工程不能打开 / 另存为；导出、删除、恢复历史版本照常
  const openable = canOpenProject(project);

  return (
    <aside className="custom-scrollbar flex w-[300px] shrink-0 flex-col gap-5 overflow-y-auto border-l border-border bg-muted/30 p-6">
      <div>
        <p className="text-label-caps text-muted-foreground">工程详情</p>
        <h2 className="mt-1 text-heading-lg font-semibold text-primary">{project.name}</h2>
      </div>

      <dl className="flex flex-col gap-2 text-body-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">工程格式</dt>
          <dd className="font-mono text-foreground">{formatVersionLabel(project)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">创建日期</dt>
          <dd className="text-foreground">{project.createdAt}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">修改日期</dt>
          <dd className="text-foreground">{project.modifiedAt}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">作者</dt>
          <dd className="text-foreground">{project.author}</dd>
        </div>
      </dl>

      <div className="flex flex-col gap-1 text-body-sm text-muted-foreground">
        <span>受控物体 {project.controlledObjectCount}</span>
        <span>设备 {project.deviceCount}</span>
      </div>

      {project.compatMessage ? (
        <p
          className={
            openable
              ? "rounded-md bg-card px-3 py-2 text-body-sm text-muted-foreground"
              : "rounded-md bg-warning-surface px-3 py-2 text-body-sm text-warning"
          }
        >
          {project.compatMessage}
          {openable ? null : "。可以从下面的版本历史恢复成本软件能读的版本。"}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onOpen}
          disabled={project.status === "archived" || opening || !openable}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {opening ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Play className="h-4 w-4" aria-hidden />
          )}
          {opening ? "正在打开…" : "打开工程"}
        </button>
        {onSaveAs && openable ? (
          <button type="button" className={ghostAction} onClick={onSaveAs}>
            <Copy className="h-4 w-4" aria-hidden />
            另存为副本
          </button>
        ) : null}
        {onExport ? (
          <button type="button" className={ghostAction} onClick={onExport}>
            <Download className="h-4 w-4" aria-hidden />
            导出备份
          </button>
        ) : null}
        {onDelete ? (
          <button
            type="button"
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border bg-transparent text-body-sm text-destructive hover:bg-destructive/10"
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            删除工程
          </button>
        ) : null}
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2 text-label-caps text-muted-foreground">
          <History className="h-4 w-4" aria-hidden />
          版本历史
        </div>
        {project.versionHistory.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">暂无备份版本</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {project.versionHistory.map((entry) => (
              <li
                key={entry.historyId ?? entry.version}
                className="flex items-center justify-between rounded-md bg-card/80 px-3 py-2 font-mono text-mono-sm text-foreground"
              >
                <span>
                  {entry.version} · {entry.date}
                </span>
                {onRestore ? (
                  <button
                    type="button"
                    className="text-primary hover:text-primary/80 disabled:opacity-40"
                    disabled={!entry.historyId}
                    onClick={() => onRestore(entry)}
                    aria-label={`恢复 ${entry.version}`}
                  >
                    恢复
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
};
