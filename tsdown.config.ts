import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'

const PLUGIN_ID = "dsh-update-center"

const CLIENT_EXTERNALS = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  'cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-modules/client',
  /**
   * 宿主设置页用的同一批基线控件。必须走 shell 的 PLATFORM_MODULES 静态表，
   * 不能打包进 bundle——否则面板控件与桌面端脱钩，主题/改版都跟不上。
   */
  '@deepseek-ai/dsh-client-ui-primitives',
]

const clientBundle: UserConfig = {
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  deps: {
    neverBundle: [...CLIENT_EXTERNALS],
    alwaysBundle: (id: string) => !CLIENT_EXTERNALS.includes(id),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(PLUGIN_ID) + ', factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    codeSplitting: false,
  },
}

export default [clientBundle] satisfies UserConfig[]
