import { rmSync } from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import electron from 'vite-plugin-electron/simple'
import pkg from './package.json'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  rmSync('dist-electron', { recursive: true, force: true })

  const isServe = command === 'serve'
  const isBuild = command === 'build'
  const isDebugBuild = process.env.BUILD_MODE === 'debug'
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
    esbuild: esbuildDrop,
    plugins: [
      react(),
      tailwindcss(),
      electron({
        main: {
          entry: 'electron/main/index.ts',
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
              'process.env.BUILD_MODE': JSON.stringify(process.env.BUILD_MODE ?? ''),
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
