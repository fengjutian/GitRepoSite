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

  it('keeps camelCase element names such as linearGradient and clipPath', () => {
    const result = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient><clipPath id="c"><rect width="4" height="4"/></clipPath></defs><rect fill="url(#g)" clip-path="url(#c)"/></svg>',
    );
    expect(result.svg).toContain('<linearGradient id="g">');
    expect(result.svg).toContain('</linearGradient>');
    expect(result.svg).toContain('<clipPath id="c">');
    expect(result.svg).toContain('clip-path="url(#c)"');
  });

  it('keeps local relative image references but drops remote resource references', () => {
    const local = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="images/logo.png" width="10" height="10"/></svg>',
    );
    expect(local.svg).toContain('href="images/logo.png"');

    const remote = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://cdn.example.com/tracker.png" width="10" height="10"/></svg>',
    );
    expect(remote.svg).not.toContain('cdn.example.com');
  });

  it('keeps ordinary hyperlinks but never javascript or data URLs', () => {
    const link = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://example.com/docs"><rect width="4" height="4"/></a></svg>',
    );
    expect(link.svg).toContain('href="https://example.com/docs"');

    const data = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="data:text/html,<script>alert(1)</script>"><rect /></a></svg>',
    );
    expect(data.svg).not.toContain('data:');
  });

  it('drops animation elements that can rewrite attributes at runtime', () => {
    const result = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect><animate attributeName="href" to="javascript:alert(1)"/></rect></svg>',
    );
    expect(result.svg).not.toContain('animate');
  });
});
