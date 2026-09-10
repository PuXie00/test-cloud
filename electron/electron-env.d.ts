/// <reference types="vite-electron-plugin/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    VSCODE_DEBUG?: 'true'
    BUILD_MODE?: string
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
    YZ_CPP_WS_URL?: string
    YZ_PROJECT_ROOT?: string
    YZ_CPP_RUNTIME_PATH?: string
    YZ_CPP_RUNTIME_EXE?: string
  }
}
