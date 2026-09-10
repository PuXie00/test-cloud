import {
  Boxes,
  CircleHelp,
  Copy,
  FolderOpen,
  FolderX,
  Globe,
  Lock,
  LockKeyhole,
  LogOut,
  Radio,
  Redo2,
  Save,
  ScrollText,
  Settings,
  Undo2,
  Zap,
} from "lucide-react";
import type { ElementType } from "react";
import { cn } from "../ui/utils";

type MenuItem = {
  id: string;
  label: string;
  icon: ElementType;
  iconClassName?: string;
  labelClassName?: string;
  shortcut?: string;
};

type MenuSection = {
  items: MenuItem[];
};

const MENU_SECTIONS: MenuSection[] = [
  {
    items: [
      { id: "project", label: "工程管理", icon: FolderOpen, iconClassName: "text-warning" },
      { id: "save", label: "保存工程", icon: Save, iconClassName: "text-secondary" },
      { id: "save-as", label: "工程另存为", icon: Copy, iconClassName: "text-chart-3" },
      { id: "close", label: "关闭工程", icon: FolderX, iconClassName: "text-chart-5" },
    ],
  },
  {
    items: [
      { id: "undo", label: "撤销", icon: Undo2, iconClassName: "text-primary" },
      { id: "redo", label: "重做", icon: Redo2, iconClassName: "text-secondary" },
    ],
  },
  {
    items: [
      { id: "log", label: "操作日志与回放", icon: ScrollText, iconClassName: "text-chart-3" },
      { id: "assets", label: "设备资产管理", icon: Boxes, iconClassName: "text-chart-5" },
      { id: "signals", label: "外部信号配置", icon: Radio, iconClassName: "text-info" },
      { id: "collab", label: "多机协作管理", icon: Globe, iconClassName: "text-primary" },
      { id: "rules", label: "规则编辑器", icon: Zap, iconClassName: "text-warning" },
      { id: "permissions", label: "权限配置", icon: Lock, iconClassName: "text-warning" },
    ],
  },
  {
    items: [
      { id: "lock-screen", label: "锁屏", icon: LockKeyhole, iconClassName: "text-primary" },
      { id: "system", label: "系统设置", icon: Settings, iconClassName: "text-muted-foreground" },
      { id: "help", label: "帮助", icon: CircleHelp, iconClassName: "text-destructive" },
    ],
  },
  {
    items: [
      {
        id: "logout",
        label: "退出登录",
        icon: LogOut,
        iconClassName: "text-destructive",
        labelClassName: "text-destructive",
      },
    ],
  },
];

type AppMenuPanelProps = {
  open: boolean;
  onClose: () => void;
  projectName?: string;
  /** 保存进行中时禁用「保存工程」 */
  saveDisabled?: boolean;
  undoDisabled?: boolean;
  redoDisabled?: boolean;
  undoShortcutHint?: string;
  redoShortcutHint?: string;
  undoAriaKeyshortcuts?: string;
  redoAriaKeyshortcuts?: string;
  onUndo?: () => void;
  onRedo?: () => void;
  onLogout?: () => void;
  onProjectManage?: () => void;
  onSaveProject?: () => void;
  onSaveProjectAs?: () => void;
  onCloseProject?: () => void;
  onVersionHistory?: () => void;
  onImportExport?: () => void;
  showPermissions?: boolean;
  onPermissionsConfig?: () => void;
  onCollabManage?: () => void;
  /** 非演出模式时显示系统设置 */
  showSettings?: boolean;
  onSystemSettings?: () => void;
  /** 未锁屏时显示锁屏入口 */
  showLockScreen?: boolean;
  onLockScreen?: () => void;
};

export const AppMenuPanel = ({
  open,
  onClose,
  projectName = "未选择工程",
  saveDisabled = false,
  undoDisabled = true,
  redoDisabled = true,
  undoShortcutHint,
  redoShortcutHint,
  undoAriaKeyshortcuts,
  redoAriaKeyshortcuts,
  onUndo,
  onRedo,
  onLogout,
  onProjectManage,
  onSaveProject,
  onSaveProjectAs,
  onCloseProject,
  onVersionHistory,
  onImportExport,
  showPermissions = false,
  onPermissionsConfig,
  onCollabManage,
  showSettings = true,
  onSystemSettings,
  showLockScreen = true,
  onLockScreen,
}: AppMenuPanelProps) => {
  if (!open) return null;

  const resolveItem = (item: MenuItem): MenuItem => {
    if (item.id === "undo") {
      return {
        ...item,
        shortcut: undoShortcutHint,
      };
    }
    if (item.id === "redo") {
      return {
        ...item,
        shortcut: redoShortcutHint,
      };
    }
    return item;
  };

  const handleItem = (id: string) => {
    if (id === "save" && saveDisabled) return;
    if (id === "undo" && undoDisabled) return;
    if (id === "redo" && redoDisabled) return;
    switch (id) {
      case "logout":
        onLogout?.();
        onClose();
        return;
      case "project":
        onProjectManage?.();
        onClose();
        return;
      case "save":
        onSaveProject?.();
        onClose();
        return;
      case "save-as":
        onSaveProjectAs?.();
        onClose();
        return;
      case "close":
        onCloseProject?.();
        onClose();
        return;
      case "undo":
        onUndo?.();
        onClose();
        return;
      case "redo":
        onRedo?.();
        onClose();
        return;
      case "history":
        onVersionHistory?.();
        onClose();
        return;
      case "import-export":
        onImportExport?.();
        onClose();
        return;
      case "permissions":
        onPermissionsConfig?.();
        onClose();
        return;
      case "collab":
        onCollabManage?.();
        onClose();
        return;
      case "system":
        onSystemSettings?.();
        onClose();
        return;
      case "lock-screen":
        onLockScreen?.();
        onClose();
        return;
      default:
        return;
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label="关闭菜单"
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
      />
      <nav
        aria-label="应用菜单"
        className="fixed bottom-6 left-0 top-12 z-50 flex w-60 flex-col border-r border-border bg-background shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
      >
        <div className="border-b border-border px-3 py-2">
          <p className="truncate text-label-caps text-muted-foreground">当前工程</p>
          <p className="truncate text-body-sm text-foreground">{projectName}</p>
        </div>
        <div className="custom-scrollbar flex-1 overflow-y-auto py-1">
          {MENU_SECTIONS.map((section, sectionIndex) => (
            <div key={sectionIndex}>
              {sectionIndex > 0 && <div className="mx-3 my-1 border-t border-border" role="separator" />}
              <ul>
                {section.items.map((item, itemIndex) => {
                  if (item.id === "permissions" && !showPermissions) return null;
                  if (item.id === "system" && !showSettings) return null;
                  if (item.id === "lock-screen" && !showLockScreen) return null;

                  const resolved = resolveItem(item);
                  const Icon = resolved.icon;
                  const isEven = itemIndex % 2 === 0;
                  const disabled =
                    (resolved.id === "save" && saveDisabled) ||
                    (resolved.id === "undo" && undoDisabled) ||
                    (resolved.id === "redo" && redoDisabled);
                  const visibleLabel =
                    resolved.id === "save" && saveDisabled
                      ? "保存中…" : resolved.label;
                  return (
                    <li key={resolved.id}>
                      <button
                        type="button"
                        disabled={disabled}
                        aria-disabled={disabled || undefined}
                        aria-label={item.label}
                        title={item.label}
                        className={cn(
                          "flex w-full items-center gap-2.5 px-3 py-2 text-left text-body-sm transition-colors hover:bg-accent",
                          isEven ? "bg-background" : "bg-card/50",
                          disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
                        )}
                        onClick={() => handleItem(resolved.id)}
                      >
                        <Icon className={cn("h-4 w-4 shrink-0", resolved.iconClassName)} aria-hidden />
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate",
                            resolved.labelClassName ?? "text-foreground",
                          )}
                        >
                          {visibleLabel}
                        </span>
                        {resolved.shortcut ? (
                          <span className="shrink-0 font-mono text-mono-sm tabular-nums text-muted-foreground">
                            {resolved.shortcut}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>
    </>
  );
};
