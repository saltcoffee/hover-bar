import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { extractReleaseNotes } from './release-notes.mjs';

const readJSON = async file => JSON.parse(await readFile(file, 'utf8'));
const manifest = await readJSON('manifest.json');
const pkg = await readJSON('package.json');
const lock = await readJSON('package-lock.json');
const versions = await readJSON('versions.json');
assert.match(manifest.version, /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/);
assert.equal(pkg.version, manifest.version, 'Package version must match the manifest');
assert.equal(lock.version, manifest.version, 'Lockfile version must match the manifest');
assert.equal(lock.packages?.['']?.version, manifest.version, 'Lockfile root package must match the manifest');
assert.equal(versions[manifest.version], manifest.minAppVersion);
assert.equal(manifest.id, 'hover-bar');
assert.equal(manifest.isDesktopOnly, true, 'Hover Bar must remain desktop-only');
assert.ok(manifest.description.length <= 250 && manifest.description.endsWith('.'));
extractReleaseNotes(await readFile('CHANGELOG.md', 'utf8'), manifest.version);
const requested = process.argv.indexOf('--version');
let tree;
if (requested !== -1) {
  const version = process.argv[requested + 1];
  assert.equal(version, manifest.version, 'Requested version must match the manifest');
  const revision = ref => execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8' }).trim();
  assert.equal(revision('HEAD'), revision(`refs/tags/${version}`), 'Release must build the exact tagged commit');
  tree = new Set(execFileSync('git', ['ls-tree', '-r', '--name-only', `refs/tags/${version}`], { encoding: 'utf8' }).trim().split('\n'));
  assert.ok(![...tree].some(file => file.startsWith('docs/')), 'Local documentation must never enter a release tag');
}
const trackedDocs = execFileSync('git', ['ls-files', '--', 'docs/'], { encoding: 'utf8' });
assert.equal(trackedDocs.trim(), '', 'docs/ must remain untracked');
for (const file of ['main.js', 'manifest.json', 'styles.css', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'README.zh-CN.md', 'CONTRIBUTING.md']) {
  assert.ok((await readFile(file)).length > 0, `${file} is empty`);
}
for (const file of ['README.md', 'README.zh-CN.md', 'CONTRIBUTING.md']) {
  const source = await readFile(file, 'utf8');
  const targets = [...source.matchAll(/\[[^\]]*\]\(([^)]+)\)|(?:src|href)="([^"]+)"/g)].map(match => match[1] ?? match[2]);
  for (const target of targets) {
    if (/^(?:https?:|#|mailto:)/.test(target)) continue;
    const local = path.posix.normalize(path.posix.join(path.posix.dirname(file), target.split('#')[0]));
    assert.ok(!path.posix.isAbsolute(local) && !local.startsWith('../'), `Reference outside repository: ${local}`);
    assert.ok(!local.startsWith('docs/'), `Public reference to local documentation: ${local}`);
    await readFile(local);
    if (tree) assert.ok(tree.has(local), `Missing from release tag: ${local}`);
  }
}
async function checkLengths(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await checkLengths(file);
    else if (file.endsWith('.ts')) assert.ok((await readFile(file, 'utf8')).split('\n').length <= 600, `${file} exceeds 600 lines`);
  }
}
await checkLengths('src');
console.log(`Release checks passed: Hover Bar ${manifest.version}, Obsidian ${manifest.minAppVersion}+`);
