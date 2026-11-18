import path from 'node:path'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// 和打包一样从 .env 读工程文件格式版本（见 vite.config.ts）
const projectSchemaVersion = loadEnv('test', __dirname, 'YZ_').YZ_PROJECT_SCHEMA_VERSION ?? '1'

export default defineConfig({
  define: {
    __YZ_PROJECT_SCHEMA_VERSION__: JSON.stringify(projectSchemaVersion),
  },
  resolve: {
    alias: {
      '@': path.join(__dirname, 'src'),
      '@shared': path.join(__dirname, 'shared'),
    },
  },
  test: {
    root: __dirname,
    include: [
      'test/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/app/kinematics/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/app/project/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/app/pages/console/hooks/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/app/pages/console/components/right-sidebar/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/app/pages/console/components/action-builder/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      // Plan-mandated Task 1 suite path; required for
      // `npx vitest run src/app/pages/console/components/program-panel/resolve-program-motion.spec.ts`
      'src/app/pages/console/components/program-panel/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      // Plan-mandated Task 8 suite path; required for
      // `npx vitest run src/app/pages/console/components/exec-area/exec-area.test.tsx`
      'src/app/pages/console/components/exec-area/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/app/pages/console/components/system-settings/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/app/pages/console/components/build-debug/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/app/pages/console/components/monitor-grid/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/app/pages/console/components/right-tab-panel/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/app/pages/console/components/operation-log/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/app/pages/console/3d/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/app/components/ics/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/app/components/project-center/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/app/components/ui/input-numeric.test.ts',
      'src/app/components/ui/input.spec.tsx',
      'src/app/viz3d/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      // 用户与权限
      'src/app/auth/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/app/pages/login/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/app/pages/console/components/login-overlay/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/app/pages/console/components/permissions/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      // 软件授权
      'src/app/license/**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    testTimeout: 1000 * 29,
  },
})
