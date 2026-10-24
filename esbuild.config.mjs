import { context } from 'esbuild';
import { builtinModules } from 'node:module';
import { readFile } from 'node:fs/promises';

const production = process.argv.includes('production');
const builder = await context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'cjs',
  target: 'es2022',
  outfile: 'main.js',
  minify: production,
  sourcemap: production ? false : 'inline',
  legalComments: 'inline',
  external: [
    'obsidian', 'electron', '@codemirror/*', '@lezer/common', '@lezer/highlight',
    '@lezer/lr', ...builtinModules, ...builtinModules.map(name => `node:${name}`),
  ],
  banner: { js: `/* Hover Bar | MIT | https://github.com/saltcoffee/hover-bar\n\n${await readFile('LICENSE', 'utf8')}\n${await readFile('THIRD_PARTY_NOTICES.md', 'utf8')}\n*/` },
});
if (production) {
  await builder.rebuild();
  await builder.dispose();
} else {
  await builder.watch();
}
