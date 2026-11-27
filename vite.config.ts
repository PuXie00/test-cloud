import { rmSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'
import electron from 'vite-plugin-electron/simple'
import pkg from './package.json'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  rmSync('dist-electron', { recursive: true, force: true })

  const isServe = command === 'serve'
  const isBuild = command === 'build'

  // 环境 = mode：开发 development（pnpm dev）/ 测试 staging / 正式 production（vite build 默认）
  // 读 .env、.env.local、.env.[mode]、.env.[mode].local，打包机 shell 里的同名变量优先
  const fileEnv = loadEnv(mode, __dirname, ['YZ_', 'IS_DEBUG', 'IS_DEV'])
  // 工程文件格式版本：打包时写进主进程和界面（__YZ_PROJECT_SCHEMA_VERSION__），不放进 __YZ_ENV__，现场的系统环境变量改不了它
  const projectSchemaVersion = JSON.stringify(fileEnv.YZ_PROJECT_SCHEMA_VERSION ?? '1')
  const yzEnv = Object.fromEntries(
    Object.entries(fileEnv).filter(([key]) => key.startsWith('YZ_') && key !== 'YZ_PROJECT_SCHEMA_VERSION'),
  )
  const isDebugBuild = fileEnv.IS_DEBUG === 'true'
  const isDev = fileEnv.IS_DEV === 'true'
  const sourcemap = isServe || !!process.env.VSCODE_DEBUG

  // 正式构建：完全移除 console + debugger；调试构建：保留所有 console
  const esbuildDrop = (isBuild && !isDebugBuild)
    ? { drop: ['console', 'debugger'] as ('console' | 'debugger')[] }
    : {}

  return {
    resolve: {
      alias: {
        '@': path.join(__dirname, 'src'),
        '@shared': path.join(__dirname, 'shared'),
      },
    },
    worker: { format: 'es' },
    esbuild: esbuildDrop,
    define: {
      __YZ_PROJECT_SCHEMA_VERSION__: projectSchemaVersion,
    },
    plugins: [
      react(),
      tailwindcss(),
      electron({
        main: {
          // ai-server：本地 AI 只读 HTTP 服务，由 main 以 utilityProcess 拉起
          entry: {
            index: 'electron/main/index.ts',
            'ai-server': 'electron/ai-server/index.ts',
          },
          onstart(args) {
            if (process.env.VSCODE_DEBUG) {
              console.log(/* For `.vscode/.debug.script.mjs` */'[startup] Electron App')
            } else {
              args.startup()
            }
          },
          vite: {
            esbuild: esbuildDrop,
            build: {
              sourcemap,
              minify: isBuild,
              outDir: 'dist-electron/main',
              rollupOptions: {
                external: Object.keys(pkg.dependencies || {}),
              },
            },
            define: {
              __BUILD_DEBUG__: JSON.stringify(isDebugBuild),
              __YZ_ENV__: JSON.stringify(yzEnv),
              __YZ_PROJECT_SCHEMA_VERSION__: projectSchemaVersion,
              'process.env.IS_DEBUG': JSON.stringify(isDebugBuild ? 'true' : 'false'),
              'process.env.IS_DEV': JSON.stringify(isDev ? 'true' : 'false'),
            },
          },
        },
        preload: {
          input: 'electron/preload/index.ts',
          vite: {
            esbuild: esbuildDrop,
            build: {
              sourcemap: sourcemap ? 'inline' : undefined,
              minify: isBuild,
              outDir: 'dist-electron/preload',
              rollupOptions: {
                external: Object.keys(pkg.dependencies || {}),
              },
            },
          },
        },
        renderer: {},
      }),
    ],
    server: {
      host: '127.0.0.1',
      // 开发态工程目录在 APP_ROOT/Project；保存写盘不得触发 Vite 整页刷新
      watch: {
        ignored: ['**/Project/**'],
      },
      ...(process.env.VSCODE_DEBUG
        ? (() => {
            const url = new URL(pkg.debug.env.VITE_DEV_SERVER_URL)
            return {
              host: url.hostname,
              port: +url.port,
            }
          })()
        : {}),
    },
    clearScreen: false,
  }
})
