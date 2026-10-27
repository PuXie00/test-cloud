import { Hexagon } from "lucide-react";

/** 登录页 / 授权页卡片顶部的品牌抬头 */
export const LoginBrand = () => (
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
);
