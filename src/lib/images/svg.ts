/**
 * Strict SVG sanitizer.
 *
 * Repository content is untrusted, so SVGs are never embedded verbatim. The sanitizer
 * re-builds the document from an allow-list of elements and attributes, dropping scripts,
 * event handlers, external references and animation elements.
 *
 * Element names are compared case-insensitively (the allow-list is lower-cased) but the
 * original spelling is preserved in the output, because SVG element names such as
 * `linearGradient` are case sensitive in XML.
 */

const ALLOWED_ELEMENTS = new Set(
  [
    'svg',
    'g',
    'defs',
    'symbol',
    'use',
    'title',
    'desc',
    'metadata',
    'a',
    'image',
    'switch',
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
  ].map((name) => name.toLowerCase()),
);

/** Elements whose entire subtree is removed. */
const DROP_WITH_CONTENT = new Set(
  [
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
  ].map((name) => name.toLowerCase()),
);

/** Elements that may only reference local, relative resources. */
const RESOURCE_ELEMENTS = new Set([
  'image',
  'use',
  'feimage',
  'textpath',
  'mpath',
  'filter',
  'pattern',
  'mask',
  'lineargradient',
  'radialgradient',
]);

const GLOBAL_ATTRIBUTES = new Set<string>(
  [
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
    'patternTransform',
    'clipPathUnits',
    'maskUnits',
    'maskContentUnits',
    'clip-path',
    'mask',
    'filter',
    'markerWidth',
    'markerHeight',
    'marker-start',
    'marker-mid',
    'marker-end',
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
  ].map((name) => name.toLowerCase()),
);

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
  let changed = false;

  const source = input
    // Remove XML declarations, doctypes and processing instructions (XXE / entity tricks).
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!ENTITY[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // Depth of the currently dropped subtree (0 = nothing is being dropped).
  let skipDepth = 0;
  let skipTag = '';

  TAG_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_PATTERN.exec(source)) !== null) {
    const [full, closing, rawName, rawAttributes, selfClosing] = match;
    const name = rawName.toLowerCase();
    const isClosing = closing === '/';

    if (skipDepth > 0) {
      // Inside a dropped subtree: swallow everything until the matching closing tag.
      if (!isClosing && !selfClosing && name === skipTag) {
        skipDepth += 1;
      } else if (isClosing && name === skipTag) {
        skipDepth -= 1;
        if (skipDepth === 0) {
          skipTag = '';
          lastIndex = match.index + full.length;
        }
      }
      continue;
    }

    if (DROP_WITH_CONTENT.has(name)) {
      changed = true;
      removedElements.add(name);
      if (!isClosing && !selfClosing) {
        skipDepth = 1;
        skipTag = name;
      } else {
        lastIndex = match.index + full.length;
      }
      continue;
    }

    if (!ALLOWED_ELEMENTS.has(name)) {
      // Unknown element: drop the tag itself, keep the (text) content.
      changed = true;
      removedElements.add(name);
      lastIndex = match.index + full.length;
      continue;
    }

    if (isClosing) {
      output += source.slice(lastIndex, match.index) + `</${rawName}>`;
      lastIndex = match.index + full.length;
      continue;
    }

    const attributes = sanitizeAttributes(rawAttributes ?? '', name);
    if (attributes !== (rawAttributes ?? '')) changed = true;

    const open = `<${rawName}${attributes}${selfClosing ? ' /' : ''}>`;
    output += source.slice(lastIndex, match.index) + open;
    lastIndex = match.index + full.length;
  }

  // An unterminated dropped element swallows the rest of the document.
  output += skipDepth > 0 ? '' : source.slice(lastIndex);

  return { svg: output.trim(), changed, removedElements: [...removedElements] };
}

function sanitizeAttributes(raw: string, elementName: string): string {
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
      if (!isSafeReference(value, elementName)) continue;
      kept.push(`${name}="${escapeAttribute(value)}"`);
      continue;
    }
    if (!GLOBAL_ATTRIBUTES.has(lower)) continue;
    if (/url\s*\(\s*['"]?\s*(javascript|data|vbscript):/i.test(value)) continue;
    kept.push(`${name}="${escapeAttribute(value)}"`);
  }
  return kept.length ? ` ${kept.join(' ')}` : '';
}

function isSafeReference(value: string, elementName: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('#')) return true;
  if (/^(javascript|data|vbscript|file|blob):/i.test(trimmed)) return false;
  if (trimmed.startsWith('//')) return false; // protocol relative
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    // Absolute URLs are only allowed for plain hyperlinks.
    if (elementName !== 'a') return false;
    return /^(https?|mailto):/i.test(trimmed);
  }
  return true; // relative path inside the generated site
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
