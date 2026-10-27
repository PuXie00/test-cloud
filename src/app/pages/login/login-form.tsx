import { Eye, EyeOff, KeyRound, Lock, User } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { MIN_PASSWORD_LENGTH, type AuthSession } from "@shared/auth/types";
import { readLastUsername, writeLastUsername } from "@/app/auth/last-username";
import { useAuth } from "@/app/auth/use-auth";
import { Input } from "@/app/components/ui/input";
import { cn } from "@/app/components/ui/utils";

type LoginFormProps = {
  disabled?: boolean;
  /** 登录成功（含改完密码）后 */
  onSuccess: (session: AuthSession) => void;
  /** 「登 录」按钮旁的额外按钮（如切换用户里的「取消」） */
  secondaryAction?: ReactNode;
  disabledHint?: string;
  /** 预填上次登录的用户名，光标直接在密码框；切换用户时不填（是换别人登录） */
  prefillLastUsername?: boolean;
};

const fieldClass = "h-12 pl-12 pr-4";

const PasswordInput = ({
  value,
  onChange,
  placeholder,
  autoComplete,
  disabled,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoComplete: string;
  disabled: boolean;
  autoFocus?: boolean;
}) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Lock
        className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        className={cn(fieldClass, "pr-12")}
        type={visible ? "text" : "password"}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        autoFocus={autoFocus}
      />
      <button
        type="button"
        className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary disabled:opacity-50"
        aria-label={visible ? "隐藏密码" : "显示密码"}
        onClick={() => setVisible((v) => !v)}
        disabled={disabled}
      >
        {visible ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
      </button>
    </div>
  );
};

/** 本机用户登录；首次登录或密码被重置时先改密码再进入 */
export const LoginForm = ({
  disabled = false,
  onSuccess,
  secondaryAction,
  disabledHint,
  prefillLastUsername = true,
}: LoginFormProps) => {
  const { login, loginWithNewPassword } = useAuth();
  const [step, setStep] = useState<"credentials" | "newPassword">("credentials");
  const [username, setUsername] = useState(() => (prefillLastUsername ? readLastUsername() : ""));
  // 只在打开时决定光标位置，输入过程中不跳
  const [focusPassword] = useState(() => username !== "");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [forgotHint, setForgotHint] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isDisabled = disabled || submitting;

  const submitCredentials = async () => {
    if (!username.trim() || !password) {
      setError("请输入用户名和密码");
      return;
    }
    const result = await login({ username, password });
    if (result.ok) {
      writeLastUsername(result.data.user.username);
      onSuccess(result.data);
      return;
    }
    if (result.code === "MUST_CHANGE_PASSWORD") {
      setStep("newPassword");
      setNotice("首次登录或密码已被重置，请先设置新密码");
      return;
    }
    setError(result.message);
  };

  const submitNewPassword = async () => {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`密码至少 ${MIN_PASSWORD_LENGTH} 位`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    if (newPassword === password) {
      setError("新密码不能和原密码相同");
      return;
    }
    const result = await loginWithNewPassword({ username, password, newPassword });
    if (result.ok) {
      writeLastUsername(result.data.user.username);
      onSuccess(result.data);
      return;
    }
    setError(result.message);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isDisabled) return;
    setForgotHint(false);
    setError(null);
    setSubmitting(true);
    try {
      if (step === "credentials") await submitCredentials();
      else await submitNewPassword();
    } finally {
      setSubmitting(false);
    }
  };

  const backToCredentials = () => {
    setStep("credentials");
    setNewPassword("");
    setConfirmPassword("");
    setNotice(null);
    setError(null);
  };

  return (
    <form
      className={cn("flex flex-col gap-4", disabled && "pointer-events-none opacity-50")}
      onSubmit={(e) => void handleSubmit(e)}
      noValidate
      aria-disabled={disabled}
    >
      {disabled && disabledHint && (
        <p className="rounded-md bg-muted/60 px-3 py-2 text-body-sm text-muted-foreground">{disabledHint}</p>
      )}
      {step === "credentials" ? (
        <>
          <div className="relative">
            <User
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className={fieldClass}
              placeholder="用户名 / Username"
              aria-label="用户名"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isDisabled}
              autoFocus={!focusPassword}
            />
          </div>
          <PasswordInput
            value={password}
            onChange={setPassword}
            placeholder="密码 / Password"
            autoComplete="current-password"
            disabled={isDisabled}
            autoFocus={focusPassword}
          />
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
        </>
      ) : (
        <>
          <p className="flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-body-sm text-foreground">
            <KeyRound className="h-4 w-4 shrink-0 text-warning" aria-hidden />
            {notice}（{username.trim()}）
          </p>
          <PasswordInput
            value={newPassword}
            onChange={setNewPassword}
            placeholder={`新密码（至少 ${MIN_PASSWORD_LENGTH} 位）`}
            autoComplete="new-password"
            disabled={isDisabled}
            autoFocus
          />
          <PasswordInput
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder="再次输入新密码"
            autoComplete="new-password"
            disabled={isDisabled}
          />
          <div className="flex justify-end">
            <button
              type="button"
              className="text-body-sm text-muted-foreground hover:text-primary disabled:opacity-50"
              onClick={backToCredentials}
              disabled={isDisabled}
            >
              返回
            </button>
          </div>
        </>
      )}
      <p className="min-h-[18px] text-body-sm text-destructive" role="alert" aria-live="polite">
        {error}
      </p>
      <div className="flex gap-3">
        {secondaryAction}
        <button
          type="submit"
          disabled={isDisabled}
          className="h-12 flex-1 rounded-md bg-primary font-semibold text-primary-foreground transition-transform active:scale-[0.98] hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {step === "credentials" ? "登 录" : "修改密码并登录"}
        </button>
      </div>
    </form>
  );
};
