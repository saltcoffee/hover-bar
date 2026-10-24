# Hover Bar

A lightweight, offline selection toolbar for formatting text in Obsidian without leaving your mouse or trackpad.

[简体中文](README.zh-CN.md)

## What it is for

Select a phrase, make it bold, highlight an idea, give a term a color, or turn it into an internal link. Keep these small editing tasks close to the text you are working on.

The toolbar appears when you finish selecting text. Ordinary formatting stays in Markdown; custom text and background colors use small inline HTML spans.

![Hover Bar above selected text in Obsidian](assets/demos/toolbar.png)

## Features

- A compact floating toolbar near your selection, with viewport-aware placement.
- Bold, italic, strikethrough, inline code, and standard Obsidian highlights.
- Named text and background color palettes, with controls to remove colors.
- Quick `[[internal links]]` and a picker for existing notes.
- Undo and redo through the editor's normal history.
- Light and dark theme support and keyboard navigation.
- Chinese text when Obsidian uses a Chinese language setting; English for every other language.
- Controls to disable automatic display while keeping a command to open the toolbar.

## How to use

1. Open a Markdown note in Live Preview or Source mode.
2. Select a plain-text phrase using your mouse or trackpad.
3. Click a formatting button, or open a color palette and choose a color.

Click outside the toolbar or press Esc to close it. For keyboard access, use **Show selection toolbar** in the command palette. You can assign your own hotkey in Obsidian's hotkey settings.

| Action | Example saved in your note |
| --- | --- |
| Bold | `**Important**` |
| Strikethrough | `~~Outdated~~` |
| Highlight | `==Remember this==` |
| Text color | `<span style="color:#e05252">Important</span>` |
| Background color | `<span style="background-color:#fff3a3">Remember this</span>` |
| Internal link | `[[Concept]]` |

## Compatibility and limitations

Requires desktop Obsidian **1.14.4 or later**, in Live Preview or Source mode. Reading view and mobile selection menus are not supported.

Use a single text fragment within one logical line, including text in a heading, list item, or blockquote. Keep structural markers outside your selection. Complex mixed formatting, partial HTML spans, multiple selections, tables, code blocks, math, and frontmatter will not be rewritten. Unsupported actions explain their limitation.

Custom colors are saved as inline HTML. They remain in the note after disabling the plugin, but their appearance depends on the renderer and theme. Export tools may strip styles. Source mode shows the underlying markup, and Live Preview may reveal it while editing. The internal-link action intentionally writes wikilinks.

## Installation

Hover Bar is not listed in the community directory yet. Install the packaged plugin from [GitHub Releases](https://github.com/saltcoffee/hover-bar/releases/latest):

1. Download `main.js`, `manifest.json`, and `styles.css` from the release assets.
2. Create a `hover-bar` folder inside your vault's `.obsidian/plugins/` folder and copy the three files into it.
3. Restart Obsidian and enable **Hover Bar** in **Settings → Community plugins**.

When Hover Bar is available in the community directory:

1. Open **Settings → Community plugins** in Obsidian.
2. Select **Browse** and search for **Hover Bar**.
3. Select **Install**, then **Enable**.

## Preferences and keyboard access

Open **Settings → Hover Bar** to control automatic display, Live Preview, Source mode, and automatic display after keyboard selection.

Use **Hover Bar: Show selection toolbar** in the command palette to open the toolbar manually. **Hover Bar: Toggle automatic toolbar** turns mouse-triggered display on or off. Assign shortcuts in **Settings → Hotkeys** if you prefer; no default shortcuts are added.

The interface follows Obsidian's language setting: Chinese app languages use Simplified Chinese text, and every other language uses English. No separate language preference is needed.

## Privacy

Hover Bar works entirely offline, with no accounts, runtime network requests, telemetry, or access to files outside the vault. Its note picker uses vault file metadata, and formatting changes only the selection you explicitly act on.

## Feedback and contributions

Ideas and reproducible issues are welcome in [GitHub Issues](https://github.com/saltcoffee/hover-bar/issues). Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing an implementation, and [SECURITY.md](SECURITY.md) for sensitive reports.

## Support development

Hover Bar is a free plugin. If you would like to support its continued development and maintenance, voluntary donations are welcome. Thank you for your support.

| <img src="assets/icons/wechat.svg" alt="WeChat Pay" title="WeChat Pay" width="32" height="32"> | <img src="assets/icons/alipay.svg" alt="Alipay" title="Alipay" width="32" height="32"> |
| :---: | :---: |
| <a href="assets/donations/wechat-pay.jpg"><img src="assets/donations/wechat-pay.jpg" alt="WeChat Pay donation QR code" width="240"></a> | <a href="assets/donations/alipay.jpg"><img src="assets/donations/alipay.jpg" alt="Alipay donation QR code" width="240"></a> |

## License

[MIT](LICENSE) © 2026 gua.
