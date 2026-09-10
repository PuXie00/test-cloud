import {
  AlertOctagon,
  ArrowRightLeft,
  Clock,
  Link2,
  Ruler,
  ShieldAlert,
} from "lucide-react";
import type { ElementType } from "react";

export type RuleTemplateId =
  | "T_INTERLOCK_RUN"
  | "T_INTERLOCK_DIST"
  | "T_SEQUENCE_NEXT"
  | "T_TIMECODE_TRIGGER"
  | "T_FAULT_PROTECT"
  | "T_DMX_LINK";

export type RuleTemplate = {
  id: RuleTemplateId;
  name: string;
  description: string;
  icon: ElementType;
};

export const RULE_TEMPLATES: RuleTemplate[] = [
  { id: "T_INTERLOCK_RUN", name: "互锁保护 · 运行时禁止", description: "A 运行时禁止 B 启动", icon: ShieldAlert },
  { id: "T_INTERLOCK_DIST", name: "互锁保护 · 最小位差", description: "A/B 位置差 < 阈值时停止", icon: Ruler },
  { id: "T_SEQUENCE_NEXT", name: "顺序控制 · 到位启动", description: "A 到位后自动启动 B", icon: ArrowRightLeft },
  { id: "T_FAULT_PROTECT", name: "故障响应", description: "报警时执行保护动作", icon: AlertOctagon },
];

export type Rule = {
  id: string;
  name: string;
  templateId: RuleTemplateId | null;
  enabled: boolean;
  status: "ok" | "error";
  triggers: number;
  lastTriggeredAt: string | null;
  updatedAt: string;
};

export const INITIAL_RULES: Rule[] = [
  {
    id: "r1",
    name: "升降互锁-A/B",
    templateId: "T_INTERLOCK_RUN",
    enabled: true,
    status: "ok",
    triggers: 128,
    lastTriggeredAt: "2026-05-27T03:21:00Z",
    updatedAt: "2026-05-20T12:00:00Z",
  },
  {
    id: "r2",
    name: "最小位差保护",
    templateId: "T_INTERLOCK_DIST",
    enabled: true,
    status: "ok",
    triggers: 42,
    lastTriggeredAt: "2026-05-26T19:05:00Z",
    updatedAt: "2026-05-22T10:30:00Z",
  },
  {
    id: "r3",
    name: "Timecode 触发",
    templateId: "T_TIMECODE_TRIGGER",
    enabled: false,
    status: "ok",
    triggers: 0,
    lastTriggeredAt: null,
    updatedAt: "2026-05-25T15:00:00Z",
  },
];
