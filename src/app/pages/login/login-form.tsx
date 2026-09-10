import { Eye, EyeOff, Lock, User } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/app/auth/use-auth";
import { useLicense } from "@/app/license/use-license";
import { Input } from "@/app/components/ui/input";
import { cn } from "@/app/components/ui/utils";

type LoginFormProps = {
  disabled?: boolean;
};

export const LoginForm = ({ disabled = false }: LoginFormProps) => {
  const { login } = useAuth();
  const { isActivated } = useLicense();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotHint, setForgotHint] = useState(false);

  const isDisabled = disabled || !isActivated;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setForgotHint(false);
    setError(null);
    if (!isActivated) {
      setError("请先完成软件授权激活");
      return;
    }
    if (!username.trim() || !password) {
      setError("请输入用户名和密码");
      return;
    }
    if (!login(username, password)) {
      setError("用户名或密码错误");
      return;
    }
    navigate("/project-center", { replace: true });
  };

  const fieldClass = "h-12 pl-12 pr-4";

  return (
    <form
      className={cn("flex flex-col gap-4", isDisabled && "pointer-events-none opacity-50")}
      onSubmit={handleSubmit}
      noValidate
      aria-disabled={isDisabled}
    >
      {!isActivated && (
        <p className="rounded-md bg-muted/60 px-3 py-2 text-body-sm text-muted-foreground">
          请先完成软件授权激活后再登录
        </p>
      )}
      <div className="relative">
        <User
          className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          className={fieldClass}
          placeholder="用户名 / Username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={isDisabled}
        />
      </div>
      <div className="relative">
        <Lock
          className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          className={cn(fieldClass, "pr-12")}
          type={showPassword ? "text" : "password"}
          placeholder="密码 / Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isDisabled}
        />
        <button
          type="button"
          className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary disabled:opacity-50"
          aria-label={showPassword ? "隐藏密码" : "显示密码"}
          onClick={() => setShowPassword((v) => !v)}
          disabled={isDisabled}
        >
          {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          className="text-body-sm text-muted-foreground hover:text-primary disabled:opacity-50"
          onClick={() => {
            setForgotHint(true);
            setError(null);
          }}
          disabled={isDisabled}
        >
          忘记密码？
        </button>
        {forgotHint && (
          <p className="text-body-sm text-muted-foreground">请联系系统管理员重置密码</p>
        )}
      </div>
      <p className="min-h-[18px] text-body-sm text-destructive" role="alert" aria-live="polite">
        {error}
      </p>
      <button
        type="submit"
        disabled={isDisabled}
        className="h-12 w-full rounded-md bg-primary font-semibold text-primary-foreground transition-transform active:scale-[0.98] hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        登 录
      </button>
    </form>
  );
};
