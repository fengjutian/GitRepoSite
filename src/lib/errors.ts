export type ErrorCode =
  | 'INVALID_REPOSITORY_URL'
  | 'INVALID_PATH'
  | 'PATH_TRAVERSAL'
  | 'GITHUB_ERROR'
  | 'GITHUB_RATE_LIMIT'
  | 'GITHUB_TRUNCATED_TREE'
  | 'CONTENT_TOO_LARGE'
  | 'IMAGE_LIMIT_EXCEEDED'
  | 'UNSAFE_HTML'
  | 'UNSAFE_URL'
  | 'AI_CONFIGURATION_ERROR'
  | 'AI_PROVIDER_ERROR'
  | 'AI_INVALID_RESPONSE'
  | 'AI_RATE_LIMITED'
  | 'AI_INPUT_TOO_LARGE'
  | 'AI_LANGUAGE_MISMATCH'
  | 'LICENSE_MISSING'
  | 'BLOCKING_ISSUES'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

export interface RepoSiteErrorOptions {
  status?: number;
  details?: unknown;
}

export class RepoSiteError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, options: RepoSiteErrorOptions = {}) {
    super(message);
    this.name = 'RepoSiteError';
    this.code = code;
    this.status = options.status ?? defaultStatusFor(code);
    this.details = options.details;
  }

  toPayload(): { error: { code: ErrorCode; message: string } } {
    return { error: { code: this.code, message: this.message } };
  }
}

function defaultStatusFor(code: ErrorCode): number {
  switch (code) {
    case 'INVALID_REPOSITORY_URL':
    case 'INVALID_PATH':
    case 'PATH_TRAVERSAL':
    case 'VALIDATION_ERROR':
      return 400;
    case 'LICENSE_MISSING':
    case 'BLOCKING_ISSUES':
      return 409;
    case 'GITHUB_RATE_LIMIT':
    case 'AI_RATE_LIMITED':
      return 429;
    case 'AI_CONFIGURATION_ERROR':
      return 400;
    case 'GITHUB_ERROR':
    case 'AI_PROVIDER_ERROR':
    case 'AI_INVALID_RESPONSE':
      return 502;
    case 'CONTENT_TOO_LARGE':
      return 413;
    default:
      return 500;
  }
}

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_\-]{12,}/g,
  /Bearer\s+[A-Za-z0-9._\-]{12,}/gi,
  /("?(?:api[_-]?key|authorization|token|secret)"?\s*[:=]\s*"?)([^"'\s,}]{6,})/gi,
];

/** Removes anything that looks like a credential from a string before it is logged. */
export function redactSecrets(input: string): string {
  let out = input;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, prefix?: string) =>
      typeof prefix === 'string' ? `${prefix}***` : '***',
    );
  }
  return out;
}

export function toErrorPayload(error: unknown): { status: number; body: { error: { code: ErrorCode; message: string } } } {
  if (error instanceof RepoSiteError) {
    return { status: error.status, body: error.toPayload() };
  }
  const message = error instanceof Error ? redactSecrets(error.message) : 'Unexpected error';
  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message } },
  };
}

export function isRepoSiteError(error: unknown): error is RepoSiteError {
  return error instanceof RepoSiteError;
}
