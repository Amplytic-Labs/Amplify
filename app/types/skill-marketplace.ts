import type { ZodSchema } from 'zod';
import { z } from 'zod';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const SkillManifestSchema: ZodSchema = z.object({
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must be in SemVer format (e.g. 1.0.0)'),
  author: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(['coding', 'design', 'data', 'writing', 'general']),
  minAppVersion: z.string().regex(/^\d+\.\d+\.\d+$/, 'minAppVersion must be in SemVer format'),
  dependencies: z.array(z.string()).default([]),
  permissions: z.array(z.enum(['filesystem', 'network', 'shell'])).default([]),
  estimatedTokens: z.number().positive().optional(),
  verified: z.boolean().default(false),
  rating: z.number().min(0).max(5).default(0),
  installCount: z.number().int().nonnegative().default(0),
});

export type SkillManifest = z.infer<typeof SkillManifestSchema>;
