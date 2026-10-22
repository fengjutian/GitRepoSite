# RepoSite

把一个公开 GitHub 仓库转换成结构清晰、语义化、便于人类阅读与 AI 检索的静态文档网站。

- 只读取 **公开仓库**，并把内容固定在某个 commit SHA 上（可复现）。
- **不执行仓库中的任何脚本**，也不执行 AI 生成的代码：网站由确定性 TypeScript 模板生成。
- 生成前完成内容、图片、链接、许可证、来源与安全审计；存在阻断项时禁止导出。
- 支持中文或英文生成（单次任务一种语言）。
- 输出一套可独立部署的静态站点：`HTML` / `Markdown` / `JSON` 索引 / `llms.txt` / `llms-full.txt` / `sitemap.xml`，并打包为 ZIP。

完整技术方案见 [`docs/REPOSITE_SPEC.md`](docs/REPOSITE_SPEC.md)。

## 快速开始

```bash
npm install
npm run dev        # http://localhost:4321
```

常用脚本：

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 本地开发服务器 |
| `npm run build` | 构建 RepoSite 自身（产物在 `dist/`） |
| `npm test` | Vitest 单元测试 |
| `npm run test:integration` | 真实公开仓库集成测试（需要 GitHub API 配额） |
| `npm run test:e2e` | Playwright 端到端测试 |
| `npx tsc --noEmit` | 类型检查 |
| `npm run check` | `astro check` |

## 配置

复制 `.env.example` 为 `.env`（仅本地开发用；线上在 Netlify 环境变量里配置）：

| 变量 | 说明 |
| --- | --- |
| `DEEPSEEK_API_KEY` / `MINIMAX_API_KEY` | 服务端 Key。浏览器永远拿不到这些值 |
| `DEEPSEEK_API_BASE` / `MINIMAX_API_BASE` | 可选：自定义 API 端点 |
| `DEEPSEEK_MODEL` / `MINIMAX_MODEL` | 可选：模型覆盖，必须在允许列表内 |
| `AI_MAX_INPUT_BYTES` / `AI_MAX_OUTPUT_TOKENS` | AI 代理的输入输出上限 |

### API Key 安全

- **服务端模式**：Key 只存在于部署环境变量中，随请求进入 Netlify Function，用完即弃。
- **BYOK 模式**：用户 Key 只保存在当前页面的内存中，刷新即丢失；不写入 LocalStorage、URL、日志或导出的 ZIP。
- 导出前会对生成的每个文件做密钥特征扫描，命中即拒绝打包。

## 目录结构

```text
src/lib/                 核心库（全部为纯 TypeScript，可在浏览器与 Node 中运行）
  github/                URL 校验、路径规范化、GitHub REST 客户端
  content/               Markdown 管线、许可证识别、链接审计
  images/                本地图片、外部图片（SSRF 防护）、SVG 净化
  ai/                    提示词、Provider 抽象、输出校验
  audit/                 审计规则（阻断项 / 警告项）
  site/                  确定性静态站点模板与生成器
  export/                ZIP 打包与密钥扫描
src/components/          React 界面（Studio、配置面板、UI 基础组件）
netlify/functions/       AI 代理、外部图片下载代理
tests/unit/              单元测试
tests/integration/       真实仓库集成测试（需要 GitHub API 配额）
tests/e2e/               Playwright 端到端测试
```

## 生成物

导出的 ZIP 目录结构：

```text
index.html            项目主页
docs/<slug>.html      文档页面
docs/index.html       文档导航
markdown/<slug>.md    Markdown 副本
assets/images/...     复制到本地的图片（SVG 已净化）
assets/css|js/...     站点样式与脚本
ai/manifest.json      站点清单（来源、commit、许可证）
ai/pages.json         页面索引
ai/chunks.json        分块内容索引
llms.txt              给 AI 系统的站点摘要
llms-full.txt         给 AI 系统的完整文本
sitemap.xml / robots.txt
404.html
```

## 部署

Netlify 已在 `netlify.toml` 中配置好：构建命令 `npm run build`，发布目录 `dist`，Functions 目录 `netlify/functions`，`/api/*` 重写到 Functions。

## 已知边界

- 只支持 `github.com` 上的公开仓库；私有仓库需要自建令牌，不在 V1 范围。
- 单次任务最多复制 50 张本地图片；外部图片默认保留外链，可选通过服务端代理下载（带 SSRF 防护）。
- 未发现 LICENSE 时必须由用户明确确认后才能继续；RepoSite 不授予任何授权。
- RepoSite 能改善内容的可发现性，但不能保证第三方 AI 系统一定抓取、索引或用于训练。
