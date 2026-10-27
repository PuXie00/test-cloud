import { Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { LicenseAck } from "@shared/csocket/license";
import { useLicense } from "@/app/license/use-license";
import { Input } from "@/app/components/ui/input";

type LicenseActivateFormProps = {
  /** 激活成功（C++ 回 success） */
  onSuccess?: (result: LicenseAck) => void;
  /** 每次拿到结果（含失败、超时），授权页据此决定是否接着联网校验 */
  onResult?: (result: LicenseAck) => void;
  autoFocus?: boolean;
};

/** 输入授权码，交给 C++ 联网激活（Auth|activate），可能要等授权服务器回复 */
export const LicenseActivateForm = ({ onSuccess, onResult, autoFocus }: LicenseActivateFormProps) => {
  const { activate } = useLicense();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (submitting) return;
    setError(null);
    if (!code.trim()) {
      setError("请输入授权码");
      return;
    }
    setSubmitting(true);
    const result = await activate(code);
    setSubmitting(false);
    onResult?.(result);
    if (!result.success) {
      setError(result.message || "激活失败");
      return;
    }
    setCode("");
    onSuccess?.(result);
  };

  return (
    <form className="flex flex-col gap-2" onSubmit={handleSubmit} noValidate>
      <label htmlFor="license-code" className="text-body-sm text-muted-foreground">
        授权码
      </label>
      <Input
        id="license-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="XXXX-XXXX-XXXX-XXXX"
        className="h-11 font-mono"
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        disabled={submitting}
      />
      <p className="min-h-[18px] text-body-sm text-destructive" role="alert" aria-live="polite">
        {error}
      </p>
      <button
        type="submit"
        disabled={submitting}
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {submitting ? "正在联网激活…" : "激活"}
      </button>
    </form>
  );
};
