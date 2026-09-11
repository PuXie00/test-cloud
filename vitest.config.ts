import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
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
      // `npx vitest run src/app/pages/console/components/program-panel/resolve-program-motion.test.ts`
      'src/app/pages/console/components/program-panel/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      // Plan-mandated Task 8 suite path; required for
      // `npx vitest run src/app/pages/console/components/exec-area/exec-area.test.tsx`
      'src/app/pages/console/components/exec-area/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/app/pages/console/components/system-settings/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/app/pages/console/components/build-debug/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/app/pages/console/components/monitor-grid/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/app/pages/console/components/right-tab-panel/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/app/pages/console/3d/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/app/components/ics/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/app/components/ui/input-numeric.test.ts',
      'src/app/viz3d/**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    testTimeout: 1000 * 29,
  },
})
