/// <reference types="vite-electron-plugin/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    VSCODE_DEBUG?: 'true'
    /** true：调试包，保留 console，C++ 运行时开控制台窗口 */
    IS_DEBUG?: string
    /** true：开发态。运动学程序用项目目录，C++ 运行时用项目 Runtime；否则都用安装目录 */
    IS_DEV?: string
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
    YZ_CPP_WS_URL?: string
    YZ_PROJECT_ROOT?: string
    YZ_AI_HTTP_PORT?: string
    /** 本机用户数据文件，默认在用户数据目录的 users.json */
    YZ_USERS_FILE?: string
  }
}

/** 打包时从 .env.[mode] 读到的 YZ_*，见 vite.config.ts、main/app-env.ts */
declare const __YZ_ENV__: Record<string, string>
