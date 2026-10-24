# Hover Bar

轻量、离线的 Obsidian 选区排版插件。划选文字后，就近完成排版、文字着色、背景着色和双链操作，让鼠标与触控板编辑更顺手。

[English](README.md)

## 如何使用

阅读笔记时标记重点，整理摘录时调整层次，或把一句话中的概念连接到已有笔记。选中文字后，工具条在附近出现，常用排版可以直接点击完成。

常规格式优先使用 Markdown；选择自定义文字色或背景色时，自动写入简洁的行内 HTML，无需手写颜色标签。

![Obsidian 中选中文字上方的 Hover Bar 工具条](assets/demos/toolbar.png)

## 功能

- 完成选区后弹出紧凑胶囊工具条，靠近文字并避开窗格边界。
- 加粗、斜体、删除线、行内代码和 Obsidian 标准高亮。
- 带名称的文字色与背景色色板，可分别移除颜色。
- 一键生成 `[[双链]]`，也可搜索并关联已有笔记。
- 使用编辑器原生撤销和重做，连续改色不叠套标签。
- 适配明暗主题，支持键盘操作。
- Obsidian 设置为中文时显示中文，其他任何语言均显示英文。
- 可关闭自动弹出，保留命令面板手动呼出入口。

## 使用方法

1. 在实时预览或源码模式中打开 Markdown 笔记。
2. 用鼠标或触控板选中一段普通文字。
3. 点击格式按钮，或打开色板选择颜色。

点击外部或按 Esc 关闭。键盘用户可通过命令面板中的「显示选区工具条」打开工具条，也可在 Obsidian 的快捷键设置中自行绑定快捷键。

| 操作 | 笔记中保存的内容示例 |
| --- | --- |
| 加粗 | `**重点**` |
| 删除线 | `~~过时内容~~` |
| 标准高亮 | `==重点==` |
| 文字颜色 | `<span style="color:#e05252">重点</span>` |
| 背景颜色 | `<span style="background-color:#fff3a3">重点</span>` |
| 内部链接 | `[[概念]]` |

## 兼容性与限制

需要桌面端 Obsidian **1.14.4 或更高版本**，支持实时预览和源码模式。阅读视图与移动端触摸选区不提供工具条。

格式操作支持同一逻辑行中的单一文本片段，包括标题、列表项和引用中的文字；请选择文字内容，不包含结构标记。复杂混合格式、部分 HTML 标签跨度、多选区、表格、代码块、数学公式和 YAML 不直接改写；不可用动作会说明原因。

颜色以行内 HTML 保存在笔记中。关闭插件不会移除内容，显示效果取决于主题与渲染器，部分导出工具可能移除样式。源码模式会显示标记，实时预览在编辑时也可能露出源码；双链按钮明确输出 wikilink。

## 安装

Hover Bar 目前尚未上架社区插件市场，可从 [GitHub Releases](https://github.com/saltcoffee/hover-bar/releases/latest) 安装已打包的插件：

1. 在版本附件中下载 `main.js`、`manifest.json` 和 `styles.css`。
2. 在 vault 的 `.obsidian/plugins/` 目录下新建 `hover-bar` 文件夹，将这三个文件放入其中。
3. 重启 Obsidian，在「设置 → 第三方插件」中启用 **Hover Bar**。

上架社区插件市场后，可直接在 Obsidian 内安装：

1. 打开 Obsidian「设置 → 第三方插件」。
2. 点击「浏览」，搜索 **Hover Bar**。
3. 点击「安装」，然后「启用」。

## 设置与键盘操作

在「设置 → Hover Bar」中，可以控制自动显示、实时预览、源码模式，以及键盘选择后是否自动显示。

通过命令面板中的「Hover Bar：显示选区工具条」手动打开工具条；「Hover Bar：切换自动显示工具条」用于开启或关闭鼠标划选后的自动显示。需要快捷键时，可在「设置 → 快捷键」自行绑定，插件不添加默认快捷键。

界面跟随 Obsidian 的语言设置：中文及中文变体显示简体中文文案，其他任何语言显示英文，无需单独设置语言。

## 隐私

插件完全离线，无账户、无运行时网络请求、无遥测、不访问 vault 之外的文件。笔记选择器仅使用 vault 文件元数据，排版仅修改用户明确操作的选区。

## 反馈与参与

欢迎通过 [GitHub Issues](https://github.com/saltcoffee/hover-bar/issues) 提交使用场景和可复现问题。参与实现前请阅读 [贡献指南](CONTRIBUTING.md)，敏感问题参见 [安全说明](SECURITY.md)。

## 支持开发

Hover Bar为免费插件，如果你愿意支持 Hover Bar 的开发，欢迎自愿打赏，支持后续开发与维护，谢谢。

| <img src="assets/icons/wechat.svg" alt="微信支付" title="微信支付" width="32" height="32"> | <img src="assets/icons/alipay.svg" alt="支付宝" title="支付宝" width="32" height="32"> |
| :---: | :---: |
| <a href="assets/donations/wechat-pay.jpg"><img src="assets/donations/wechat-pay.jpg" alt="微信支付打赏二维码" width="240"></a> | <a href="assets/donations/alipay.jpg"><img src="assets/donations/alipay.jpg" alt="支付宝打赏二维码" width="240"></a> |

## 许可

[MIT](LICENSE) © 2026 gua
