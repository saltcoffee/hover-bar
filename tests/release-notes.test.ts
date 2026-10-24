import { describe, expect, it } from 'vitest';

const script = '../scripts/release-notes.mjs';
const { extractReleaseNotes } = await import(script);

describe('release changelog content', () => {
  it('uses only the matching version content, including Added and Fixed subsections', () => {
    const source = '# Changelog\n\n## Unreleased\n\n- Future work.\n\n## 0.2.0 — 2026-10-25\n\n### Added\n\n- New action.\n\n### Fixed\n\n- Keep selection.\n\n## 0.1.0 — 2026-10-24\n\n- Initial release.\n';
    expect(extractReleaseNotes(source, '0.2.0')).toBe('### Added\n\n- New action.\n\n### Fixed\n\n- Keep selection.\n');
  });
  it('accepts bracketed version headings and Windows line endings', () => {
    expect(extractReleaseNotes('## [0.1.0] - 2026-10-24\r\n\r\n- Initial release.\r\n', '0.1.0')).toBe('- Initial release.\n');
  });
  it.each(['0.1.00', '0.1.0-preview', '0.1.1'])('does not mistake %s for the requested version', heading => {
    expect(() => extractReleaseNotes(`## ${heading}\n\n- Other release.\n`, '0.1.0')).toThrow('exactly one section');
  });
  it('ignores apparent version headings inside fenced code blocks', () => {
    const source = '## 0.1.0\n\n- Example:\n\n```markdown\n## 0.1.0\n## 0.0.9\n```\n\n- Actual change.\n\n## 0.0.9\n\n- Older change.\n';
    expect(extractReleaseNotes(source, '0.1.0')).toBe('- Example:\n\n```markdown\n## 0.1.0\n## 0.0.9\n```\n\n- Actual change.\n');
  });
  it('rejects duplicate matching sections', () => {
    expect(() => extractReleaseNotes('## 0.1.0\n\n- First.\n\n## [0.1.0]\n\n- Duplicate.\n', '0.1.0')).toThrow('exactly one section');
  });
  it.each(['', '<!-- Add release descriptions here. -->'])('rejects empty release content: %s', body => {
    expect(() => extractReleaseNotes(`## 0.1.0\n\n${body}\n\n## 0.0.9\n\n- Older change.\n`, '0.1.0')).toThrow('must not be empty');
  });
  it('rejects prefixed tag versions', () => {
    expect(() => extractReleaseNotes('## 0.1.0\n\n- Initial release.\n', 'v0.1.0')).toThrow('without a prefix');
  });
});
