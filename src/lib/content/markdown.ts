import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSlug from 'rehype-slug';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';

export interface Heading {
  id: string;
  text: string;
  depth: number;
}

export interface MarkdownLink {
  href: string;
  text: string;
  kind: 'internal' | 'external' | 'anchor' | 'mail';
}

export interface MarkdownImage {
  src: string;
  alt: string;
}

export interface RenderedMarkdown {
  html: string;
  headings: Heading[];
  links: MarkdownLink[];
  images: MarkdownImage[];
  plainText: string;
}

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [['className', /^language-[\w-]+$/]],
    img: [...(defaultSchema.attributes?.img ?? []), 'loading'],
    a: [...(defaultSchema.attributes?.a ?? []), 'rel'],
  },
  tagNames: [...(defaultSchema.tagNames ?? []), 'figure', 'figcaption', 'details', 'summary', 'mark'],
};

interface ShikiHighlighter {
  codeToHtml(code: string, options: { lang: string; theme: string }): string;
  loadLanguage(language: unknown): Promise<void>;
}

/** Languages that are bundled with the generator; everything else stays plain text. */
const LANGUAGE_LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  bash: () => import('shiki/dist/langs/bash.mjs'),
  c: () => import('shiki/dist/langs/c.mjs'),
  cpp: () => import('shiki/dist/langs/cpp.mjs'),
  csharp: () => import('shiki/dist/langs/csharp.mjs'),
  css: () => import('shiki/dist/langs/css.mjs'),
  diff: () => import('shiki/dist/langs/diff.mjs'),
  dockerfile: () => import('shiki/dist/langs/dockerfile.mjs'),
  go: () => import('shiki/dist/langs/go.mjs'),
  html: () => import('shiki/dist/langs/html.mjs'),
  java: () => import('shiki/dist/langs/java.mjs'),
  javascript: () => import('shiki/dist/langs/javascript.mjs'),
  json: () => import('shiki/dist/langs/json.mjs'),
  jsx: () => import('shiki/dist/langs/jsx.mjs'),
  markdown: () => import('shiki/dist/langs/markdown.mjs'),
  php: () => import('shiki/dist/langs/php.mjs'),
  python: () => import('shiki/dist/langs/python.mjs'),
  ruby: () => import('shiki/dist/langs/ruby.mjs'),
  rust: () => import('shiki/dist/langs/rust.mjs'),
  shell: () => import('shiki/dist/langs/shell.mjs'),
  sql: () => import('shiki/dist/langs/sql.mjs'),
  tsx: () => import('shiki/dist/langs/tsx.mjs'),
  typescript: () => import('shiki/dist/langs/typescript.mjs'),
  xml: () => import('shiki/dist/langs/xml.mjs'),
  yaml: () => import('shiki/dist/langs/yaml.mjs'),
};

const loadedLanguages = new Set<string>();

let shikiHighlighterPromise: Promise<ShikiHighlighter | null> | null = null;

/** Renders Markdown to sanitized HTML. Raw HTML in the source is dropped, never executed. */
export async function renderMarkdown(
  markdown: string,
  options: { highlight?: boolean } = {},
): Promise<RenderedMarkdown> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeSanitize, sanitizeSchema as never)
    .use(rehypeShiki, { enabled: options.highlight !== false })
    .use(rehypeStringify, { allowDangerousHtml: true });

  const mdast = processor.parse(markdown ?? '');
  const hast = (await processor.run(mdast)) as unknown as HastNode;
  const html = String(await processor.stringify(hast as never));

  const headings: Heading[] = [];
  const links: MarkdownLink[] = [];
  const images: MarkdownImage[] = [];

  walkHast(hast, (node) => {
    if (node.type !== 'element' || !node.tagName) return;
    const tag = node.tagName;
    if (/^h[1-6]$/.test(tag)) {
      headings.push({
        id: String(node.properties?.id ?? ''),
        text: textContent(node),
        depth: Number(tag.slice(1)),
      });
    }
    if (tag === 'a') {
      const href = String(node.properties?.href ?? '');
      links.push({ href, text: textContent(node), kind: classifyLink(href) });
    }
    if (tag === 'img') {
      images.push({ src: String(node.properties?.src ?? ''), alt: String(node.properties?.alt ?? '') });
    }
  });

  return { html, headings, links, images, plainText: htmlToPlainText(html) };
}

function classifyLink(href: string): MarkdownLink['kind'] {
  if (!href) return 'internal';
  if (href.startsWith('#')) return 'anchor';
  if (/^mailto:/i.test(href)) return 'mail';
  if (/^https?:\/\//i.test(href)) return 'external';
  return 'internal';
}

/** Lightweight link extraction used by the link audit (no HTML rendering required). */
export function extractMarkdownLinks(markdown: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  const pattern = /(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match = pattern.exec(markdown);
  while (match) {
    const href = match[3] ?? '';
    links.push({ href, text: match[2] ?? '', kind: classifyLink(href) });
    match = pattern.exec(markdown);
  }
  return links;
}

function rehypeShiki(options: { enabled: boolean }) {
  return async (tree: HastNode) => {
    if (!options.enabled) return tree;
    const highlighter = await loadShiki();
    if (!highlighter) return tree;

    const blocks: Array<{ node: HastNode; parent: HastNode; code: HastNode }> = [];
    walkHast(tree, (node, parent) => {
      if (!parent || node.type !== 'element' || node.tagName !== 'pre') return;
      const code = node.children?.find((child) => child.type === 'element' && child.tagName === 'code');
      if (!code) return;
      blocks.push({ node, parent, code });
    });

    for (const block of blocks) {
      const source = textContent(block.code);
      if (!source.trim()) continue;
      const lang = detectLanguage(block.code);
      if (!(await ensureLanguage(highlighter, lang))) continue;
      try {
        const highlighted = highlighter.codeToHtml(source, {
          lang,
          theme: 'github-dark',
        });
        block.parent.children = (block.parent.children ?? []).map((child) =>
          child === block.node ? { type: 'raw', value: highlighted } : child,
        );
      } catch {
        // Unknown language: keep the sanitized plain code block.
      }
    }

    return tree;
  };
}

function detectLanguage(code: HastNode): string {
  const className = code.properties?.className;
  const classes = Array.isArray(className) ? className.map(String) : [];
  const match = classes.find((value) => value.startsWith('language-'));
  return match ? match.slice('language-'.length).toLowerCase() : 'text';
}

async function loadShiki(): Promise<ShikiHighlighter | null> {
  if (!shikiHighlighterPromise) {
    shikiHighlighterPromise = (async () => {
      try {
        const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, { bundledThemes }] = await Promise.all([
          import('shiki/core'),
          import('shiki/engine/javascript'),
          import('shiki/themes'),
        ]);
        return (await createHighlighterCore({
          themes: [bundledThemes['github-dark']],
          langs: [],
          engine: createJavaScriptRegexEngine(),
        })) as unknown as ShikiHighlighter;
      } catch {
        return null;
      }
    })();
  }
  return shikiHighlighterPromise;
}

/** Loads a language grammar on demand; unknown languages stay unhighlighted. */
async function ensureLanguage(highlighter: ShikiHighlighter, lang: string): Promise<boolean> {
  const loader = LANGUAGE_LOADERS[lang];
  if (!loader) return false;
  if (!loadedLanguages.has(lang)) {
    try {
      const module = await loader();
      await highlighter.loadLanguage(module.default);
      loadedLanguages.add(lang);
    } catch {
      return false;
    }
  }
  return true;
}

export function walkHast(
  node: HastNode,
  visitor: (node: HastNode, parent?: HastNode) => void,
  parent?: HastNode,
): void {
  visitor(node, parent);
  for (const child of node.children ?? []) {
    walkHast(child, visitor, node);
  }
}

function textContent(node: HastNode): string {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map((child) => textContent(child)).join('');
}

/** Small HTML to text reducer used for llms.txt and search summaries. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|pre|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Plain-text summary of a Markdown document (headings + first paragraph). */
export function markdownToPlainText(markdown: string, maxLength = 600): string {
  const lines: string[] = [];
  let length = 0;
  for (const rawLine of (markdown ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('```') || line.startsWith('~~~')) continue;
    if (/^!\[/.test(line)) continue;
    const cleaned = line
      .replace(/^#{1,6}\s*/, '')
      .replace(/^>\s*/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+\.\s+/, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
      .trim();
    if (!cleaned) continue;
    lines.push(cleaned);
    length += cleaned.length;
    if (length > maxLength) break;
  }
  const text = lines.join(' ').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
