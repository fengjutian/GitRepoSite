import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label, Separator, Textarea } from './ui/primitives';
import { loadRepository, auditRepository, type RepositoryContent } from '@/lib/pipeline';
import { generateSite } from '@/lib/site/generator';
import { packageSite } from '@/lib/export/zip';
import { loadSettings, saveSettings } from '@/lib/settings';
import { renderMarkdown } from '@/lib/content/markdown';
import { rewriteLocalImagePaths } from '@/lib/images/local';
import { base64ToBytes, downloadExternalImages as downloadExternalImagesToSite } from '@/lib/images/external-download';
import type {
  AIKeyMode,
  AIProviderName,
  AuditReport,
  DocumentPage,
  GenerationLanguage,
  ProjectMetadata,
} from '@/lib/schema';
import type { AiProjectSummary } from '@/lib/ai/service';

const LANGUAGE_LABEL: Record<GenerationLanguage, string> = {
  'zh-CN': '中文',
  'en-US': 'English',
};

const PROVIDER_LABEL: Record<AIProviderName, string> = {
  deepseek: 'DeepSeek',
  minimax: 'MiniMax',
};

interface AiState {
  status: 'idle' | 'running' | 'done' | 'error';
  error?: string;
  summary?: AiProjectSummary;
}

export default function Studio() {
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [content, setContent] = useState<RepositoryContent | null>(null);
  const [documents, setDocuments] = useState<DocumentPage[]>([]);
  const [metadata, setMetadata] = useState<ProjectMetadata | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const [language, setLanguage] = useState<GenerationLanguage>('zh-CN');
  const [provider, setProvider] = useState<AIProviderName>('deepseek');
  const [keyMode, setKeyMode] = useState<AIKeyMode>('server');
  const [userApiKey, setUserApiKey] = useState('');
  const [githubToken, setGitHubToken] = useState('');
  const [downloadExternalImages, setDownloadExternalImages] = useState(false);

  const [ai, setAi] = useState<AiState>({ status: 'idle' });
  const [audit, setAudit] = useState<AuditReport | null>(null);
  const [licenseAccepted, setLicenseAccepted] = useState(false);
  const [warningsAccepted, setWarningsAccepted] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSummary, setExportSummary] = useState<{ fileCount: number; totalBytes: number } | null>(null);
  const [externalImageNote, setExternalImageNote] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');

  useEffect(() => {
    const settings = loadSettings();
    setLanguage(settings.targetLanguage);
    setProvider(settings.preferredProvider);
    setKeyMode(settings.preferredKeyMode);
    setDownloadExternalImages(settings.downloadExternalImages);
  }, []);

  const persistSettings = useCallback((patch: Partial<ReturnType<typeof loadSettings>>) => {
    const settings = loadSettings();
    saveSettings({ ...settings, ...patch });
  }, []);

  const activeDocument = useMemo(
    () => documents.find((document) => document.slug === selectedSlug) ?? documents[0] ?? null,
    [documents, selectedSlug],
  );

  // In-browser preview: the same renderer that is used to build the static site.
  useEffect(() => {
    if (!showPreview || !activeDocument) return;
    let cancelled = false;
    const objectUrls: string[] = [];
    const outputPathBySourcePath = new Map<string, string>();

    for (const asset of content?.assets ?? []) {
      if (asset.handling !== 'copied' || !asset.outputPath || !asset.sourcePath) continue;
      const bytes = content?.binaryAssets.get(asset.outputPath);
      if (!bytes) continue;
      const objectUrl = URL.createObjectURL(
        new Blob([bytes.slice().buffer as ArrayBuffer], { type: asset.mimeType ?? 'application/octet-stream' }),
      );
      objectUrls.push(objectUrl);
      outputPathBySourcePath.set(asset.sourcePath, objectUrl);
    }

    const source = rewriteLocalImagePaths(
      activeDocument.contentMarkdown,
      activeDocument.sourcePath,
      outputPathBySourcePath,
      '',
    );

    const timer = setTimeout(() => {
      renderMarkdown(source, { highlight: true })
        .then((result) => {
          if (!cancelled) setPreviewHtml(result.html);
        })
        .catch(() => {
          if (!cancelled) setPreviewHtml('<p>预览渲染失败。</p>');
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      for (const objectUrl of objectUrls) URL.revokeObjectURL(objectUrl);
    };
  }, [activeDocument, content, showPreview]);

  const handleLoad = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setExportSummary(null);
    try {
      const token = githubToken.trim();
      let loaded = await loadRepository(repositoryUrl, {
        targetLanguage: language,
        clientOptions: token ? { token } : undefined,
      });

      if (downloadExternalImages) {
        const result = await downloadExternalImagesToSite(
          loaded.documents,
          loaded.imageReferences,
          async (url) => {
            try {
              const response = await fetch('/api/fetch-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
              });
              const payload = await response.json();
              if (!response.ok || !payload?.ok) {
                return { ok: false, reason: payload?.error?.message ?? '下载失败' };
              }
              return {
                ok: true,
                bytes: base64ToBytes(payload.data.base64),
                contentType: payload.data.contentType,
              };
            } catch (error) {
              return { ok: false, reason: error instanceof Error ? error.message : '下载失败' };
            }
          },
        );
        loaded = {
          ...loaded,
          documents: result.documents,
          assets: [...loaded.assets, ...result.assets],
          binaryAssets: new Map([...loaded.binaryAssets, ...result.binaryAssets]),
        };
        const copied = result.assets.filter((asset) => asset.handling === 'copied').length;
        setExternalImageNote(
          result.failed.length > 0
            ? `已下载 ${copied} 张外部图片，${result.failed.length} 张未能下载（已保留外链）。`
            : `已下载 ${copied} 张外部图片。`,
        );
      } else {
        setExternalImageNote(null);
      }

      setContent(loaded);
      setDocuments(loaded.documents);
      setMetadata(loaded.metadata);
      setSelectedSlug(loaded.documents[0]?.slug ?? null);
      setLicenseAccepted(false);
      setWarningsAccepted(false);
      setAudit(await auditRepository(loaded));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '读取仓库失败。');
      setContent(null);
    } finally {
      setLoading(false);
    }
  }, [repositoryUrl, language, downloadExternalImages, githubToken]);

  const handleEdit = useCallback(
    (slug: string, patch: Partial<DocumentPage>) => {
      setDocuments((current) =>
        current.map((document) =>
          document.slug === slug
            ? { ...document, ...patch, origin: 'user_edited', verification: 'human_verified' }
            : document,
        ),
      );
    },
    [],
  );

  const reAudit = useCallback(async () => {
    if (!content) return;
    const merged: RepositoryContent = { ...content, documents, metadata: metadata ?? content.metadata };
    setAudit(await auditRepository(merged));
  }, [content, documents, metadata]);

  const handleAiAssist = useCallback(async () => {
    if (!content) return;
    setAi({ status: 'running' });
    try {
      const response = await fetch('/api/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          keyMode,
          language,
          model: undefined,
          userApiKey: keyMode === 'byok' ? userApiKey : undefined,
          project: {
            repositoryName: content.metadata.name,
            description: content.metadata.description,
            readme: content.readmeMarkdown,
            documentTitles: content.documents.map((document) => document.title),
            fileTreeSummary: content.fileTreeSummary,
            license: content.license.identifier ?? content.license.status,
          },
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error?.message ?? 'AI 请求失败。');
      }
      setAi({ status: 'done', summary: payload.data as AiProjectSummary });
    } catch (error) {
      setAi({ status: 'error', error: error instanceof Error ? error.message : 'AI 请求失败。' });
    }
  }, [content, provider, keyMode, language, userApiKey]);

  const handleExport = useCallback(async () => {
    if (!content || !metadata) return;
    setExporting(true);
    setExportError(null);
    try {
      // Re-run the audit right before exporting: edited content may introduce new issues.
      const merged: RepositoryContent = { ...content, documents, metadata };
      const freshAudit = await auditRepository(merged);
      setAudit(freshAudit);
      const blocking = freshAudit.issues.filter((issue) => issue.severity === 'blocking');
      if (blocking.length > 0) {
        throw new Error(`存在 ${blocking.length} 个阻断项，已阻止导出：${blocking[0]!.message}`);
      }
      if (merged.license.status === 'missing' && !licenseAccepted) {
        throw new Error('尚未确认许可证风险，已阻止导出。');
      }

      const site = await generateSite({
        metadata,
        documents,
        assets: content.assets,
        binaryAssets: content.binaryAssets,
        repositoryPaths: content.repositoryPaths,
        language,
        summary: ai.summary?.summary,
        highlights: ai.summary?.highlights,
        quickStart: ai.summary?.quickStart,
        tags: ai.summary?.tags,
        audience: ai.summary?.audience,
      });
      const zip = await packageSite(site.files);
      const blob = new Blob([zip.blob], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${metadata.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'site'}-docs.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportSummary({ fileCount: zip.fileCount, totalBytes: zip.totalBytes });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : '生成失败。');
    } finally {
      setExporting(false);
    }
  }, [content, metadata, documents, language, ai.summary, licenseAccepted]);

  const blockingIssues = audit?.issues.filter((issue) => issue.severity === 'blocking') ?? [];
  // The missing license has its own explicit confirmation below, so it is not repeated here.
  const warningIssues =
    audit?.issues.filter((issue) => issue.severity === 'warning' && issue.id !== 'license-missing') ?? [];
  const licenseMissing = metadata?.license?.status === 'missing';
  const canExport =
    !!content &&
    !!metadata &&
    blockingIssues.length === 0 &&
    (!licenseMissing || licenseAccepted) &&
    (warningIssues.length === 0 || warningsAccepted);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5" /> 仓库来源
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="repo-url">公开 GitHub 仓库地址</Label>
            <div className="flex gap-2">
              <Input
                id="repo-url"
                value={repositoryUrl}
                placeholder="https://github.com/owner/repository"
                onChange={(event) => setRepositoryUrl(event.target.value)}
              />
              <Button onClick={handleLoad} disabled={loading || !repositoryUrl.trim()}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                读取仓库
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              仅支持公开仓库；所有内容都从固定 commit SHA 读取，不会执行仓库中的任何脚本。
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="github-token">GitHub Token（可选）</Label>
            <Input
              id="github-token"
              type="password"
              autoComplete="off"
              value={githubToken}
              placeholder="ghp_... / github_pat_..."
              onChange={(event) => setGitHubToken(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              可选。GitHub 对未认证请求按 IP 限制 60 次/小时；填写 Token（不需要任何仓库权限）可提升到 5000
              次/小时。Token 只保存在当前页面内存中，刷新即失效，由浏览器直连 GitHub，不写入本地存储，也不会进入导出的 ZIP。
            </p>
          </div>

          {loadError && <Alert tone="danger">{loadError}</Alert>}

          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="language">生成语言</Label>
              <select
                id="language"
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                value={language}
                onChange={(event) => {
                  const next = event.target.value as GenerationLanguage;
                  setLanguage(next);
                  persistSettings({ targetLanguage: next });
                }}
              >
                <option value="zh-CN">中文</option>
                <option value="en-US">English</option>
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="provider">AI 服务商</Label>
              <select
                id="provider"
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                value={provider}
                onChange={(event) => {
                  const next = event.target.value as AIProviderName;
                  setProvider(next);
                  persistSettings({ preferredProvider: next });
                }}
              >
                <option value="deepseek">DeepSeek</option>
                <option value="minimax">MiniMax</option>
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="key-mode">API Key 模式</Label>
              <select
                id="key-mode"
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                value={keyMode}
                onChange={(event) => {
                  const next = event.target.value as AIKeyMode;
                  setKeyMode(next);
                  persistSettings({ preferredKeyMode: next });
                }}
              >
                <option value="server">服务端配置 Key</option>
                <option value="byok">使用我自己的 Key</option>
              </select>
            </div>
          </div>

          {keyMode === 'byok' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="byok">我的 API Key（仅保存在当前页面内存中，刷新后需重新输入）</Label>
              <Input
                id="byok"
                type="password"
                autoComplete="off"
                value={userApiKey}
                placeholder="sk-..."
                onChange={(event) => setUserApiKey(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Key 会随本次请求发送到 RepoSite 的服务端代理，代理只在该请求处理期间使用它，不会写入日志或导出包。
              </p>
            </div>
          )}

          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={downloadExternalImages}
              onChange={(event) => {
                setDownloadExternalImages(event.target.checked);
                persistSettings({ downloadExternalImages: event.target.checked });
              }}
            />
            <span>下载外部图片到本地（默认保留外链，下载时服务端会做 SSRF 检查）</span>
          </label>
        </CardContent>
      </Card>

      {content && metadata && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="h-5 w-5" /> AI 辅助（可选）
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                AI 只生成结构化摘要，不直接生成网站代码。当前语言：{LANGUAGE_LABEL[language]}；服务商：{PROVIDER_LABEL[provider]}。
              </p>
              <div>
                <Button onClick={handleAiAssist} disabled={ai.status === 'running'}>
                  {ai.status === 'running' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  生成项目简介
                </Button>
              </div>
              {ai.status === 'error' && <Alert tone="danger">{ai.error}</Alert>}
              {ai.status === 'done' && ai.summary && (
                <Alert tone="success">
                  <p className="font-medium">AI 简介（推断内容，需人工确认）</p>
                  <p className="mt-1 text-sm">{ai.summary.summary}</p>
                  {ai.summary.highlights.length > 0 && (
                    <ul className="mt-2 list-disc pl-5 text-sm">
                      {ai.summary.highlights.map((highlight) => (
                        <li key={highlight}>{highlight}</li>
                      ))}
                    </ul>
                  )}
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5" /> 内容预览与编辑
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-[220px_1fr]">
              <div className="flex flex-col gap-1">
                {documents.map((document) => (
                  <button
                    key={document.slug}
                    type="button"
                    onClick={() => setSelectedSlug(document.slug)}
                    className={`rounded-md px-2 py-1 text-left text-sm ${
                      activeDocument?.slug === document.slug ? 'bg-secondary font-medium' : 'hover:bg-muted'
                    }`}
                  >
                    {document.title}
                    <span className="ml-1 text-xs text-muted-foreground">{document.origin === 'repository' ? '仓库' : '已编辑'}</span>
                  </button>
                ))}
                {documents.length === 0 && <p className="text-sm text-muted-foreground">没有找到 Markdown 文档。</p>}
              </div>

              <div className="flex flex-col gap-3">
                {activeDocument ? (
                  <>
                    <div className="flex items-center justify-between">
                      <Label>标题</Label>
                      <Button variant="outline" size="sm" onClick={() => setShowPreview((value) => !value)}>
                        {showPreview ? '继续编辑' : '预览渲染效果'}
                      </Button>
                    </div>
                    {showPreview ? (
                      <div
                        className="markdown-preview min-h-[320px] rounded-md border border-border p-4"
                        // The HTML comes from the sanitized Markdown renderer, never from raw input.
                        dangerouslySetInnerHTML={{ __html: previewHtml }}
                      />
                    ) : (
                      <>
                        <Input
                          value={activeDocument.title}
                          onChange={(event) => handleEdit(activeDocument.slug, { title: event.target.value })}
                        />
                        <Textarea
                          className="min-h-[320px] font-mono text-xs"
                          value={activeDocument.contentMarkdown}
                          onChange={(event) =>
                            handleEdit(activeDocument.slug, { contentMarkdown: event.target.value })
                          }
                        />
                      </>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">{activeDocument.sourcePath ?? 'AI 生成'}</Badge>
                      <Badge variant="secondary">{activeDocument.verification}</Badge>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">选择左侧文档进行预览与编辑。</p>
                )}
                <div>
                  <Button variant="outline" onClick={reAudit}>
                    <ShieldCheck className="h-4 w-4" /> 重新审计
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShieldCheck className="h-5 w-5" /> 审计结果
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {!audit && <p className="text-sm text-muted-foreground">尚未审计。</p>}
              {audit && audit.issues.length === 0 && (
                <Alert tone="success">
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" /> 未发现阻断项或警告项。
                  </span>
                </Alert>
              )}
              {blockingIssues.length > 0 && (
                <Alert tone="danger">
                  <p className="font-medium">阻断项（{blockingIssues.length}）——必须修复后才能导出</p>
                  <ul className="mt-2 list-disc pl-5 text-sm">
                    {blockingIssues.map((issue) => (
                      <li key={issue.id}>
                        {issue.message}
                        {issue.target ? <span className="text-muted-foreground"> ({issue.target})</span> : null}
                      </li>
                    ))}
                  </ul>
                </Alert>
              )}
              {warningIssues.length > 0 && (
                <Alert tone="warning">
                  <p className="font-medium">警告项（{warningIssues.length}）</p>
                  <ul className="mt-2 list-disc pl-5 text-sm">
                    {warningIssues.map((issue) => (
                      <li key={issue.id}>
                        {issue.message}
                        {issue.target ? <span className="text-muted-foreground"> ({issue.target})</span> : null}
                      </li>
                    ))}
                  </ul>
                </Alert>
              )}

              <Separator />

              <div className="flex flex-col gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant={licenseMissing ? 'destructive' : 'secondary'}>
                    许可证：{metadata.license?.identifier ?? (licenseMissing ? '未发现' : '不确定')}
                  </Badge>
                  {metadata.license?.sourcePath && (
                    <span className="text-xs text-muted-foreground">来源：{metadata.license.sourcePath}</span>
                  )}
                </div>
                {licenseMissing && (
                  <Alert tone="warning">
                    <p>仓库中未发现 LICENSE 文件。未发现许可证不等于允许自由复制或再分发，请确认你拥有相应权利。</p>
                    <label className="mt-2 flex items-start gap-2">
                      <Checkbox checked={licenseAccepted} onChange={(event) => setLicenseAccepted(event.target.checked)} />
                      <span>我确认有权使用并发布该仓库内容，并知悉许可证风险。</span>
                    </label>
                  </Alert>
                )}
                {warningIssues.length > 0 && (
                  <label className="flex items-start gap-2">
                    <Checkbox checked={warningsAccepted} onChange={(event) => setWarningsAccepted(event.target.checked)} />
                    <span>我已查看上述警告项，并理解相关风险。</span>
                  </label>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Download className="h-5 w-5" /> 生成与导出
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                生成过程使用固定模板，输出可独立部署的静态站点（HTML / Markdown / JSON 索引 / llms.txt / sitemap.xml）。
              </p>
              {exportError && <Alert tone="danger">{exportError}</Alert>}
              {externalImageNote && <Alert tone="info">{externalImageNote}</Alert>}
              {exportSummary && (
                <Alert tone="success">
                  已生成 {exportSummary.fileCount} 个文件，共 {(exportSummary.totalBytes / 1024).toFixed(1)} KB。
                </Alert>
              )}
              <div>
                <Button onClick={handleExport} disabled={!canExport || exporting}>
                  {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  生成并下载 ZIP
                </Button>
                {!canExport && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {blockingIssues.length > 0
                      ? '存在阻断项，需先修复。'
                      : licenseMissing && !licenseAccepted
                        ? '需要明确确认许可证风险后才能继续。'
                        : '需要确认警告项后才能继续。'}
                  </p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                <a
                  className="inline-flex items-center gap-1 underline"
                  href="https://github.com/"
                  target="_blank"
                  rel="noreferrer"
                >
                  目标站点
                  <ExternalLink className="h-3 w-3" />
                </a>
                <span> · 导出包中不包含任何 API Key 或服务端配置。</span>
              </p>
            </CardContent>
          </Card>
        </>
      )}

      {!content && (
        <Alert tone="info">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> 先输入公开仓库地址并读取内容，再进行预览、审计与导出。
          </span>
        </Alert>
      )}
    </div>
  );
}
