import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { licenseStateOf, type LicenseAck, type LicenseInfo, type LicenseState } from "@shared/csocket/license";

type LicenseContextValue = {
  /** 拿不到 csocketApi 的授权指令（测试 / 纯浏览器环境）时不拦 */
  available: boolean;
  /** 主进程状态读回来之前为 false */
  ready: boolean;
  state: LicenseState;
  info: LicenseInfo | null;
  /** 查本地授权状态（Auth|localStatus） */
  check: () => Promise<LicenseAck>;
  activate: (code: string) => Promise<LicenseAck>;
  /** 联网校验（Auth|verify） */
  verify: () => Promise<LicenseAck>;
  /** 开发模式跳过（只在未打包时有效） */
  skip: () => Promise<LicenseAck>;
};

export const LicenseContext = createContext<LicenseContextValue | null>(null);

const INITIAL_STATE: LicenseState = { passed: false, skipped: false, devSkipAllowed: false, info: null };

const licenseApi = () => (typeof window.csocketApi?.authLocalStatus === "function" ? window.csocketApi : null);

/**
 * 授权状态由主进程 cSocket 保管（渲染进程刷新后不用重新过授权）；这里只是镜像。
 * 不轮询：状态只在查询、激活、校验和 C++ 迟到的回复时变化。
 */
export const LicenseProvider = ({ children }: { children: ReactNode }) => {
  const [available] = useState(() => licenseApi() !== null);
  const [ready, setReady] = useState(() => licenseApi() === null);
  const [state, setState] = useState<LicenseState>(INITIAL_STATE);

  useEffect(() => {
    const api = licenseApi();
    if (!api) return;
    let cancelled = false;
    const apply = (result: LicenseAck) => {
      const next = licenseStateOf(result);
      if (next && !cancelled) setState(next);
    };
    const off = api.onLicense(apply);
    void api
      .getLicenseSnapshot()
      .then(apply)
      .catch((err) => console.error("[license] 读取授权状态失败", err))
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const run = useCallback(async (call: (api: Window["csocketApi"]) => Promise<LicenseAck>): Promise<LicenseAck> => {
    const api = licenseApi();
    if (!api) return { success: false, code: "UNAVAILABLE", message: "当前环境不支持软件授权", data: [INITIAL_STATE] };
    const result = await call(api);
    const next = licenseStateOf(result);
    if (next) setState(next);
    return result;
  }, []);

  const check = useCallback(() => run((api) => api.authLocalStatus()), [run]);
  const activate = useCallback((code: string) => run((api) => api.authActivate([{ code }])), [run]);
  const verify = useCallback(() => run((api) => api.authVerify()), [run]);
  const skip = useCallback(() => run((api) => api.authSkip()), [run]);

  const value = useMemo<LicenseContextValue>(
    () => ({ available, ready, state, info: state.info, check, activate, verify, skip }),
    [available, ready, state, check, activate, verify, skip],
  );

  return <LicenseContext.Provider value={value}>{children}</LicenseContext.Provider>;
};
