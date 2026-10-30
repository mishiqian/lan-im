import { readFileSync } from 'node:fs'

const id = '@mishiqian/lan-im'
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
const platformModules = [
  'react',
  'react-dom',
  'react-dom/client',
]

export default [{
  entry: ['lib/types/index.js', 'lib/types/protocol.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}, {
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  define: { __LANIM_VERSION__: JSON.stringify('v' + version) },
  deps: {
    neverBundle: platformModules,
    alwaysBundle: (id) => platformModules.includes(id) ? undefined : true,
    onlyBundle: false,
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}]
