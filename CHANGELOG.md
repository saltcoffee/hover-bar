# Changelog

Notable changes to Hover Bar, grouped by release.

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
