import { describe, expect, it } from 'vitest';
import { detectLicense, identifyLicense } from '@/lib/content/license';

describe('detectLicense', () => {
  it('reports a missing license', () => {
    expect(detectLicense(['src/index.ts', 'README.md'])).toEqual({ status: 'missing' });
  });

  it('detects a license file in the repository root', () => {
    const result = detectLicense(['LICENSE', 'README.md'], () => 'MIT License\n\nPermission is hereby granted');
    expect(result.status).toBe('detected');
    expect(result.identifier).toBe('MIT');
    expect(result.sourcePath).toBe('LICENSE');
  });

  it('marks an unknown license file as uncertain', () => {
    const result = detectLicense(['LICENSE.md'], () => 'some custom terms');
    expect(result.status).toBe('uncertain');
    expect(result.sourcePath).toBe('LICENSE.md');
  });

  it('ignores license files that are nested too deeply', () => {
    expect(detectLicense(['a/b/c/LICENSE']).status).toBe('missing');
  });
});

describe('identifyLicense', () => {
  it('recognizes common SPDX identifiers', () => {
    expect(identifyLicense('Apache License\nVersion 2.0, January 2004')).toBe('Apache-2.0');
    expect(identifyLicense('GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007')).toBe('GPL-3.0');
    expect(identifyLicense('Mozilla Public License Version 2.0')).toBe('MPL-2.0');
    expect(identifyLicense('Permission to use, copy, modify, and/or distribute this software')).toBe('ISC');
  });

  it('returns undefined for unknown text', () => {
    expect(identifyLicense('nothing to see here')).toBeUndefined();
  });
});
