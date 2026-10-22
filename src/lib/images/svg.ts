/**
 * Strict SVG sanitizer.
 *
 * Repository content is untrusted, so SVGs are never embedded verbatim. The sanitizer
 * re-builds the document from an allow-list of elements and attributes, dropping scripts,
 * event handlers, external references and animation elements.
 */

const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'title',
  'desc',
  'metadata',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textPath',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'pattern',
  'marker',
  'filter',
  'feBlend',
  'feColorMatrix',
  'feComposite',
  'feFlood',
  'feGaussianBlur',
  'feImage',
  'feMerge',
  'feMergeNode',
  'feOffset',
  'feDropShadow',
]);

/** Elements whose entire subtree is removed. */
const DROP_WITH_CONTENT = new Set([
  'script',
  'foreignObject',
  'style',
  'iframe',
  'object',
  'embed',
  'animate',
  'animateTransform',
  'animateMotion',
  'set',
  'handler',
  'listener',
]);

const GLOBAL_ATTRIBUTES = new Set([
  'class',
  'id',
  'style',
  'transform',
  'opacity',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'stroke-miterlimit',
  'color',
  'display',
  'visibility',
  'vector-effect',
  'paint-order',
  'shape-rendering',
  'text-anchor',
  'dominant-baseline',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'word-spacing',
  'text-decoration',
  'xmlns',
  'xmlns:xlink',
  'version',
  'viewBox',
  'preserveAspectRatio',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'transform-origin',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'patternUnits',
  'patternContentUnits',
  'clipPathUnits',
  'maskUnits',
  'maskContentUnits',
  'markerWidth',
  'markerHeight',
  'refX',
  'refY',
  'orient',
  'markerUnits',
  'filterUnits',
  'primitiveUnits',
  'in',
  'in2',
  'mode',
  'type',
  'values',
  'stdDeviation',
  'result',
  'flood-color',
  'flood-opacity',
  'baseFrequency',
  'numOctaves',
  'scale',
  'xChannelSelector',
  'yChannelSelector',
  'kernelMatrix',
  'operator',
  'k1',
  'k2',
  'k3',
  'k4',
  'divisor',
  'bias',
  'edgeMode',
  'pathLength',
  'startOffset',
  'method',
  'spacing',
  'side',
  'textLength',
  'lengthAdjust',
  'font-variant',
  'writing-mode',
  'baseline-shift',
  'text-rendering',
  'shape-inside',
]);

const TAG_PATTERN = /<\s*(\/?)\s*([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)\s*(\/?)\s*>/g;
const ATTRIBUTE_PATTERN = /([a-zA-Z_:][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

export interface SvgSanitizeResult {
  svg: string;
  changed: boolean;
  removedElements: string[];
}

/** Sanitizes an SVG document, keeping only safe, static drawing content. */
export function sanitizeSvg(input: string): SvgSanitizeResult {
  const removedElements = new Set<string>();
  let output = '';
  let lastIndex = 0;
  let skipDepth = 0;
  let skipTag = '';
  let changed = false;

  const source = input
    // Remove XML declarations, doctypes and processing instructions (XXE / entity tricks).
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!ENTITY[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  TAG_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_PATTERN.exec(source)) !== null) {
    const [full, closing, rawName, rawAttributes, selfClosing] = match;
    const name = rawName.toLowerCase();

    if (skipDepth > 0) {
      if (!closing && !selfClosing && name === skipTag) skipDepth += 1;
      if (closing && name === skipTag) skipDepth -= 1;
      if (skipDepth === 0) skipTag = '';
      changed = true;
      continue;
    }

    if (DROP_WITH_CONTENT.has(name)) {
      changed = true;
      removedElements.add(name);
      if (!closing && !selfClosing) {
        skipDepth = 1;
        skipTag = name;
      }
      continue;
    }

    if (!ALLOWED_ELEMENTS.has(name)) {
      changed = true;
      removedElements.add(name);
      continue;
    }

    if (closing) {
      output += source.slice(lastIndex, match.index) + `</${name}>`;
      lastIndex = match.index + full.length;
      continue;
    }

    const attributes = sanitizeAttributes(rawAttributes ?? '');
    if (attributes !== (rawAttributes ?? '')) changed = true;

    const open = `<${name}${attributes}${selfClosing ? ' /' : ''}>`;
    output += source.slice(lastIndex, match.index) + open;
    lastIndex = match.index + full.length;
  }

  output += source.slice(lastIndex);
  return { svg: output.trim(), changed, removedElements: [...removedElements] };
}

function sanitizeAttributes(raw: string): string {
  const kept: string[] = [];
  ATTRIBUTE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE_PATTERN.exec(raw)) !== null) {
    const name = match[1]!;
    const value = match[3] ?? match[4] ?? match[5] ?? '';
    const lower = name.toLowerCase();

    if (lower.startsWith('on')) continue; // event handlers
    if (lower === 'xmlns' || lower === 'xmlns:xlink') {
      kept.push(`${name}="${escapeAttribute(value)}"`);
      continue;
    }
    if (lower === 'href' || lower === 'xlink:href' || lower === 'src') {
      if (!isSafeReference(value)) continue;
      kept.push(`${name}="${escapeAttribute(value)}"`);
      continue;
    }
    if (!GLOBAL_ATTRIBUTES.has(lower)) continue;
    if (/url\s*\(\s*['"]?\s*(javascript|data|vbscript):/i.test(value)) continue;
    kept.push(`${name}="${escapeAttribute(value)}"`);
  }
  return kept.length ? ` ${kept.join(' ')}` : '';
}

function isSafeReference(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('#')) return true;
  if (/^(javascript|data|vbscript|file|blob):/i.test(trimmed)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false; // any absolute scheme
  if (trimmed.startsWith('//')) return false;
  return true;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
