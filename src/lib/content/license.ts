import type { LicenseStatus } from '../schema';

export interface LicenseDetection {
  identifier?: string;
  sourcePath?: string;
  status: LicenseStatus;
}

const LICENSE_BASENAMES = [
  'license',
  'licence',
  'license.md',
  'license.txt',
  'license.rst',
  'licence.md',
  'licence.txt',
  'copying',
  'copying.md',
  'unlicense',
];

const SPDX_PATTERNS: Array<{ identifier: string; patterns: RegExp[] }> = [
  {
    identifier: 'MIT',
    patterns: [/mit license/i, /permission is hereby granted, free of charge, to any person obtaining a copy/i],
  },
  {
    identifier: 'Apache-2.0',
    patterns: [/apache license\s*\n?\s*version 2\.0/i, /apache license, version 2\.0/i],
  },
  {
    identifier: 'GPL-3.0',
    patterns: [/gnu general public license\s*\n?\s*version 3/i],
  },
  {
    identifier: 'GPL-2.0',
    patterns: [/gnu general public license\s*\n?\s*version 2/i],
  },
  {
    identifier: 'AGPL-3.0',
    patterns: [/gnu affero general public license/i],
  },
  {
    identifier: 'LGPL-3.0',
    patterns: [/gnu lesser general public license/i],
  },
  {
    identifier: 'MPL-2.0',
    patterns: [/mozilla public license version 2\.0/i],
  },
  {
    identifier: 'BSD-3-Clause',
    patterns: [/redistribution and use in source and binary forms/i, /neither the name/i],
  },
  {
    identifier: 'BSD-2-Clause',
    patterns: [/redistribution and use in source and binary forms/i],
  },
  {
    identifier: 'ISC',
    patterns: [/permission to use, copy, modify, and\/or distribute this software/i],
  },
  {
    identifier: 'Unlicense',
    patterns: [/this is free and unencumbered software released into the public domain/i],
  },
  {
    identifier: 'CC0-1.0',
    patterns: [/creative commons legal code/i, /cc0 1\.0 universal/i],
  },
];

/** Detects a license file in the repository tree and tries to identify its SPDX identifier. */
export function detectLicense(
  treePaths: string[],
  readFile?: (path: string) => string | undefined,
): LicenseDetection {
  const candidates = treePaths
    .filter((path) => {
      const base = path.split('/').pop()?.toLowerCase() ?? '';
      const depth = path.split('/').length;
      return LICENSE_BASENAMES.includes(base) && depth <= 2;
    })
    .sort((a, b) => {
      const depthDiff = a.split('/').length - b.split('/').length;
      if (depthDiff !== 0) return depthDiff;
      return a.localeCompare(b);
    });

  if (candidates.length === 0) {
    return { status: 'missing' };
  }

  const sourcePath = candidates[0]!;
  const text = readFile?.(sourcePath) ?? '';
  const identifier = identifyLicense(text);
  if (!identifier) {
    return { sourcePath, status: 'uncertain' };
  }
  return { identifier, sourcePath, status: 'detected' };
}

/** Maps license text to a best-effort SPDX identifier. */
export function identifyLicense(text: string): string | undefined {
  if (!text || text.length < 20) return undefined;
  const head = text.slice(0, 4000);
  for (const candidate of SPDX_PATTERNS) {
    if (candidate.patterns.some((pattern) => pattern.test(head))) {
      return candidate.identifier;
    }
  }
  return undefined;
}
