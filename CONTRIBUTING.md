# Contributing to Hover Bar

Thank you for helping improve selection-based editing in Obsidian. English and Simplified Chinese reports are both welcome.

## Development setup

Use Node.js 24, run `npm ci`, then `npm run dev` for a watch build. Start with the [README](README.md) for the user-facing scope. Use a separate test vault and copy `main.js`, `manifest.json`, and `styles.css` into its `plugins/hover-bar/` configuration folder. Please describe the user problem in an issue before proposing changes that expand the scope.

For a production build, run `npm ci` followed by `npm run build`. These developer instructions belong here; the README is written for users installing from Obsidian's community directory.

## Report a problem

Include the Obsidian and plugin versions, OS, editing mode, theme, a small synthetic Markdown example, reproduction steps, and expected versus actual results. Explain whether the problem reproduces with other community plugins disabled. Never attach private notes, vaults, credentials, or unredacted logs.

For a feature request, describe the task you are trying to complete, the current workaround, and the expected result. Include redacted screenshots when they clarify the issue, and label mockups clearly.

Use the process in [SECURITY.md](SECURITY.md) for sensitive reports.

## Implementation conventions

- Keep each change focused on an agreed user behavior.
- Use strict TypeScript and public Obsidian / CodeMirror APIs.
- Keep formatting logic independent of UI, editor instances, and persistence.
- Preserve text, selection direction, undo history, and document identity.
- Keep Hover Bar lightweight and offline. AI features, online services, user accounts, and sync are outside the long-term product scope; do not add dependencies or extension points for them.
- Do not add network access, telemetry, private APIs, or speculative extension frameworks.
- Keep files below 600 lines and separate responsibilities when approaching that limit.
- Add meaningful tests for content conversion, stale selections, and other correctness risks.
- Include English and Simplified Chinese UI strings, accessible names, and failure feedback.
- Do not commit generated bundles, local vaults, secrets, or plugin state.
- Check third-party licenses before adding dependencies, code, or artwork.

## Validation and pull requests

Run `npm run check` before submitting a code change. It runs type checking, lint, the content-preservation and transaction tests, a production build, and release validation. Documentation-only changes need link and content checks. Report only checks actually performed.

For editor changes, report the exact Obsidian version, OS, editing mode, and manual scenarios tested. Use a separate vault with synthetic notes. Automated tests cannot replace host integration checks.

Use a descriptive branch name such as `feat/selection-toolbar` or `docs/color-behavior`; do not use a `codex` prefix. Use [Conventional Commits](https://www.conventionalcommits.org/) when submitting your own commits, for example `docs: define selection toolbar behavior`.

Changes to `main` must go through a pull request, including changes by maintainers. Do not push directly to `main`.

Pull requests should explain the user-visible problem, resulting behavior, verification, and remaining limits. Update usage documentation when behavior changes. The maintainer controls commits to the main branch, version tags, and marketplace submission; automation must not commit or push without explicit authorization.

## Releases

Update `manifest.json`, `package.json`, and both root version fields in `package-lock.json` to the same version. Add the corresponding minimum Obsidian version to `versions.json`. Write the release descriptions directly under a matching `## x.y.z` section in `CHANGELOG.md`, using `###` for subsections. Each version must have one non-empty section. Run `npm run check` before tagging the committed release.

Pushing a version tag such as `0.1.0` to GitHub triggers the release workflow. Use the exact `manifest.json` version without a `v` prefix. The tagged commit must contain the workflow and all release sources; creating a local tag alone does not trigger GitHub Actions.

The workflow installs locked dependencies, runs all checks, builds the tagged code, validates version alignment, and publishes a GitHub Release with `main.js`, `manifest.json`, and `styles.css` attached separately. Its description contains the matching CHANGELOG section, without an automatically generated compare or commit-history link. GitHub supplies the additional source ZIP and tar.gz downloads. The workflow does not create commits or push tags. A failed check prevents publication, and existing releases are not overwritten.

Contributions are licensed under the repository's [MIT license](LICENSE). Do not include material you do not have permission to contribute.
