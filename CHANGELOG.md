# Changelog

Notable changes to Hover Bar, grouped by release.

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
