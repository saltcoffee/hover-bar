import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  files: new Map<string, string>(),
  tree: [] as string[],
  head: '',
  tag: '',
  trackedDocs: '',
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async (file: string, encoding?: string) => {
    const source = fixture.files.get(file);
    if (source === undefined) throw new Error(`Missing file: ${file}`);
    return encoding ? source : Buffer.from(source);
  }),
  readdir: vi.fn(async () => []),
}));
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn((_command: string, args: string[]) => {
    if (args[0] === 'ls-files') return fixture.trackedDocs;
    if (args[0] === 'ls-tree') return fixture.tree.join('\n');
    if (args[0] === 'rev-parse') return args[2] === 'HEAD^{commit}' ? fixture.head : fixture.tag;
    throw new Error(`Unexpected git operation: ${args.join(' ')}`);
  }),
}));

const originalArgv = process.argv;
const script = '../scripts/check-release.mjs';
const check = () => import(script);
const json = (file: string, value: unknown) => fixture.files.set(file, JSON.stringify(value));

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  process.argv = ['node', 'scripts/check-release.mjs', '--version', '0.1.0'];
  fixture.files.clear();
  for (const file of ['main.js', 'styles.css', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'README.zh-CN.md', 'CONTRIBUTING.md']) {
    fixture.files.set(file, 'Synthetic release fixture.');
  }
  json('manifest.json', { id: 'hover-bar', version: '0.1.0', minAppVersion: '1.8.7', isDesktopOnly: true, description: 'Format selected text.' });
  json('package.json', { version: '0.1.0' });
  json('package-lock.json', { version: '0.1.0', packages: { '': { version: '0.1.0' } } });
  json('versions.json', { '0.1.0': '1.8.7' });
  fixture.files.set('CHANGELOG.md', '## 0.1.0\n\n- Initial release.\n');
  fixture.tree = [...fixture.files.keys()].filter(file => file !== 'main.js');
  fixture.head = fixture.tag = '1'.repeat(40);
  fixture.trackedDocs = '';
});
afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
});

describe('release validation', () => {
  it('accepts complete installation files built from the exact version tag', async () => {
    await expect(check()).resolves.toBeDefined();
  });
  it.each(['v0.1.0', '0.2.0'])('rejects a mismatched tag %s', async version => {
    process.argv[3] = version;
    await expect(check()).rejects.toThrow('Requested version must match the manifest');
  });
  it('rejects a build from a different commit', async () => {
    fixture.head = '2'.repeat(40);
    await expect(check()).rejects.toThrow('Release must build the exact tagged commit');
  });
  it.each(['package.json', 'package-lock.json'])('rejects a stale version in %s', async file => {
    json(file, { version: '0.0.9' });
    await expect(check()).rejects.toThrow(/version must match the manifest/);
  });
  it('rejects a stale root package version in the lockfile', async () => {
    json('package-lock.json', { version: '0.1.0', packages: { '': { version: '0.0.9' } } });
    await expect(check()).rejects.toThrow('Lockfile root package must match the manifest');
  });
  it('rejects a missing required stylesheet', async () => {
    fixture.files.delete('styles.css');
    await expect(check()).rejects.toThrow('Missing file: styles.css');
  });
  it('rejects publication without changelog content for the current version', async () => {
    fixture.files.set('CHANGELOG.md', '## 0.0.9\n\n- Older release.\n');
    await expect(check()).rejects.toThrow('exactly one section for 0.1.0');
  });
  it('rejects local development documents in a release tag', async () => {
    fixture.tree.push('docs/DEVELOPMENT.md');
    await expect(check()).rejects.toThrow('Local documentation must never enter a release tag');
  });
  it('rejects tracked local development documents', async () => {
    fixture.trackedDocs = 'docs/PRODUCT.md\n';
    await expect(check()).rejects.toThrow('docs/ must remain untracked');
  });
  it('rejects a screenshot missing from the tagged source archive', async () => {
    fixture.files.set('README.md', '![Toolbar](assets/toolbar.png)');
    fixture.files.set('assets/toolbar.png', 'Synthetic image.');
    await expect(check()).rejects.toThrow('Missing from release tag: assets/toolbar.png');
  });
});
