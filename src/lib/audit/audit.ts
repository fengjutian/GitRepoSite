import type {
  AssetRecord,
  AuditIssue,
  AuditReport,
  DocumentPage,
  LicenseInfo,
  ProjectMetadata,
} from '../schema';

export interface AuditInput {
  metadata: ProjectMetadata;
  documents: DocumentPage[];
  assets: AssetRecord[];
  license: LicenseInfo;
  linkIssues?: AuditIssue[];
  imageIssues?: AuditIssue[];
  aiInferredCount?: number;
  externalLinkCount?: number;
  unverifiableExternalLinks?: string[];
}

const SCRIPT_PATTERNS = [
  /<script[\s>]/i,
  /javascript\s*:/i,
  /\son(?:error|load|click|mouseover|focus)\s*=/i,
  /<iframe[\s>]/i,
  /<object[\s>]/i,
  /<embed[\s>]/i,
];

export const MAX_LOCAL_IMAGES = 50;

/** Runs the deterministic pre-generation audit described in the specification. */
export function runAudit(input: AuditInput): AuditReport {
  const issues: AuditIssue[] = [];

  for (const document of input.documents) {
    const markdown = document.contentMarkdown ?? '';
    if (SCRIPT_PATTERNS.some((pattern) => pattern.test(markdown))) {
      issues.push({
        id: 'security-unsafe-content',
        severity: 'blocking',
        category: 'security',
        message: '文档内容中检测到脚本或主动内容，必须先移除。',
        target: document.slug,
        hint: 'Markdown 中的原始 HTML 会被丢弃，请改写该段落。',
      });
    }
    if (!document.title.trim()) {
      issues.push({
        id: 'structure-missing-title',
        severity: 'blocking',
        category: 'structure',
        message: '文档缺少标题。',
        target: document.slug,
      });
    }
  }

  for (const asset of input.assets) {
    if (asset.outputPath && !isSafeOutputPath(asset.outputPath)) {
      issues.push({
        id: 'path-unsafe-output',
        severity: 'blocking',
        category: 'path',
        message: `资源输出路径非法: ${asset.outputPath}`,
        target: asset.outputPath,
        hint: '输出路径必须位于站点目录内。',
      });
    }
    if (asset.sourcePath && !isSafeOutputPath(asset.sourcePath) && asset.handling === 'copied') {
      issues.push({
        id: 'path-unsafe-source',
        severity: 'blocking',
        category: 'path',
        message: `资源来源路径非法: ${asset.sourcePath}`,
        target: asset.sourcePath,
      });
    }
  }

  const copiedCount = input.assets.filter((asset) => asset.handling === 'copied').length;
  if (copiedCount > MAX_LOCAL_IMAGES) {
    issues.push({
      id: 'image-limit-exceeded',
      severity: 'warning',
      category: 'image',
      message: `本次任务复制了 ${copiedCount} 张本地图片，超过 ${MAX_LOCAL_IMAGES} 张上限。`,
      hint: '请调整图片选择后重新生成。',
    });
  }

  if (input.license.status === 'missing') {
    issues.push({
      id: 'license-missing',
      severity: 'warning',
      category: 'license',
      message: '未在仓库中发现 LICENSE 文件。',
      target: input.metadata.repositoryUrl,
      hint: '继续生成即表示你确认有权使用与再分发所选内容；RepoSite 不会授予任何授权。',
    });
  } else if (input.license.status === 'uncertain') {
    issues.push({
      id: 'license-uncertain',
      severity: 'warning',
      category: 'license',
      message: `无法确定仓库许可证${input.license.sourcePath ? ` (${input.license.sourcePath})` : ''}。`,
      hint: '请确认后再分发生成内容。',
    });
  }

  if ((input.aiInferredCount ?? 0) > 0) {
    issues.push({
      id: 'source-ai-inference',
      severity: 'warning',
      category: 'source',
      message: `存在 ${input.aiInferredCount} 条 AI 推断内容，尚未经过人工核实。`,
      hint: '可在预览中编辑或确认这些内容。',
    });
  }

  for (const link of input.unverifiableExternalLinks ?? []) {
    issues.push({
      id: 'link-unverifiable',
      severity: 'warning',
      category: 'link',
      message: `无法确认外部链接是否可用: ${link}`,
      hint: '受网络、鉴权或限流影响时会被标记为无法确认。',
    });
  }

  for (const issue of input.linkIssues ?? []) {
    issues.push({ ...issue, severity: issue.severity === 'info' ? 'warning' : issue.severity });
  }
  for (const issue of input.imageIssues ?? []) {
    issues.push(issue);
  }

  if (!input.metadata.description.trim()) {
    issues.push({
      id: 'metadata-missing-description',
      severity: 'warning',
      category: 'metadata',
      message: '项目简介为空，首页与搜索摘要会缺少描述。',
      hint: '可以在预览中补充简介。',
    });
  }

  const blockingCount = issues.filter((issue) => issue.severity === 'blocking').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;

  return {
    generatedAt: input.metadata.generatedAt,
    issues,
    blockingCount,
    warningCount,
  };
}

export function isSafeOutputPath(path: string): boolean {
  if (!path) return false;
  if (path.includes('\0')) return false;
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return false;
  if (/^[a-zA-Z]:/.test(normalized)) return false;
  return !normalized.split('/').includes('..');
}
