import { describe, expect, it } from 'vitest';
import { sanitizeSvg } from '@/lib/images/svg';

describe('sanitizeSvg', () => {
  it('removes script elements', () => {
    const result = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect /></svg>');
    expect(result.svg).not.toContain('script');
    expect(result.svg).toContain('rect');
    expect(result.removedElements).toContain('script');
  });

  it('removes event handler attributes', () => {
    const result = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect onload="alert(1)" /></svg>');
    expect(result.svg).not.toContain('onload');
  });

  it('removes javascript: links', () => {
    const result = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect /></a></svg>',
    );
    expect(result.svg).not.toContain('javascript:');
  });

  it('removes foreignObject and style blocks', () => {
    const result = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>x</div></foreignObject><style>*{}</style></svg>',
    );
    expect(result.svg).not.toContain('foreignObject');
    expect(result.svg).not.toContain('<style');
  });

  it('keeps safe shapes and attributes', () => {
    const result = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="red" /></svg>',
    );
    expect(result.svg).toContain('circle');
    expect(result.svg).toContain('viewBox="0 0 10 10"');
    expect(result.svg).toContain('fill="red"');
  });

  it('keeps camelCase SVG attributes such as viewBox and preserveAspectRatio', () => {
    const result = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet"><path d="M0 0h24v24H0z" /></svg>',
    );
    expect(result.svg).toContain('viewBox="0 0 24 24"');
    expect(result.svg).toContain('preserveAspectRatio="xMidYMid meet"');
  });

  it('drops xml declarations, doctypes and entity declarations', () => {
    const result = sanitizeSvg(
      '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>',
    );
    expect(result.svg).not.toContain('DOCTYPE');
    expect(result.svg).not.toContain('ENTITY');
    expect(result.svg).not.toContain('<?xml');
  });
});
