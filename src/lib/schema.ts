import { z } from 'zod';

/** Target language of a single generation task. One language per task, never bilingual. */
export const generationLanguageSchema = z.enum(['zh-CN', 'en-US']);
export type GenerationLanguage = z.infer<typeof generationLanguageSchema>;

export const aiProviderNameSchema = z.enum(['deepseek', 'minimax']);
export type AIProviderName = z.infer<typeof aiProviderNameSchema>;

export const aiKeyModeSchema = z.enum(['server', 'byok']);
export type AIKeyMode = z.infer<typeof aiKeyModeSchema>;

export const originSchema = z.enum(['repository', 'ai_generated', 'user_edited']);
export type ContentOrigin = z.infer<typeof originSchema>;

export const verificationSchema = z.enum(['source_verified', 'ai_inferred', 'human_verified']);
export type VerificationStatus = z.infer<typeof verificationSchema>;

export const licenseStatusSchema = z.enum(['detected', 'missing', 'uncertain']);
export type LicenseStatus = z.infer<typeof licenseStatusSchema>;

export const assetHandlingSchema = z.enum(['copied', 'linked', 'downloaded', 'skipped']);
export type AssetHandling = z.infer<typeof assetHandlingSchema>;

export const assetAuditStatusSchema = z.enum(['passed', 'warning', 'failed']);
export type AssetAuditStatus = z.infer<typeof assetAuditStatusSchema>;

export const licenseInfoSchema = z.object({
  identifier: z.string().max(120).optional(),
  sourcePath: z.string().max(400).optional(),
  status: licenseStatusSchema,
  userConfirmedMissing: z.boolean().optional(),
});
export type LicenseInfo = z.infer<typeof licenseInfoSchema>;

export const projectMetadataSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  repositoryUrl: z.string().max(500),
  sourceCommitSha: z.string().regex(/^[0-9a-f]{7,40}$/),
  sourceLanguage: z.string().max(80).optional(),
  targetLanguage: generationLanguageSchema,
  generatedAt: z.string().max(40),
  homepage: z.string().max(500).optional(),
  topics: z.array(z.string().max(60)).max(30).default([]),
  stars: z.number().int().nonnegative().optional(),
  license: licenseInfoSchema.optional(),
});
export type ProjectMetadata = z.infer<typeof projectMetadataSchema>;

export const documentPageSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(300)
    .regex(/^[a-z0-9][a-z0-9._\-/]*$/i)
    .refine((v) => !v.includes('..'), 'slug must not contain ".."'),
  title: z.string().min(1).max(300),
  contentMarkdown: z.string().max(2_000_000),
  sourcePath: z.string().max(500).optional(),
  sourceCommitSha: z.string().max(64).optional(),
  origin: originSchema,
  verification: verificationSchema,
  order: z.number().int().min(0).max(9999).default(0),
  summary: z.string().max(600).optional(),
});
export type DocumentPage = z.infer<typeof documentPageSchema>;

export const assetRecordSchema = z.object({
  sourcePath: z.string().max(500).optional(),
  sourceUrl: z.string().max(2000).optional(),
  outputPath: z.string().max(500).optional(),
  type: z.enum(['image', 'other']),
  handling: assetHandlingSchema,
  auditStatus: assetAuditStatusSchema,
  mimeType: z.string().max(120).optional(),
  bytes: z.number().int().nonnegative().optional(),
  reason: z.string().max(500).optional(),
});
export type AssetRecord = z.infer<typeof assetRecordSchema>;

export const auditSeveritySchema = z.enum(['blocking', 'warning', 'info']);
export type AuditSeverity = z.infer<typeof auditSeveritySchema>;

export const auditCategorySchema = z.enum([
  'security',
  'path',
  'structure',
  'link',
  'image',
  'license',
  'source',
  'metadata',
  'ai',
]);
export type AuditCategory = z.infer<typeof auditCategorySchema>;

export const auditIssueSchema = z.object({
  id: z.string().min(1).max(120),
  severity: auditSeveritySchema,
  category: auditCategorySchema,
  message: z.string().min(1).max(1000),
  target: z.string().max(600).optional(),
  hint: z.string().max(600).optional(),
});
export type AuditIssue = z.infer<typeof auditIssueSchema>;

export const auditReportSchema = z.object({
  generatedAt: z.string().max(40),
  issues: z.array(auditIssueSchema).max(500),
  blockingCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
});
export type AuditReport = z.infer<typeof auditReportSchema>;

export const generationOptionsSchema = z.object({
  targetLanguage: generationLanguageSchema,
  provider: aiProviderNameSchema,
  keyMode: aiKeyModeSchema,
  model: z.string().max(120).optional(),
  downloadExternalImages: z.boolean().default(false),
  maxLocalImages: z.number().int().min(0).max(50).default(50),
});
export type GenerationOptions = z.infer<typeof generationOptionsSchema>;

export const userConfirmationSchema = z.object({
  licenseMissingConfirmed: z.boolean().default(false),
  warningsAccepted: z.boolean().default(false),
  confirmedAt: z.string().max(40).optional(),
});
export type UserConfirmation = z.infer<typeof userConfirmationSchema>;

export const generationTaskSchema = z.object({
  taskId: z.string().min(1).max(64),
  createdAt: z.string().max(40),
  options: generationOptionsSchema,
  metadata: projectMetadataSchema,
  documents: z.array(documentPageSchema).max(500),
  assets: z.array(assetRecordSchema).max(2000),
  audit: auditReportSchema,
  confirmation: userConfirmationSchema,
});
export type GenerationTask = z.infer<typeof generationTaskSchema>;

/** Structured payload the AI is allowed to produce. Everything else is discarded. */
export const aiProjectSummarySchema = z.object({
  summary: z.string().max(3000),
  highlights: z.array(z.string().max(400)).max(10),
  quickStart: z.string().max(8000),
  tags: z.array(z.string().max(40)).max(15),
  audience: z.string().max(500).optional(),
  facts: z
    .array(
      z.object({
        claim: z.string().max(400),
        source: z.enum(['repository', 'ai_inferred']),
      }),
    )
    .max(20)
    .default([]),
});
export type AIProjectSummary = z.infer<typeof aiProjectSummarySchema>;

export const aiPageSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().max(600),
  contentMarkdown: z.string().max(200_000),
});
export type AIPage = z.infer<typeof aiPageSchema>;

export const aiBundleSchema = z.object({
  project: aiProjectSummarySchema,
  pages: z.array(aiPageSchema).max(10).default([]),
});
export type AIBundle = z.infer<typeof aiBundleSchema>;

/** Local (non-sensitive) browser settings. API keys are never stored here. */
export const localSettingsSchema = z.object({
  preferredProvider: aiProviderNameSchema.default('deepseek'),
  preferredKeyMode: aiKeyModeSchema.default('server'),
  targetLanguage: generationLanguageSchema.default('zh-CN'),
  downloadExternalImages: z.boolean().default(false),
  preferredTheme: z.enum(['light', 'dark', 'system']).optional(),
});
export type LocalSettings = z.infer<typeof localSettingsSchema>;
