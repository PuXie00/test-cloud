import type { ReactNode } from "react";
import { useState } from "react";
import { Input } from "@/app/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { Switch } from "@/app/components/ui/switch";
import { PermissionsSection } from "../permissions-section";
import { SECURITY_DEFAULTS } from "../permissions-constants";
import type { SecurityPolicyDefaults } from "../permissions-types";

const FieldRow = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-center justify-between gap-4 py-2">
    <span className="text-body-md text-foreground">{label}</span>
    <div className="flex min-w-[180px] justify-end">{children}</div>
  </div>
);

export const SecurityPolicyPanel = () => {
  const [policy, setPolicy] = useState<SecurityPolicyDefaults>(SECURITY_DEFAULTS);

  const patch = (next: Partial<SecurityPolicyDefaults>) =>
    setPolicy((prev) => ({ ...prev, ...next }));

  return (
    <div className="flex flex-col gap-8 overflow-y-auto p-6">
      <PermissionsSection title="密码策略">
        <div className="rounded-md bg-muted/30 p-4">
          <FieldRow label="最小长度">
            <Select
              value={policy.minPasswordLength}
              onValueChange={(v) => patch({ minPasswordLength: v })}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="6">6 位</SelectItem>
                <SelectItem value="8">8 位</SelectItem>
                <SelectItem value="12">12 位</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="须含大写字母">
            <Switch
              checked={policy.requireUppercase}
              onCheckedChange={(v) => patch({ requireUppercase: v })}
            />
          </FieldRow>
          <FieldRow label="须含数字">
            <Switch
              checked={policy.requireNumber}
              onCheckedChange={(v) => patch({ requireNumber: v })}
            />
          </FieldRow>
          <FieldRow label="须含特殊字符">
            <Switch
              checked={policy.requireSpecial}
              onCheckedChange={(v) => patch({ requireSpecial: v })}
            />
          </FieldRow>
          <FieldRow label="密码有效期">
            <Select value={policy.passwordExpiry} onValueChange={(v) => patch({ passwordExpiry: v })}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 天</SelectItem>
                <SelectItem value="60">60 天</SelectItem>
                <SelectItem value="90">90 天</SelectItem>
                <SelectItem value="180">180 天</SelectItem>
                <SelectItem value="never">永不过期</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="到期前提醒">
            <Select value={policy.expiryReminder} onValueChange={(v) => patch({ expiryReminder: v })}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">3 天</SelectItem>
                <SelectItem value="7">7 天</SelectItem>
                <SelectItem value="14">14 天</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
        </div>
      </PermissionsSection>

      <PermissionsSection title="登录安全">
        <div className="rounded-md bg-muted/30 p-4">
          <FieldRow label="登录失败锁定">
            <Switch
              checked={policy.loginLockEnabled}
              onCheckedChange={(v) => patch({ loginLockEnabled: v })}
            />
          </FieldRow>
          <FieldRow label="最大失败次数">
            <Input
              type="number"
              className="w-[140px] font-mono tabular-nums"
              value={policy.maxFailedAttempts}
              onChange={(e) => patch({ maxFailedAttempts: Number(e.target.value) || 0 })}
            />
          </FieldRow>
          <FieldRow label="锁定时长">
            <Select value={policy.lockDuration} onValueChange={(v) => patch({ lockDuration: v })}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5 分钟</SelectItem>
                <SelectItem value="15">15 分钟</SelectItem>
                <SelectItem value="30">30 分钟</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="会话超时">
            <Select value={policy.sessionTimeout} onValueChange={(v) => patch({ sessionTimeout: v })}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 小时</SelectItem>
                <SelectItem value="4">4 小时</SelectItem>
                <SelectItem value="8">8 小时</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="单用户最大并发会话">
            <Select
              value={policy.maxConcurrentSessions}
              onValueChange={(v) => patch({ maxConcurrentSessions: v })}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1</SelectItem>
                <SelectItem value="2">2</SelectItem>
                <SelectItem value="3">3</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
        </div>
      </PermissionsSection>

      <PermissionsSection title="操作审计">
        <div className="rounded-md bg-muted/30 p-4">
          <FieldRow label="记录权限变更">
            <Switch
              checked={policy.auditPermissionChanges}
              onCheckedChange={(v) => patch({ auditPermissionChanges: v })}
            />
          </FieldRow>
          <FieldRow label="记录登录/登出">
            <Switch
              checked={policy.auditLoginLogout}
              onCheckedChange={(v) => patch({ auditLoginLogout: v })}
            />
          </FieldRow>
          <FieldRow label="审计日志保留">
            <Select value={policy.auditRetention} onValueChange={(v) => patch({ auditRetention: v })}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="90">90 天</SelectItem>
                <SelectItem value="180">180 天</SelectItem>
                <SelectItem value="365">365 天</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
        </div>
        <p className="text-body-sm text-primary">审计日志查看请前往「操作日志与回放」</p>
      </PermissionsSection>
    </div>
  );
};
