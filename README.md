# vscode宠物：工位搭子 / code-mate

<p align="center">
  <img src="./media/docs/readme-banner.gif" alt="vscode宠物：工位搭子 README Banner" width="100%" />
</p>

<p align="center">
  <img alt="VS Code Extension" src="https://img.shields.io/badge/VS%20Code-Extension-7AA8FF?style=for-the-badge">
  <img alt="Version" src="https://img.shields.io/badge/Version-1.0.0-B7F0D8?style=for-the-badge">
  <img alt="Pet System" src="https://img.shields.io/badge/4%20Lineages-3%20Growth%20Stages-FFCADC?style=for-the-badge">
  <img alt="Project Save" src="https://img.shields.io/badge/.vscode%2Feden.json-Project%20Save-FFD9B2?style=for-the-badge">
</p>

> 一个放进 VS Code 里的像素宠物插件。
> 它会跟着你的项目特征成长、反应和安家，在不打扰编码的前提下，给日常开发增加一点陪伴感。

## 功能亮点

- **项目感知宠物**：根据工程代码特征，在 `Primitives`、`Concurrency`、`Protocols`、`Chaos` 四个族群中自动判定宠物出身。
- **三阶段成长**：从初生期到成熟期，体型、动作节奏、反馈强度和家具联动都会逐步增强。
- **持续生命感动作**：宠物不会静止发呆，会持续表现呼吸感、轻微摆动、视线漂移和更自然的情绪惯性。
- **底部乐园主舞台**：在底部面板里直接和宠物互动、拖拽宠物、摆放家具，打造自己的像素小房间。
- **代码区轻量陪伴**：宠物还能以不遮挡代码的方式出现在编辑器右侧安全区域。
- **项目级存档**：宠物名字、族群、成长值、资源、背包、家具摆放和界面设置都会写进当前项目的 `.vscode/eden.json`。

## 效果预览

### 宠物状态

<p align="center">
  <img src="./media/docs/readme-pet-states.png" alt="code-mate pet states" width="100%" />
</p>

## 你可以在里面做什么

### 1. 养一只会认项目气质的宠物

插件首次进入项目时，会扫描当前工程的一部分代码特征，并决定宠物更像哪一种风格：

- **Primitives / 原型派**：圆润、亲和，偏爱长椅和树
- **Concurrency / 并发派**：轻快、灵动，偏爱台灯和街机
- **Protocols / 协议派**：稳定、克制，偏爱钢琴和台灯
- **Chaos / 混沌派**：戏剧性更强，偏爱树和长椅

如果你不想让它自动判断，也可以在侧边栏手动切换种族，手动选择会优先保留。

### 2. 通过开发行为推进成长

这些行为都会影响宠物的资源和成长：

- 写入有效代码
- 成功保存文件
- 连续稳定保存
- 逗一逗宠物
- 购买家具
- 摆放家具

成长分为三个阶段：

| 阶段 | 成长值 | 表现变化 |
| --- | --- | --- |
| 初生期 | 0 - 99 | 体型更小，动作更克制，家具联动较弱 |
| 成长期 | 100 - 299 | 细节更完整，开始主动靠近偏好家具，报错时会找掩体 |
| 成熟期 | 300+ | 反馈最完整，庆祝、互动和空间联动最明显 |

### 3. 在底部乐园里布置你的空间

你可以在侧边栏商店购买家具，再把它们摆进底部乐园：

- 地面家具：钢琴、木椅、盆栽、台灯、街机、地毯、沙发、咖啡机等
- 墙面家具：挂盆、装饰画、挂钟、壁灯等

宠物会根据当前族群偏好和成长阶段，对不同家具产生不同反应。

### 4. 在不打扰编码的前提下获得陪伴感

这个插件的目标不是让宠物覆盖代码，而是尽量做到：

- 编辑器里只出现在右侧安全区域
- 底部乐园负责主要互动
- 视觉反馈明显，但不过度抢焦点

## 使用方式

### 安装

#### 通过 VSIX 安装

1. 从 GitHub Releases 下载 `code-mate-1.0.1.vsix`
2. 打开 VS Code 扩展页
3. 点击右上角 `...`
4. 选择 `Install from VSIX...`
5. 选中下载好的 `code-mate-1.0.1.vsix`
6. 安装完成后重载 VS Code

### 打开面板

安装后，你可以在 VS Code 中看到：

- 左侧活动栏中的 **vscode宠物：工位搭子**
- 侧边栏中的 **vscode宠物：工位搭子**
- 底部面板中的 **底部乐园**

### 常见操作

- 给宠物起名
- 手动切换种族
- 重新自动判定种族
- 切换主题
- 调整代码区宠物显示与大小
- 购买和摆放家具
- 在底部乐园中拖动宠物和家具

## 项目存档

当前项目状态会写入：

```text
.vscode/eden.json
```

主要包含：

- 宠物名
- 宠物族群与来源
- 成长值与成长阶段
- 资源数量
- 背包内容
- 已摆放家具
- 宠物在底部乐园中的位置
- 代码区宠物显示开关与大小
- 当前主题

## 本地开发

### 安装依赖

```bash
npm install
```

### 编译

```bash
npm run compile
```

### 调试运行

1. 在 VS Code 中打开项目
2. 按 `F5`
3. 在新的 `Extension Development Host` 中打开侧边栏和底部乐园

### 打包 VSIX

```bash
npm run package
```

生成文件示例：

```bash
code-mate-1.0.0.vsix
```

## 适合谁

- 想给 VS Code 增加一点可爱陪伴感的开发者
- 喜欢像素风、成长系统和轻量交互反馈的用户
- 想把“写代码”变成更有空间感和情绪感体验的人

## 技术栈

- TypeScript
- VS Code Extension API
- WebviewViewProvider
- TextEditorDecorationType
- 项目级 JSON 持久化

## 仓库结构

```text
.
├─ media/                 # 宠物、家具、Webview 样式与脚本
├─ src/                   # 插件核心逻辑
├─ dist/                  # TypeScript 编译输出
├─ .vscode/eden.json      # 项目级存档（运行后生成）
├─ package.json
└─ README.md
```

## 版本说明

**1.0.0**

- 完整的四族群体系
- 三阶段成长反馈
- 更自然的连续生命感动作
- 底部乐园交互与拖拽体验优化
- 家具商店、摆放与项目级存档闭环

## 愿景

`vscode宠物：工位搭子 / code-mate` 想做的不是一个单纯会动的装饰品，而是一只真正住进项目里的小宠物：
它理解你的工程气质，会随着你的开发节奏成长，也会在你每天打开 VS Code 时，安静地陪你一起工作。
