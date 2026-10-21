---
description: "dsh Web 客户端右侧 Sidebar 的文件树 tab 类型：通过网络逐层列出会话工作区根目录，按资源地址把文件打开到 Sidebar。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-files

[English](README.md) | 中文

## 概述

浏览 Session 的工作区目录树，并在 Sidebar 预览中打开文件。根目录与已展开目录通过直接子项监听自动刷新，手动重新读取仍可用。该 tab 从引导页进入，不认领资源地址。

## 目录

- [注册了什么](#what-it-registers)
- [树](#the-tree)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="what-it-registers"></a>
## 注册了什么

命令 `workspace.files` 聚焦当前会话某个停靠分栏里已有的文件页，优先焦点分栏；没有停靠分栏持有文件页时在焦点分栏内打开，从聊天区触发时该分栏是当前会话的活动停靠分栏。文件页替换开始页。因此只要有停靠分栏持有文件页，该命令就不会再新开；开始页自己的文件入口仍在开始页所在分栏打开文件页。桌面默认键为 Mod+P。开始页入口显示有效快捷键；Windows 和 macOS Web 使用[快捷键服务的平台默认值](../shortcuts/README.zh.md)；Linux Web 默认不绑定此命令。

- **类型**：`ctx.sidebarRightTabs.register(...)`，kind 为 `files`，id 为 `@deepseek-ai/dsh-client-ui-sidebar-files`，档位 `builtin`，没有 patterns，另有一个打开该类型的引导页入口（order 10，标题与描述取自 `sidebarFiles` 命名空间，图标为黄色文件夹）。
- **正文**：以该 id 为键的 `sidebar.right.pane.tab` slot：strip 下的一行标题行，然后是树。共享的 [`PathLabel`](../ui-primitives/README.zh.md#component-catalog) 显示根路径，目录使用弱化颜色，最后一段使用主色。路径过长时保留尾部字符并在左侧渐隐；悬停显示完整路径。重新读取控件和 Session 作用域的 `sidebar.right.tab.files.actions` 列表位于右端，并通过 `absolutePath` 传入当前显示的根目录；[`ui-open-in-app`](../ui-open-in-app/README.zh.md) 在此提供工作区目录打开按钮。
- **标签页标题**：以该 id 为键的 `sidebar.right.pane.tab.title` slot：类型标签前的一枚 16px 共享 `FileTypeIcon` 文件夹图标。树本身的行不画这枚图标。

`src/client/` 下的源文件：`definition.tsx`（类型是什么）、`store.ts`（它保存什么）、`face.ts`（Remote 读取、监听与条目新建）、`directory-node.ts`（打开的目录及其生命周期）、`FilesBody.tsx`（它画什么、右键菜单与命名行，含排序与失败行辅助函数）、`FilesTitle.tsx`（标签页标题）、`locales.ts`（它说什么）、`index.ts`（接线）。

<a id="the-tree"></a>
## 树

根是会话的工作目录，读自 `useSessions().byId[sessionId].cwd`。`/` 和 Windows 盘根等文件系统根路径均可作为树的根。每一层以绝对路径为键；子路径是父路径以 `/` 拼上条目名。一层在首次展开时经 `@deepseek-ai/dsh-api-workspace-files` 命名空间的 `remote.workspaceFiles.list(sessionId, absolutePath)` 列出；适配器保留列表的条目与截断标志，丢弃其工作区相对路径。行序为目录优先，其后按自然序、不分大小写的名称排列；dotfiles 与其他条目一样显示。

| 条目类型 | 行 |
|---|---|
| `directory` | 切换展开与折叠；再次打开时重新列举，并恢复仍存在的已展开后代。折叠期间保留已显示条目的缓存。 |
| `file` | 经 `useTabInfo().tab.actions.openResource` 打开 `dsh-resource://file/session/<sessionId>/<encoded path relative to the root>`，地址由 `@deepseek-ai/dsh-util-workspace-path` 的 `fileAddressFor` 从条目的绝对路径与树的根生成，并带 `preferOtherPane: true`：预览落在另一个停靠 pane 里，没有时落在从文件树 pane 分出的新 pane 里；文件树 pane 是唯一的停靠 pane 且无法分栏时，预览是文件树旁的一个 tab。文件树处于浮动面板时按不带该选项处理，预览落在活动停靠 pane。 |
| `other` | 灰显且不可点击，从而完整呈现目录内容。 |

被端点条目上限截断的层以一条标记收尾；空层如实说明；失败的层按错误码各显示一行（`workspace-file/not-found`、`outside-workspace`、`not-directory`），其他情况显示传输层自己的消息。重新读取就地刷新根与展开中的层，读取期间保留显示条目，不重置整棵树；折叠的层在下次打开时重新拉取。没有工作目录的会话只显示一行说明，而不是树。

右键打开上下文菜单。`directory` 行依次提供「新建文件」「新建文件夹」「加入当前会话」；`file` 行提供「加入当前会话」；`other` 行没有菜单；不在任何行上的正文空白处提供「新建文件」「新建文件夹」，目标是树的根。「加入当前会话」通过 Conversation 包的 `addToConversation` 动词把该行作为引用插入。

选择新建项时，先展开尚未展开的目录，再在该目录这一层的顶部打开一个命名行并聚焦；一个 tab 最多只有一个命名行。回车提交，Esc 或失焦关闭命名行且不创建任何东西。face 对空名字、只含空白的名字、`.`、`..` 以及含有 `/`、`\` 或 NUL 的名字直接拒绝，不发请求；否则调用 `remote.workspaceFiles.create(sessionId, parentPath, name, type)`，调用结算前命名行不接受输入。成功后命名行关闭，face 重新列举该层，所以在不支持监听的提供方上新条目也会出现；新建的文件不会被打开。失败时命名行保留以便改名，并显示一行说明：`workspace-file/already-exists`、`invalid-name`、父目录不在了（`not-found` 或 `not-directory`），其他情况显示失败自己的消息。

状态保存在类型自己的存储里，按 tab id 分桶：`root`、`levels`（每个绝对路径的 loading / ready / failed）、`expanded`、`autoRefresh`、`draft`（打开的命名行：所在目录、类型、提交中标记与上次失败）与 `scrollTop`——滚动期间偏移由正文自己记录，卸载时一次性写入。折叠命名行所在的目录，或该目录从列举中消失，都会关闭命名行。存储比 body 活得久，切到其他侧栏 tab 再切回来时树带着已加载的层重新挂载，滚动位置也随之恢复。owner 的 `signal` 终结一个桶：中止时忘掉该 tab，其后才结算的列表、新建与卸载时的偏移提交都什么也不写。命名行被关闭或替换之后才结算的新建不改动当前的命名行。

每个打开的 `DirectoryNode` 在 Tab 生命周期内持有自己的目标监听；折叠关闭该节点及其不可见后代。祖先恢复期间的展开状态变化会更新存储和待恢复节点，后代恢复时遵循最新展开偏好。自动刷新默认开启；独立开关暂时隐藏，状态、文案、样式与切换逻辑保留。目录读取期间或收尾时收到的变化仍会留待下一次刷新。

<a id="model-experience"></a>
## 模型体验

无，因为本包在浏览器里绘制工作区文件树，不注册任何面向模型的内容。

#### KV Cache 影响

无；目录列表经 Remote 传输，不会组装模型请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>
- **文件管理只有新建。**没有搜索、产物过滤、拖拽、重命名、删除、移动或当前文件高亮。新建的条目是空的，只能是单个路径段；名字被占用时拒绝，不自动加序号。
- **只有一个根。**树以会话工作目录为根；没有办法浏览到它之上，而 Host 本来也拒绝工作区根之外的路径。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

页面刷新快捷键通过常规目录读取器刷新聚焦的文件树。重新读取控件在悬停和键盘聚焦时显示有效绑定。

</details>

**运行时不变量：** 不发布 companion。tab 持有的 face 内部管理目录读取、监听与条目新建，并通过 Slot store 写入显示状态；tab 取消时释放二者。本包未暴露可用于运行时比对的独立观测源。
