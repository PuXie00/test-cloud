import { UserRound } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { useAuth } from "@/app/auth/use-auth";
import { EmergencyStopButton } from "@/app/components/ics/emergency-stop-button";
import { useProject } from "@/app/project/use-project";
import { LoginForm } from "@/app/pages/login/login-form";
import { useExecCardActions } from "../../hooks/use-exec-cards";
import { usePlcRuntime } from "../../hooks/plc-runtime-provider";
import { useConsoleLogin } from "./console-login-context";

/**
 * 控制台上的原地登录框：切换用户、退出登录后都在这里登录。
 * 控制台不卸载（3D、设备连接、任务卡、动作草稿都保留），设备不受影响，急停一直可点。
 */
export const LoginOverlay = () => {
  const { isAuthenticated, user } = useAuth();
  const { switchUserOpen, closeSwitchUser } = useConsoleLogin();
  const { emergencyStopAll } = useExecCardActions();
  const { allStopAll } = usePlcRuntime();
  const { currentProject } = useProject();
  const open = !isAuthenticated || switchUserOpen;

  // 登录框打开时背后的控制台快捷键不响应（只拦按下，抬起照常，免得按键状态卡住）
  useEffect(() => {
    if (!open) return;
    const block = (event: KeyboardEvent) => event.stopImmediatePropagation();
    window.addEventListener("keydown", block, true);
    return () => window.removeEventListener("keydown", block, true);
  }, [open]);

  if (!open) return null;

  const switching = isAuthenticated;

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-6 bg-background/95"
      role="dialog"
      aria-modal="true"
      aria-label={switching ? "切换用户" : "登录"}
    >
      <main className="w-full max-w-[440px] rounded-xl bg-card p-8 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
        <header className="mb-6 flex flex-col items-center gap-1 text-center">
          <UserRound className="h-10 w-10 text-muted-foreground" aria-hidden />
          <h2 className="text-heading-md font-semibold text-foreground">
            {switching ? "切换用户" : "请登录"}
          </h2>
          <p className="text-body-sm text-muted-foreground">
            {switching ? `当前用户：${user?.displayName ?? ""}` : "已退出登录，设备照常运行"}
          </p>
          {currentProject ? (
            <p className="text-body-sm text-muted-foreground">
              工程：<span className="text-foreground">{currentProject.name}</span>
            </p>
          ) : null}
        </header>
        <LoginForm
          prefillLastUsername={!switching}
          onSuccess={(session) => {
            closeSwitchUser();
            toast.success(`已登录：${session.user.displayName}`);
          }}
          secondaryAction={
            switching ? (
              <button
                type="button"
                onClick={closeSwitchUser}
                className="h-12 rounded-md px-6 text-body-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                取消
              </button>
            ) : null
          }
        />
      </main>
      <p className="text-body-sm text-muted-foreground">急停按钮始终响应 ↓</p>
      <EmergencyStopButton
        onClick={() => {
          emergencyStopAll();
          void allStopAll();
        }}
      />
    </div>
  );
};
