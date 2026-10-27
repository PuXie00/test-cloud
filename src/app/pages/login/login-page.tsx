import { ChevronDown } from "lucide-react";
import { useNavigate } from "react-router";
import { LoginBackground } from "./login-background";
import { LoginBrand } from "./login-brand";
import { LoginForm } from "./login-form";
import { LoginLicenseFooter } from "./login-license-footer";

export const LoginPage = () => {
  const navigate = useNavigate();

  return (
    <div className="relative flex h-screen w-full items-center justify-center overflow-hidden bg-background text-foreground">
      <LoginBackground />
      <button
        type="button"
        className="absolute right-4 top-4 z-50 flex items-center gap-1 rounded-md px-3 py-2 text-body-sm text-muted-foreground hover:text-primary"
        aria-label="语言（占位）"
      >
        中文
        <ChevronDown className="h-4 w-4" aria-hidden />
      </button>

      <main className="login-card-glow relative z-10 w-full max-w-[560px] rounded-xl bg-card p-10">
        <LoginBrand />
        <div className="my-6 h-px bg-border" role="separator" />
        {/* 授权在启动时已由授权页把关，到这里一定是放行过的 */}
        <LoginForm
          onSuccess={() => navigate("/project-center", { replace: true })}
        />
        <LoginLicenseFooter />
      </main>
      <p className="pointer-events-none fixed bottom-5 left-1/2 z-0 -translate-x-1/2 font-mono text-mono-sm uppercase tracking-widest text-muted-foreground">
        v3.0.1 Build 20260508
      </p>
    </div>
  );
};
