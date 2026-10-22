# RepoSite 技术实现文档

**版本：** V1.1  
**项目定位：** 将公开 GitHub 仓库转换为结构清晰、易于人类阅读和 AI 系统检索理解的项目主页与文档网站。

## 1. 项目目标

RepoSite 允许用户输入公开 GitHub 仓库地址，读取仓库中的 README、Markdown 文档、项目元数据和图片，生成规范的静态网站。

核心目标：

- 自动生成项目介绍主页、文档导航和内容页面。
- 优化语义化 HTML、Markdown、JSON 元数据和内容索引，方便搜索引擎及 AI 系统发现、解析和引用项目内容。
- 支持 DeepSeek、MiniMax 两类 AI 服务，允许使用服务端配置的 API Key，或由用户提供自己的 API Key。
- 支持中文或英文生成，每次生成选择一种语言。
- 生成前提供内容预览、图片检查、链接检查、许可证检查和来源审计。
- 用户确认后，使用确定性模板生成静态网站，并打包为 ZIP。
- 不在 V1 中执行仓库中的任意脚本，也不允许 AI 直接生成并执行任意网站代码。

> 说明：RepoSite 能改善内容的可发现性和可解析性，但不能保证第三方 AI 系统一定抓取、索引或用于模型训练。

## 2. 最终决策

| 项目 | 最终方案 |
|---|---|
| 前端技术 | Astro + TypeScript |
| UI | Tailwind CSS + shadcn/ui + React |
| 图标 | Lucide |
| 部署 | Netlify |
| AI 提供商 | DeepSeek、MiniMax |
| AI 使用模式 | 服务端配置与用户自带 API Key 同时支持 |
| 生成语言 | 支持中文、英文选择；单次生成一种语言 |
| 本地图片数量上限 | 50 张 |
| 外部图片 | 默认保留外链，可选下载到本地 |
| 无 LICENSE | 显示警告，用户明确确认后允许继续 |
| 仓库范围 | 仅公开 GitHub 仓库 |
| 配置持久化 | 浏览器 LocalStorage 保存非敏感配置 |
| 账号系统 | V1 不需要 |
| 数据库 | V1 不需要 |
| 生成确认流程 | 预览 → 审核 → 用户确认 → 生成 → ZIP 导出 |
| 发布方式 | 用户自行部署，不提供一键 Netlify 发布 |
| AI 图片生成 | V1 不支持 |

## 3. 系统架构

### 3.1 总体架构

```text
┌───────────────────────────────────────────┐
│              Astro Web App                │
│                                           │
│  仓库输入 / 配置 / 内容预览 / 审核 / 导出  │
└──────────────────┬────────────────────────┘
                   │
          ┌────────┴─────────┐
          ▼                  ▼
┌─────────────────┐  ┌────────────────────┐
│ GitHub Reader   │  │ AI Provider Client │
│                 │  │                    │
│ Repo Metadata   │  │ Server-side Mode   │
│ README / Docs   │  │ User-key Mode      │
│ Tree / Images   │  │ DeepSeek / MiniMax │
└────────┬────────┘  └─────────┬──────────┘
         │                     │
         ▼                     ▼
┌─────────────────┐  ┌────────────────────┐
│ Content Pipeline│  │ Netlify Functions  │
│                 │  │                    │
│ Markdown Parser │  │ Key isolation      │
│ Schema Validate │  │ Request validation │
│ Source Tracking │  │ Rate limiting      │
└────────┬────────┘  └─────────┬──────────┘
         │                     │
         ▼                     ▼
┌───────────────────────────────────────────┐
│ Preview & Audit                           │
│                                           │
│ Content / Images / Links / License /      │
│ Sources / Security                        │
└──────────────────┬────────────────────────┘
                   │ 用户确认
                   ▼
┌───────────────────────────────────────────┐
│ Deterministic Static Site Generator       │
│                                           │
│ TypeScript Templates + Validated Data     │
│ HTML / CSS / JS / Markdown / JSON         │
└──────────────────┬────────────────────────┘
                   │
                   ▼
             ZIP Export
```

### 3.2 架构原则

1. Astro 负责 RepoSite 自身的界面与静态页面。
2. 用户运行期间输入的仓库数据不能直接变成 Astro 构建时的文件，因此单独实现基于 TypeScript 的静态站点生成器。
3. 生成器只接受通过 Zod 校验的数据模型，并使用固定模板渲染。
4. AI 负责辅助提取、归纳和撰写内容，不负责输出可直接执行的网站程序。
5. GitHub 仓库内容、AI 输出和用户配置均视为不可信输入。
6. AI 请求统一经过 Provider 抽象层，按用户选择切换服务端 Key 或用户自带 Key。
7. 生成前必须完成审核；存在阻断级问题时不能直接进入最终导出。

## 4. 技术选型

| 模块 | 技术方案 |
|---|---|
| 应用框架 | Astro |
| 编程语言 | TypeScript |
| 交互组件 | React |
| UI 样式 | Tailwind CSS |
| 组件库 | shadcn/ui |
| 图标库 | lucide-react |
| GitHub 数据 | GitHub REST API |
| Markdown | unified、remark、rehype |
| HTML 安全处理 | rehype-sanitize |
| 代码高亮 | Shiki |
| 数据校验 | Zod |
| ZIP 打包 | JSZip |
| AI | DeepSeek、MiniMax |
| 服务端 API 代理 | Netlify Functions |
| 搜索索引 | Pagefind，视生成后处理流程启用 |
| 单元测试 | Vitest |
| 端到端测试 | Playwright |

具体依赖版本在项目初始化时锁定，并在 CI 中验证兼容性。

## 5. AI 使用模式与 API Key 管理

### 5.1 两种模式同时支持

RepoSite 提供统一的 AI 配置页面，用户可以选择以下任一模式。

**模式 A：使用服务端配置的 API Key**

适用于个人部署、团队内部使用或由站点运营者统一承担 AI 费用的场景。

- DeepSeek、MiniMax 的 Key 配置在 Netlify 环境变量中。
- 浏览器只调用 RepoSite 的 Netlify Functions。
- 服务端读取环境变量并请求对应模型服务。
- 浏览器不接触服务端 Key。
- 不同部署环境可以使用不同的模型与额度策略。

建议环境变量：

```dotenv
DEEPSEEK_API_KEY=
MINIMAX_API_KEY=
DEFAULT_GENERATION_LANGUAGE=zh-CN
AI_MAX_INPUT_BYTES=524288
AI_MAX_OUTPUT_TOKENS=8192
```

以上为配置示例；实际值应根据所选模型、服务商限制和测试结果调整。不得将真实密钥提交到 Git 仓库。

**模式 B：用户自带 API Key（BYOK）**

适用于希望自行承担费用、独立管理模型额度的用户。

- 用户主动选择 BYOK 模式并填写 Key。
- Key 只在当前浏览器运行期间保存在内存中。
- 默认不写入 LocalStorage、IndexedDB、URL、日志或导出 ZIP。
- 浏览器向 Netlify Functions 提交本次 AI 请求时，通过独立字段传递 Key；服务端仅在请求处理期间使用。
- 服务端不得将用户 Key 写入日志、错误追踪信息或持久化存储。
- 请求结束后释放相应的临时引用；不能将其写入缓存。
- 页面刷新后要求用户重新输入，V1 不提供持久保存 Key 的功能。

由于 BYOK 请求仍然经过 RepoSite 的服务端代理，部署运营者理论上仍可接触请求处理过程。产品应明确告知用户这一点。若未来要实现浏览器直接请求 AI 服务，可作为后续独立方案评估，但必须先验证服务商的 CORS、浏览器兼容性和 Key 暴露风险。

### 5.2 统一 Provider 接口

```ts
type AIProviderName = "deepseek" | "minimax";
type AIKeyMode = "server" | "byok";
type GenerationLanguage = "zh-CN" | "en-US";

interface AIRequestConfig {
  provider: AIProviderName;
  keyMode: AIKeyMode;
  language: GenerationLanguage;
  model?: string;
}

interface AIProvider {
  generate(input: {
    systemPrompt: string;
    userPrompt: string;
    config: AIRequestConfig;
    userApiKey?: string;
  }): Promise<unknown>;
}
```

安全要求：

- `userApiKey` 只能在 BYOK 请求中使用。
- 服务端模式必须忽略用户提交的 Key，并使用对应环境变量。
- 服务端校验 provider、model、language 和输入大小。
- model 名称采用服务端允许列表，不允许用户通过任意 URL 控制请求目标。
- 禁止输出 API Key 到错误信息。
- AI 返回值必须通过 Zod Schema 校验后才能进入内容管线。

### 5.3 模型费用与滥用控制

服务端模式必须考虑公共部署时的资源消耗：

- 配置请求频率限制和单次输入、输出上限。
- 对单次生成和批量生成分别设置成本保护。
- 尽可能限制并发，设置请求超时和重试上限。
- 记录不含密钥和敏感内容的用量指标。
- BYOK 与服务端模式使用独立的限额策略。
- 如果当前部署无法实现可靠的身份识别或全局限流，不得宣称已有严格的用户级配额保障；应优先用于受控环境，或增加适用的限流基础设施。

## 6. 生成语言配置

### 6.1 支持范围

V1 支持：

- 中文：`zh-CN`
- 英文：`en-US`

每次生成只能选择一种语言，不在同一次生成任务中自动生成双语正文。

### 6.2 语言选择规则

1. 用户在生成前明确选择语言。
2. 默认语言读取 `DEFAULT_GENERATION_LANGUAGE`，未设置时使用中文。
3. 用户可以在界面中切换语言。
4. 切换语言后，所有 AI 生成的标题、简介、目录描述和新生成正文统一使用目标语言。
5. 原始仓库内容保留原文，并在内容模型中标记源语言和目标语言。
6. 对于已经存在的 README 或文档，必须区分原文与 AI 生成内容；未经授权不能把翻译内容标记为原始作者内容。
7. 语言选择保存在本地非敏感配置中，但每个生成任务也必须保存明确的 `targetLanguage`，避免后续配置变化影响正在进行的任务。

### 6.3 提示词约束

提示词应要求模型：

- 严格使用选定的目标语言撰写新生成内容。
- 保留项目名称、API 标识符、代码符号和专有名词。
- 不得凭空编造功能、性能、许可证或兼容性信息。
- 对来源无法证实的信息明确标记为推断。
- 返回符合指定 JSON Schema 的结构化数据。

## 7. GitHub 仓库读取

### 7.1 支持范围

只允许公开 GitHub 仓库，例如：

```text
https://github.com/owner/repository
```

禁止将输入直接用于任意 HTTP 请求。先解析并校验 GitHub URL，再通过固定 GitHub API 主机读取数据。

### 7.2 读取内容

- 仓库元数据。
- README。
- 递归文件树。
- 选定的 Markdown 文档。
- 选定的图片文件。
- Releases、分支和必要的版本信息。

应固定一次生成任务对应的 commit SHA，所有文件尽可能从同一提交读取，避免任务执行期间仓库变化造成内容不一致。

### 7.3 资源限制

- 图片处理上限：最多 50 张本地图片。
- 单个文件大小、仓库读取量、Markdown 长度和 AI 输入长度均设置独立上限。
- 排除 `.git`、`node_modules`、`dist`、`build` 等非必要目录。
- 不执行仓库中的 `package.json` 脚本、构建脚本或其他任意代码。
- 递归文件树遇到 GitHub API 截断时，应进行补充读取或明确提示内容不完整，不能默默认为读取完整。

图片数量上限是数量约束，不代表可以不受限制地读取超大图片；图片大小仍需单独校验。

## 8. 图片处理策略

### 8.1 本地图片

对于仓库中的相对路径图片：

1. 以引用它的 Markdown 文件所在目录为基准解析相对路径。
2. 对路径进行规范化，拒绝目录穿越和非法路径。
3. 从固定 commit SHA 获取图片。
4. 校验文件类型、文件大小和内容。
5. 对图片内容去重，避免重复复制同一资源。
6. 每个生成任务最多处理 50 张不同的本地图片。
7. 超过上限时展示未处理列表，允许用户调整优先级或取消生成；不得悄悄声称所有图片均已复制。
8. 复制到生成网站的 `assets/images/` 目录，并更新 Markdown 和 HTML 中的引用路径。

### 8.2 外部图片

默认保留外部图片 URL，不自动下载。

用户可主动开启下载选项。下载时：

- 仅允许 HTTP/HTTPS。
- 禁止访问 localhost、私有 IP、云元数据地址等内部目标。
- 校验重定向后的目标地址。
- 设置超时、文件大小和总下载量限制。
- 验证实际内容类型，而不只信任扩展名。
- 对跨域失败、下载失败或无法验证的图片保留原始 URL，并在审计报告中警告。
- 不得将外部图片下载失败解释为图片不存在。

### 8.3 SVG 和其他主动内容

- SVG 必须经过严格净化，移除脚本、事件处理器、危险链接及其他主动内容。
- 不允许通过原样嵌入不可信 SVG 绕过内容安全处理。
- 不允许未经检查直接插入任意 HTML。
- 对不支持或不安全的格式，提示用户并选择保留外链或跳过。

### 8.4 图片来源记录

每张图片保存：

- 原始 URL 或仓库相对路径。
- 来源 commit SHA。
- 最终生成路径。
- 处理方式：本地复制、保留外链、用户选择下载或跳过。
- 审核状态与失败原因。

## 9. 内容模型与项目介绍编辑

项目介绍编辑使用独立路由，例如 `/project-config`，避免把所有配置项暴露在主导航中。

注意：隐藏路由只是信息架构设计，不是权限控制。涉及密钥的功能仍必须依靠内存隔离和服务端安全策略。

### 9.1 建议的数据模型

```ts
interface ProjectMetadata {
  name: string;
  description: string;
  repositoryUrl: string;
  sourceCommitSha: string;
  sourceLanguage?: string;
  targetLanguage: "zh-CN" | "en-US";
  generatedAt: string;
  license?: {
    identifier?: string;
    sourcePath?: string;
    status: "detected" | "missing" | "uncertain";
    userConfirmedMissing?: boolean;
  };
}

interface DocumentPage {
  slug: string;
  title: string;
  contentMarkdown: string;
  sourcePath?: string;
  sourceCommitSha?: string;
  origin: "repository" | "ai_generated" | "user_edited";
  verification:
    | "source_verified"
    | "ai_inferred"
    | "human_verified";
}

interface AssetRecord {
  sourcePath?: string;
  sourceUrl?: string;
  outputPath?: string;
  type: "image" | "other";
  handling: "copied" | "linked" | "downloaded" | "skipped";
  auditStatus: "passed" | "warning" | "failed";
}
```

实际实现还应补充任务 ID、审计记录、文件大小、MIME 类型等字段，并对枚举值、路径和字符串长度进行校验。

### 9.2 来源与验证状态

- `source_verified`：可直接对应仓库来源的信息。
- `ai_inferred`：AI 根据现有材料推断的信息。
- `human_verified`：用户已人工检查确认的信息。

AI 生成的内容不能自动标记为人工验证。用户确认生成任务也不应自动把每条 AI 推断都标记为事实。

## 10. 内容预览、审计与确认

### 10.1 标准流程

```text
输入 GitHub URL
      ↓
读取仓库元数据与固定版本文件
      ↓
解析 README、文档、图片
      ↓
选择生成语言与 AI Key 模式
      ↓
AI 生成辅助内容（可选）
      ↓
预览与人工编辑
      ↓
图片、链接、许可证、来源、安全审计
      ↓
展示阻断项与警告项
      ↓
用户确认
      ↓
确定性模板生成网站
      ↓
打包 ZIP
```

### 10.2 审计项目

**图片审计**

- 本地图片是否成功复制。
- 是否超过 50 张上限。
- 外链是否存在格式问题或下载失败。
- 图片路径是否有效。
- SVG 是否完成安全处理。

**链接审计**

- 站内链接目标是否存在。
- 锚点是否存在。
- 相对路径是否正确。
- 外部链接能否检查到可用状态。
- 对受网络、鉴权、限流或跨域影响的链接，标记为“无法确认”，而不是直接认定失效。
- 指向仓库内其它文件或目录（monorepo 包、LICENSE、工作流文件等）的相对链接，必须重写为固定 commit 的仓库链接
  （文件使用 `/blob/<sha>/`，目录使用 `/tree/<sha>/`），避免在生成站点中形成死链。

**许可证审计**

- 检查仓库根目录和常见 LICENSE 文件位置。
- 如能识别，记录许可证标识及来源。
- 如不存在或无法确定，显示显著警告。
- 允许用户查看风险提示后明确确认继续。
- 用户确认仅代表其选择继续，不等于 RepoSite 授予许可证，也不意味着复制和再分发一定合法。

**来源审计**

- 标注 AI 生成、原始仓库内容和用户编辑内容。
- 标记无法从仓库来源证实的项目能力和性能声明。
- 检查输出内容是否丢失关键来源信息。
- 对不确定的许可证、功能描述和外部链接给出警告。

### 10.3 阻断项与警告项

| 问题 | 级别 | 处理 |
|---|---|---|
| 非法路径或目录穿越 | 阻断 | 修复后重审 |
| 必要内容结构校验失败（例如文档缺少标题） | 阻断 | 修复后重试 |
| 本地图片路径无法安全解析 | 阻断 | 修复或跳过相关图片 |
| 文档中的脚本或主动内容 | 警告 | 渲染时已丢弃原始 HTML，提示作者改写 |
| 内部链接无法解析（既不是生成页面，也不在仓库树中） | 警告 | 保留原样并提示用户核对 |
| 指向仓库其他文件或目录的相对链接 | 自动处理 | 重写为固定 commit 的仓库链接，不计入问题 |
| 图片数量超过 50 张 | 警告 | 用户调整选择后继续 |
| 外部链接无法确认 | 警告 | 用户查看后继续 |
| 图片下载失败 | 警告 | 保留外链或跳过 |
| 未发现 LICENSE | 警告 | 用户明确确认后继续 |
| AI 推断尚未核实 | 警告 | 核查、编辑或确认风险后继续 |
| 非必要元数据缺失 | 警告 | 允许补充或继续 |

阻断项仅保留“生成结果必然错误或存在安全风险”的情况。Markdown 渲染管线会丢弃原始 HTML 并净化标签、属性与协议，因此源文档中的 `<script>`、`<iframe>`、`javascript:` 等片段不会出现在输出中；把它们设为阻断只会让大量正常仓库无法导出，因此按警告处理，并单独排除代码块与行内代码，避免把 HTML/JavaScript 示例误判为攻击。

仓库中的链接指向未生成的文档时属于产品取舍而非源内容缺陷：无法解析的链接统一降级为警告，指向仓库文件或目录的链接则直接重写为固定 commit 地址。

所有警告均应在确认界面中展示。对于无 LICENSE 的情况，必须有明确的确认操作，不能仅凭点击普通“继续”按钮或默认勾选自动放行。

## 11. 静态网站生成器

### 11.1 生成策略

静态网站生成器使用独立 TypeScript 模块，根据经过校验的项目元数据、文档、图片清单和审核结果渲染固定模板。

禁止：

- 将 AI 返回的字符串当作 JavaScript 执行。
- 使用 `eval` 或动态函数执行生成内容。
- 直接把未经净化的 Markdown 转换结果插入 HTML。
- 运行仓库里的脚本来完成生成。
- 将用户输入拼接为任意服务端文件路径。

### 11.2 输出目录

```text
dist/
├── index.html
├── 404.html
├── assets/
│   ├── css/
│   ├── js/
│   └── images/
├── docs/
│   ├── index.html
│   └── ...
├── markdown/
│   ├── README.md
│   └── ...
├── ai/
│   ├── manifest.json
│   ├── pages.json
│   └── chunks.json
├── llms.txt
├── llms-full.txt
├── robots.txt
└── sitemap.xml
```

其中：

- `index.html`：项目主页。
- `docs/`：按固定路由生成的文档页。
- `markdown/`：便于机器直接读取的 Markdown。
- `ai/manifest.json`：项目元数据和内容索引。
- `ai/pages.json`：页面清单与来源元数据。
- `ai/chunks.json`：可选的分块内容与来源引用。
- `llms.txt`、`llms-full.txt`：面向 AI 阅读场景的导航与内容摘要。
- `sitemap.xml`：搜索引擎页面索引。

`markdown/README.md` 是站点总览；当仓库 README 文档占用 `markdown/readme.md` 时，总览改名为
`markdown/README-home.md`。生成器必须保证输出路径在大小写不敏感的文件系统上不冲突（Windows、macOS），
否则解压 ZIP 时会互相覆盖。`llms-full.txt` 使用与页面一致的重写结果，避免出现失效的相对路径。

这些文件只是提升发现与理解能力的输出约定，并不保证所有 AI 系统都支持或使用它们。

### 11.3 ZIP 导出

- 由浏览器中的 JSZip 打包。
- ZIP 中不包含任何 API Key、服务端环境变量或调试凭据。
- 生成完成后显示文件数量、总体积和审计摘要。
- 超过浏览器可承受的资源阈值时，应在打包前提示用户，避免无反馈地冻结页面。
- 导出内容应包含必要的版权和来源信息，但不能擅自修改原仓库的许可证声明。

## 12. 浏览器配置持久化

LocalStorage 仅保存非敏感配置，例如：

```ts
interface LocalSettings {
  preferredProvider: "deepseek" | "minimax";
  preferredKeyMode: "server" | "byok";
  targetLanguage: "zh-CN" | "en-US";
  downloadExternalImages: boolean;
  preferredTheme?: "light" | "dark" | "system";
}
```

禁止保存：

- API Key。
- Authorization Header。
- 完整的服务端环境变量。
- 不必要的用户隐私数据。

用户可以清理本地配置或恢复默认值。刷新页面后，BYOK 模式必须要求重新输入 Key。

## 13. Netlify 部署

RepoSite 本身部署在 Netlify：

- Astro 负责前端构建。
- Netlify Functions 负责 AI 服务代理和必要的服务端校验。
- DeepSeek 和 MiniMax 的服务端 Key 通过 Netlify 环境变量配置。
- 用户生成的目标网站通过 ZIP 下载，不直接发布到 Netlify。

配置示例：

```toml
[build]
  command = "npm run build"
  publish = "dist"

[functions]
  directory = "netlify/functions"
```

具体函数目录、运行时和 Node.js 版本应以项目选定的 Netlify 配置为准。部署前验证构建、函数调用、超时和环境变量是否正确。

## 14. 安全策略

### 14.1 输入安全

- 严格校验 GitHub 仓库 URL。
- 固定 GitHub API 主机，不接受任意 API 地址。
- 规范化文件路径，阻止目录穿越。
- 对仓库内容、AI 输出和用户编辑内容分别校验。
- 限制文件大小、输入字节数、输出 Token 和请求时间。

### 14.2 XSS 与主动内容

- Markdown 通过安全管线处理。
- HTML 输出使用转义和允许列表。
- SVG 经过净化。
- 不允许未经检查的内联脚本。
- 使用合适的 Content Security Policy。
- 用户可编辑的项目介绍也必须经过相同的安全校验。

### 14.3 API Key 安全

- 服务端 Key 仅存储在部署环境变量中。
- BYOK Key 默认仅存在浏览器内存。
- 不记录 Key、完整 Authorization Header 或含 Key 的异常信息。
- 生产日志对请求正文和敏感字段进行脱敏。
- 服务端 Key 模式与 BYOK 模式分别进行权限和配额检查。
- 对 AI 接口设置速率限制、输入输出上限和超时。
- 对不可信客户端不能依赖前端校验作为唯一安全边界。

### 14.4 SSRF 与外部资源

外部图片下载和其他外部资源请求必须防止 SSRF：

- 禁止本机、私有网络、链路本地及云元数据地址。
- 检查 DNS 解析与重定向目标。
- 对目标地址、端口、协议、超时和文件大小设置限制。
- 优先通过允许列表管理外部请求能力。

### 14.5 Prompt Injection

- README、Markdown 和仓库文本只视为数据，不视为系统指令。
- 不允许仓库内容覆盖系统提示词或安全规则。
- AI 生成结果仅进入结构化内容模型。
- AI 不获得命令执行、任意文件访问或部署权限。
- 生成后重新执行 Schema、链接、路径和内容安全审计。

### 14.6 许可证与内容权利

- 未发现许可证不等于允许自由复制或再分发。
- 明确提示用户确认其有权使用和发布所选内容。
- 保存许可证识别来源及用户确认记录。
- 不擅自替换仓库许可证，不生成虚假的授权声明。

## 15. 测试策略

### 15.1 单元测试

- GitHub URL 解析与校验。
- 路径规范化和目录穿越防护。
- Markdown 解析与 HTML 安全处理。
- Zod Schema 校验。
- AI Provider 切换。
- 中文、英文提示词和内容结构校验。
- 图片数量上限与去重。
- LICENSE 检测和警告状态。
- ZIP 文件清单与密钥泄漏检查。

### 15.2 集成测试

- 公开仓库读取。
- README 和相对图片路径解析。
- DeepSeek / MiniMax 适配器。
- 服务端 Key 与 BYOK 两种模式。
- AI 返回无效 JSON 时的错误处理。
- 外部图片下载失败后的回退逻辑。
- 审计报告与确认状态。
- 静态网站生成和 ZIP 打包。

### 15.3 端到端测试

- 输入仓库 URL 并加载预览。
- 切换中文与英文。
- 切换服务端 Key 和 BYOK。
- BYOK 刷新页面后不保留 Key。
- 本地图片超过 50 张时出现清晰提示。
- 未发现 LICENSE 时显示警告，并要求明确确认。
- 阻断项未解决时禁止最终导出。
- 完成审核后成功生成 ZIP。
- ZIP 中不包含 API Key、密钥字段或服务端配置。
- 生成的网站在本地静态服务器和 Netlify 上均能正确打开。

## 16. 验收标准

### P0：基础生成能力

- [ ] 可以输入并校验公开 GitHub 仓库地址。
- [ ] 可以读取仓库元数据、README 和选定文档。
- [ ] 可以生成项目主页与文档导航。
- [ ] 使用固定模板生成网站，不执行仓库代码。
- [ ] 可以导出完整 ZIP。
- [ ] 生成的网站不依赖 RepoSite 后端运行。

### P1：内容预览与审计

- [ ] 可以预览并编辑生成内容。
- [ ] 本地图片复制正确，单次最多处理 50 张。
- [ ] 外部图片默认保留链接。
- [ ] 可以检查内部链接、图片路径和来源。
- [ ] 无 LICENSE 时显示明确警告。
- [ ] 用户必须明确确认后才能在无 LICENSE 状态下继续。
- [ ] 阻断项存在时禁止最终生成。
- [ ] 所有警告都能追溯到对应内容或资源。

### P2：AI 能力

- [ ] 同时支持服务端配置 Key 和用户自带 Key。
- [ ] 支持 DeepSeek、MiniMax。
- [ ] 服务端 Key 不会出现在浏览器资源、日志或 ZIP 中。
- [ ] BYOK Key 不写入 LocalStorage、URL 或 ZIP。
- [ ] 支持中文、英文选择，单次任务只使用一种目标语言。
- [ ] AI 返回内容通过 Schema 校验。
- [ ] 对 AI 推断内容进行明确标记。
- [ ] AI 请求失败时能恢复、重试或退回手动编辑。

### P3：AI 友好输出

- [ ] 输出语义化 HTML 和 Markdown。
- [ ] 输出 `llms.txt`、`sitemap.xml` 和 JSON 内容索引。
- [ ] 生成稳定的页面路由和标题。
- [ ] 保留来源信息和许可证声明。
- [ ] 可使用 Pagefind 等方案提供站内搜索。
- [ ] 不宣称能保证 AI 抓取或训练。

## 17. 开发计划

### Phase 0：项目骨架与安全基线

任务：

- 初始化 Astro、TypeScript、Tailwind CSS 和 shadcn/ui。
- 建立 React 交互组件。
- 配置 Netlify 构建与 Functions。
- 定义数据模型、Zod Schema 和统一错误结构。
- 实现 GitHub URL 校验、路径规范化和基础安全策略。
- 建立 Vitest、Playwright 与 CI。

完成条件：项目可以构建、测试并部署；关键输入校验通过测试。

### Phase 1：GitHub 读取与确定性生成

任务：

- 读取公开仓库元数据、README 和文档。
- 固定生成任务的 commit SHA。
- 实现 Markdown 解析与静态页面模板。
- 实现基础资源复制和相对链接转换。
- 实现 HTML、Markdown 和 JSON 文件输出。
- 实现 ZIP 导出。

完成条件：无需 AI 即可从公开仓库生成一个可部署的静态网站。

### Phase 2：预览、资源处理与审计

任务：

- 建立内容预览与人工编辑界面。
- 实现最多 50 张本地图片的处理限制。
- 实现外部图片保留与可选下载。
- 实现内部链接、图片、来源和许可证审计。
- 实现阻断项与警告项的状态流转。
- 对无 LICENSE 场景实现明确确认流程。

完成条件：未通过阻断级检查不能最终导出；无 LICENSE 可以在用户明确确认后继续。

### Phase 3：AI 与双 Key 模式

任务：

- 实现 DeepSeek 和 MiniMax Provider。
- 实现服务端 Key 模式。
- 实现 BYOK 模式和内存级 Key 管理。
- 实现 Netlify Functions 请求校验与密钥脱敏。
- 实现中文、英文选择及目标语言一致性校验。
- 实现模型输出 Schema 校验、失败回退与成本控制。
- 测试 API Key 不落盘、不进入日志、不进入 ZIP。

完成条件：两种 Key 模式均可工作；语言选择有效；密钥保护与配额策略通过测试。

### Phase 4：AI 友好输出与完善

任务：

- 生成 `llms.txt`、`llms-full.txt` 和 JSON 内容索引。
- 优化语义化 HTML、Markdown 结构和来源标记。
- 生成 sitemap。
- 按需要接入 Pagefind。
- 验证生成网站在静态托管环境中的兼容性。
- 完成安全、性能和 ZIP 完整性测试。

完成条件：生成网站能够独立部署，核心页面、资源、索引和文档均通过验收。

## 18. V1 范围边界

V1 不包含：

- 用户注册、登录与云端项目管理。
- 数据库持久化。
- 一键发布到 Netlify。
- AI 图片生成。
- 私有 GitHub 仓库访问。
- 任意代码执行或自动运行项目构建脚本。
- 保证内容被第三方 AI 抓取或用于训练。
- 永久保存用户自带 API Key。
- 自动判定用户是否拥有全部内容的再分发权。

## 19. 最终实现原则

1. **内容先正确，样式后优化。** 内容预览、审核与用户确认必须先于最终生成。
2. **确定性生成。** AI 只输出经过校验的数据，网站结构由固定模板决定。
3. **双 Key 模式并存。** 同时支持服务端配置和 BYOK，并采用不同的密钥管理策略。
4. **单次单语言。** 中文、英文可以选择，但一次生成任务只指定一种目标语言。
5. **图片数量有界。** 每次最多处理 50 张本地图片，并单独控制文件大小。
6. **许可证风险透明。** 无 LICENSE 时警告并允许用户明确确认继续，不把确认解释为授权。
7. **安全默认开启。** 不执行不可信代码，不暴露密钥，不绕过路径和内容校验。
8. **输出可追溯。** 尽可能保留原始来源、生成状态、许可证信息和审核结果。
9. **可独立部署。** ZIP 应包含静态网站运行所需的文件，不依赖 RepoSite 服务端。
10. **不夸大 AI 效果。** 优化发现和解析能力，但不保证第三方 AI 一定抓取、索引或训练。
