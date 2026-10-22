import { useEffect, useState } from 'react';
import { Eraser, Save } from 'lucide-react';

import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Separator } from './ui/primitives';
import { clearSettings, loadSettings, saveSettings } from '@/lib/settings';
import type { AIKeyMode, AIProviderName, GenerationLanguage } from '@/lib/schema';

export default function ConfigPanel() {
  const [provider, setProvider] = useState<AIProviderName>('deepseek');
  const [keyMode, setKeyMode] = useState<AIKeyMode>('server');
  const [language, setLanguage] = useState<GenerationLanguage>('zh-CN');
  const [downloadExternalImages, setDownloadExternalImages] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const settings = loadSettings();
    setProvider(settings.preferredProvider);
    setKeyMode(settings.preferredKeyMode);
    setLanguage(settings.targetLanguage);
    setDownloadExternalImages(settings.downloadExternalImages);
  }, []);

  const handleSave = () => {
    saveSettings({ provider, keyMode, language, downloadExternalImages } as never);
    setSaved(true);
  };

  const handleClear = () => {
    clearSettings();
    setProvider('deepseek');
    setKeyMode('server');
    setLanguage('zh-CN');
    setDownloadExternalImages(false);
    setSaved(false);
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>AI 与生成偏好</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Alert tone="info">
            这里只保存非敏感偏好。API Key 永远不会写入本地存储、URL、日志或导出的 ZIP；使用自带 Key 时，Key 只存在于当前页面的内存中。
          </Alert>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cfg-provider">AI 服务商</Label>
            <select
              id="cfg-provider"
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={provider}
              onChange={(event) => setProvider(event.target.value as AIProviderName)}
            >
              <option value="deepseek">DeepSeek</option>
              <option value="minimax">MiniMax</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cfg-keymode">API Key 模式</Label>
            <select
              id="cfg-keymode"
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={keyMode}
              onChange={(event) => setKeyMode(event.target.value as AIKeyMode)}
            >
              <option value="server">服务端配置 Key</option>
              <option value="byok">使用我自己的 Key</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cfg-language">默认生成语言</Label>
            <select
              id="cfg-language"
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={language}
              onChange={(event) => setLanguage(event.target.value as GenerationLanguage)}
            >
              <option value="zh-CN">中文</option>
              <option value="en-US">English</option>
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border border-input"
              checked={downloadExternalImages}
              onChange={(event) => setDownloadExternalImages(event.target.checked)}
            />
            默认下载外部图片到本地
          </label>

          <Separator />

          <div className="flex items-center gap-2">
            <Button onClick={handleSave}>
              <Save className="h-4 w-4" /> 保存偏好
            </Button>
            <Button variant="outline" onClick={handleClear}>
              <Eraser className="h-4 w-4" /> 恢复默认
            </Button>
            {saved && <span className="text-sm text-muted-foreground">已保存到本地。</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>服务端环境变量</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>在 Netlify 中配置以下变量后，服务端模式即可使用（详见 .env.example）：</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
{`DEEPSEEK_API_KEY=
MINIMAX_API_KEY=
DEFAULT_GENERATION_LANGUAGE=zh-CN
AI_MAX_INPUT_BYTES=524288
AI_MAX_OUTPUT_TOKENS=8192`}
          </pre>
          <p>浏览器永远不会读到这些值；请勿把真实密钥提交到 Git 仓库。</p>
        </CardContent>
      </Card>
    </div>
  );
}
