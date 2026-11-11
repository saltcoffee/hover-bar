# Changelog

Notable changes to Hover Bar, grouped by release.

## 0.1.6 — 2026-11-11

### Added

- Multi-line formatting for a continuous selection of ordinary paragraph lines and blank lines, applying bold, italic, strikethrough, or highlight to each non-empty segment in one undoable transaction.
- Three-state toolbar feedback for multi-line selections: all lines, none, or only some lines carry the format, exposed with `aria-pressed="mixed"`.

### Changed

- Apply multi-line changes all-or-nothing: any unsupported segment rejects the whole operation before writing, and the updated selection is mapped back over the formatted content.
- Multi-line selections accept only ordinary paragraph text; headings, lists, tasks, quotes, tables, code, math, YAML, links, inline HTML, colors, and mixed formatting are rejected with an explicit reason.
- Colors, inline code, and internal links are disabled for multi-line selections and explain why; single-line behavior is unchanged.
- Add clearer rejection messages for too many lines, structural lines, and unsafe multi-line content.
- Use a bounded syntax lookahead for long selections and compute multi-line mark availability without rebuilding a full plan, keeping large selections responsive.

### Fixed

- Keep the toolbar open after a multi-line apply by mapping the selection to whole formatted segments, so a second click can remove the format.
- Anchor the toolbar on the visible endpoint of a long multi-line selection instead of letting it disappear when the selection extends beyond the viewport.
- Keep single-line selection on the visible text after applying a mark, and announce the partial multi-line state in the button label.

## 0.1.5 — 2026-11-03

### Added

- Custom text and background colors with strict HEX input, a panel preview, and an explicit Apply action in English and Simplified Chinese.
- Separate per-vault lists of the last five successfully applied text and background colors, with clear, retry, and reload controls.
- Live Preview decorations for any supported canonical HEX color, preserving existing Markdown and single-span color output.

### Changed

- Migrate plugin data to schema 3 on the next explicit change or successful color use, preserving switches and toolbar layouts. Older plugin versions reject schema 3; keep a pre-upgrade plugin-data backup if downgrading.
- Keep recent-color persistence, failures, and history-only conflicts independent of editor sessions and note undo history.
- Preserve colors successfully applied while recent history reloads, including reuse of an unchanged history head, and save the latest combined result.
- Support keyboard navigation between recent colors, presets, HEX input, Apply, and color removal, with composition-aware confirmation.
- Hand focus to a connected control before an external history update removes the active swatch, while preserving retained swatches, HEX drafts, and caret positions.

### Fixed

- Keep the HEX input's composition-confirming Enter blocked through key repeats until key release.
- Scroll the color panel body after layout so its initially focused swatch remains visible in short panes.
- Update an existing recent-color notice when a save failure becomes an external conflict, preserving English and Chinese messages and dismissal state.
- Describe repaired recent-color history accurately when valid colors are retained, and label failed preference-load actions as Retry in English and Simplified Chinese.

## 0.1.4 — 2026-10-30

### Added

- Per-vault toolbar layouts with pin, unpin, move up, move down, and restore-default controls that work with the keyboard.
- A unified More panel for unpinned actions and actions that do not fit the current editor pane, including colors and note selection.
- Visible Back controls and staged Escape navigation from More to color palettes and note search.

### Changed

- Allocate toolbar actions using the available pane width; the default layout prioritizes strikethrough and active basic formats, while custom layouts follow the configured order.
- Adapt color palettes from four columns to one while preserving usable targets, focus, and keyboard navigation.
- Migrate existing preferences to schema 2 on the next explicit change or restore, preserving all four switches and the default layout.

### Fixed

- Keep preference-save status changes from closing an active toolbar, and refresh settings controls after external reloads without overwriting the loaded order.
- Persist explicit restores even when invalid preferences have already recovered to the same default values in memory.
- Stop queued writes after external conflicts, preserve the latest snapshot on retry, and prevent stale save or load completions from replacing newer state.
- Close formatting panels only after a successful edit or valid no-op, and hand focus to a current control before removing its old location.
- Handle Escape in the toolbar's host keyboard scope so Obsidian does not steal focus during staged panel returns.

## 0.1.3 — 2026-10-28

### Added

- Actionable selection diagnostics for editor availability, editing preferences, read-only state, text composition, multiple selections, line breaks, protected syntax, and length limits.
- Consistent action availability across the toolbar, palettes, and menus, with keyboard access to unavailable actions and their explanations.

### Changed

- Restrict Hover Bar to desktop Obsidian and remove touch selection, the mobile bottom toolbar, and on-screen keyboard layout support.
- Update English and Chinese usage guides and preference text for desktop use.

### Fixed

- Reject formatting and links before writing when the resulting full line would exceed the source limit.
- Apply the same length checks to quick-link availability and execution.
- Distinguish link output length limits from invalid link text, targets, and formatting conflicts.
- Ignore measurements and note queries from closed sessions without consuming a newer session's focus request.
- Return focus after Escape and successful links without requiring the closed selection to remain editable.
- Preserve text composition in note search, including confirmation keys delivered after composition ends, so they cannot prematurely insert a link.
- Upgrade the Obsidian development SDK's transitive Moment dependency to 2.31.0 to fix CVE-2026-17495.

## 0.1.2 — 2026-10-26

### Added

- Mobile support with automatic touch selection, a swipeable bottom toolbar, 44-pixel touch targets, and a close button.
- Scrollable color and note panels that adapt to the on-screen keyboard and visual viewport.

### Changed

- Allow installation on iOS and Android alongside desktop Obsidian.
- Update English and Chinese usage guides and automatic-toolbar preference text for touch screens.

### Fixed

- Keep the toolbar open when switching from note search to colors or more formatting on touch screens.
- Preserve the native copy/paste menu in note search without closing the picker.

## 0.1.1 — 2026-10-26

### Changed

- Lower the minimum supported desktop Obsidian version to 1.8.7 after host compatibility validation.
- Use each version's changelog section for GitHub release notes.

### Fixed

- Keep the note picker focused when clicking a result so the selected link is inserted before the picker closes.

## 0.1.0 — 2026-10-24

### Added

- Selection toolbar with bold, italic, strikethrough, inline code, and standard highlights.
- A strikethrough button that stays on the main toolbar, including in narrow panes.
- Text and background palettes with reversible, non-nested HTML spans and Live Preview colors.
- Quick wikilinks and an existing-note picker with stale-selection protection.
- Per-vault preferences, keyboard navigation, and native undo integration.
- Chinese UI for Chinese app languages and English fallback for every other language.
- Content-preservation, localization, settings, placement, and editor transaction tests.
- GitHub CI and automatic release builds when a matching version tag is pushed.
- English and Simplified Chinese usage and installation guides.
- MIT license, contribution and security guidance, and GitHub issue / pull request templates.
- Git ignore, editor formatting, and line-ending configuration.

### Fixed

- Separate full-width menu rows for more formatting and color reset actions.
- Duplicate hover hints by using Obsidian's native tooltips without browser title tooltips.
- Escaped closing markers remain literal text during formatting instead of being stripped as emphasis.
- Manual toolbar focus survives coalesced resize and automatic display measurements.
- Toolbars and panels avoid the full visible height of wrapped selections.
- Disabled inline-code actions explain formatting conflicts separately from length limits.
