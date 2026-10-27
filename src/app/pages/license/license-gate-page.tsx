import {
  CalendarX,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Unplug,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { isLicenseNoReply, licenseStateOf, type LicenseAck } from "@shared/csocket/license";
import { LicenseActivateForm } from "@/app/components/license/license-activate-panel";
import { cn } from "@/app/components/ui/utils";
import { licenseDate } from "@/app/license/license-labels";
import { useLicense } from "@/app/license/use-license";
import { LoginBackground } from "@/app/pages/login/login-background";
import { LoginBrand } from "@/app/pages/login/login-brand";

type Tone = "primary" | "warning" | "destructive";

const TONE_CLASS: Record<Tone, string> = {
  primary: "bg-primary/10 text-primary",
  warning: "bg-warning-surface text-warning",
  destructive: "bg-destructive/10 text-destructive",
};

const GateStep = ({
  icon: Icon,
  tone,
  title,
  description,
  notice,
  actions,
  children,
}: {
  icon: LucideIcon;
  tone: Tone;
  title: string;
  description: string;
  notice?: string | null;
  actions?: ReactNode;
  children?: ReactNode;
}) => (
  <section className="flex flex-col gap-4" aria-labelledby="license-gate-title">
    <div className="flex items-start gap-3">
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-md", TONE_CLASS[tone])}>
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id="license-gate-title" className="text-heading-md font-semibold text-foreground">
          {title}
        </h2>
        <p className="text-body-sm text-muted-foreground">{description}</p>
      </div>
    </div>
    {notice && (
      <p className="rounded-md bg-destructive/10 px-3 py-2 text-body-sm text-destructive" role="alert">
        {notice}
      </p>
    )}
    {children}
    {actions && <div className="flex gap-3">{actions}</div>}
  </section>
);

const ActionButton = ({
  onClick,
  children,
  variant = "primary",
}: {
  onClick: () => void;
  children: ReactNode;
  variant?: "primary" | "secondary";
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md px-4 font-semibold",
      variant === "primary"
        ? "bg-primary text-primary-foreground hover:bg-primary/90"
        : "bg-accent text-foreground hover:bg-accent/80",
    )}
  >
    {children}
  </button>
);

type Busy = "checking" | "verifying" | null;

/**
 * 启动授权页：每次进软件先查本地授权状态（Auth|localStatus），没放行就不显示登录页。
 * 未激活 / 过期 → 输入授权码激活；离线超期 → 等联网校验，失败可重试；正常 → 放行。
 */
export const LicenseGatePage = () => {
  const { ready, state, check, verify, skip } = useLicense();
  const [busy, setBusy] = useState<Busy>("checking");
  const [unreachable, setUnreachable] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const started = useRef(false);

  const runVerify = useCallback(async () => {
    setBusy("verifying");
    setNotice(null);
    const result = await verify();
    setBusy(null);
    if (!result.success) setNotice(result.message || "联网校验失败");
  }, [verify]);

  const runCheck = useCallback(async () => {
    setBusy("checking");
    setUnreachable(false);
    setNotice(null);
    const result = await check();
    const info = licenseStateOf(result)?.info;
    const replied = !isLicenseNoReply(result);
    // 离线超期：直接联网校验，界面等着
    if (replied && info?.status === "needVerify") return runVerify();
    setBusy(null);
    // 没拿到回复，或 C++ 回了但没带状态
    if (!replied || !info) {
      setUnreachable(true);
      setNotice(result.message || "控制服务没有返回授权状态");
    }
  }, [check, runVerify]);

  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    void runCheck();
  }, [ready, runCheck]);

  const handleActivateResult = (result: LicenseAck) => {
    if (result.success && licenseStateOf(result)?.info?.status === "needVerify") void runVerify();
  };

  const handleSkip = async () => {
    const result = await skip();
    if (!result.success) setNotice(result.message ?? "");
  };

  const info = state.info;
  let body: ReactNode;
  if (busy) {
    body = (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
        <p className="text-body-md text-foreground">
          {busy === "checking" ? "正在读取授权状态…" : "正在联网校验授权，请稍候…"}
        </p>
        {busy === "verifying" && info?.graceUntil && (
          <p className="text-body-sm text-muted-foreground">
            离线可用至 <span className="font-mono tabular-nums">{info.graceUntil}</span>，已超过离线期限
          </p>
        )}
      </div>
    );
  } else if (unreachable || !info) {
    body = (
      <GateStep
        icon={Unplug}
        tone="warning"
        title="读取不到授权状态"
        description="软件需要通过控制服务（YzRuntime）确认授权后才能使用。"
        notice={notice}
        actions={
          <>
            <ActionButton onClick={() => void runCheck()}>
              <RefreshCw className="h-4 w-4" aria-hidden />
              重试
            </ActionButton>
            {state.devSkipAllowed && (
              <ActionButton variant="secondary" onClick={() => void handleSkip()}>
                跳过（开发模式）
              </ActionButton>
            )}
          </>
        }
      />
    );
  } else if (info.status === "inactive") {
    body = (
      <GateStep
        icon={KeyRound}
        tone="primary"
        title="软件未激活"
        description="请输入厂商提供的授权码激活，激活需要联网。"
        notice={notice}
      >
        <LicenseActivateForm autoFocus onResult={handleActivateResult} />
      </GateStep>
    );
  } else if (info.status === "needVerify") {
    body = (
      <GateStep
        icon={WifiOff}
        tone="warning"
        title="需要联网校验授权"
        description={`离线使用已超过期限（离线可用至 ${licenseDate(info.graceUntil)}），请连接网络后重新校验。`}
        notice={notice}
        actions={
          <ActionButton onClick={() => void runVerify()}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            重新校验
          </ActionButton>
        }
      />
    );
  } else if (info.status === "expired") {
    body = (
      <GateStep
        icon={CalendarX}
        tone="destructive"
        title="授权已过期"
        description={`授权已于 ${licenseDate(info.expireAt)} 到期，请输入新的授权码重新激活。`}
        notice={notice}
      >
        <LicenseActivateForm autoFocus onResult={handleActivateResult} />
      </GateStep>
    );
  } else {
    body = (
      <GateStep
        icon={ShieldAlert}
        tone="warning"
        title="授权状态异常"
        description={info.message || `控制服务返回了无法识别的授权状态（${info.statusCode}）。`}
        notice={notice}
        actions={
          <ActionButton onClick={() => void runCheck()}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            重试
          </ActionButton>
        }
      />
    );
  }

  return (
    <div className="relative flex h-screen w-full items-center justify-center overflow-hidden bg-background text-foreground">
      <LoginBackground />
      <main className="login-card-glow relative z-10 w-full max-w-[560px] rounded-xl bg-card p-10">
        <LoginBrand />
        <div className="my-6 h-px bg-border" role="separator" />
        <p className="mb-4 text-label-caps uppercase text-muted-foreground">软件授权</p>
        <div className="min-h-[220px]">{body}</div>
      </main>
    </div>
  );
};
