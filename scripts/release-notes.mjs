import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function extractReleaseNotes(changelog, version) {
  assert.match(version, /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/, 'Release version must use x.y.z without a prefix');
  const lines = changelog.replace(/\r\n?/g, '\n').split('\n');
  const headings = [];
  let fence = null;
  for (const [index, line] of lines.entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (fence) continue;
    const heading = /^##[ \t]+(.+?)\s*$/.exec(line);
    if (heading) headings.push({ index, title: heading[1] });
  }
  const literal = version.replace(/\./g, '\\.');
  const title = new RegExp(`^(?:${literal}|\\[${literal}\\])(?:\\s|$)`);
  const matches = headings.filter(heading => title.test(heading.title));
  assert.equal(matches.length, 1, `CHANGELOG.md must contain exactly one section for ${version}`);
  const start = matches[0];
  const end = headings.find(heading => heading.index > start.index)?.index ?? lines.length;
  const notes = lines.slice(start.index + 1, end).join('\n').trim();
  assert.ok(notes.replace(/<!--[\s\S]*?-->/g, '').trim(), `Release notes for ${version} must not be empty`);
  return `${notes}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [version, output] = process.argv.slice(2);
  assert.ok(output, 'Usage: node scripts/release-notes.mjs <version> <output-file>');
  const notes = extractReleaseNotes(await readFile('CHANGELOG.md', 'utf8'), version);
  await writeFile(output, notes);
}
