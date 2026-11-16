import type { ProjectCompat } from "@shared/project/types";
import type { ProjectDocument } from "./project-document-types";

export type ProjectStatus = "active" | "draft" | "archived";

export type ProjectVersionEntry = {
  /** 展示用版本标签 */
  version: string;
  date: string;
  /** History 快照 id，用于恢复 */
  historyId?: string;
};

export type ProjectRecord = {
  id: string;
  /** 磁盘目录名（IPC 主键） */
  folderName: string;
  name: string;
  modifiedAt: string;
  createdAt: string;
  version: string;
  author: string;
  sizeMb: number;
  deviceCount: number;
  controlledObjectCount: number;
  trussCount: number;
  fixtureCount: number;
  status: ProjectStatus;
  tags: string[];
  lastBackupAt?: string;
  recent?: boolean;
  versionHistory: ProjectVersionEntry[];
  /** 工程配置体；打开后水合 */
  document?: ProjectDocument;
  hasCover?: boolean;
  coverPath?: string | null;
  coverDataUrl?: string | null;
  /** 工程目录绝对路径（打开后用于通知 C++ runtime） */
  projectPath?: string;
  /** 工程文件格式版本；读不出来为 null，没给（测试数据）当作当前版本 */
  formatVersion?: number | null;
  /** 能不能打开，没给当 ok；见 shared/project/types.ts ProjectCompat */
  compat?: ProjectCompat;
  compatMessage?: string;
};

export type ProjectFilterTab = "all" | "recent" | "archived";
