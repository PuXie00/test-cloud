import { ChevronDown, Hexagon } from "lucide-react";
import { useState } from "react";
import { SoftwareLicenseDialog } from "@/app/components/license";
import { useLicense } from "@/app/license/use-license";
import { LoginBackground } from "./login-background";
import { LoginForm } from "./login-form";
import { LoginLicenseFooter } from "./login-license-footer";

export const LoginPage = () => {
  const { isActivated } = useLicense();
  const [licenseOpen, setLicenseOpen] = useState(false);

  const handleOpenActivate = () => {
    setLicenseOpen(true);
  };

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

      <SoftwareLicenseDialog
        open={licenseOpen}
        onOpenChange={setLicenseOpen}
        dismissible
        defaultTab={isActivated ? "info" : "activate"}
        onActivated={() => setLicenseOpen(false)}
      />

      <main className="login-card-glow relative z-10 w-full max-w-[560px] rounded-xl bg-card p-10">
        <header className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary shadow-[0_0_15px] shadow-primary/30">
            <Hexagon className="h-8 w-8 fill-primary text-primary-foreground" aria-hidden />
          </div>
          <p className="text-heading-md font-semibold uppercase tracking-wider text-muted-foreground">
            YZDITEC 岳中数字科技
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <h1 className="text-heading-xl font-bold text-primary">流动演出高端控制系统</h1>
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-mono-sm text-primary">
              v3.0
            </span>
          </div>
        </header>
        <div className="my-6 h-px bg-border" role="separator" />
        <LoginForm disabled={!isActivated} />
        <LoginLicenseFooter onActivate={handleOpenActivate} />
      </main>
      <p className="pointer-events-none fixed bottom-5 left-1/2 z-0 -translate-x-1/2 font-mono text-mono-sm uppercase tracking-widest text-muted-foreground">
        v3.0.1 Build 20260508
      </p>
    </div>
  );
};
