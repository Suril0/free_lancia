import { z } from 'zod'

export const PROMPT_VERSION = 'submission-review-v1'
export const VERIFIER_SCHEMA_VERSION = 'submission-review-output-v1'

export const verificationOutputSchema = z.object({
  score: z.number().int().min(0).max(100),
  verdict: z.enum(['PASS', 'REVIEW', 'FAIL']),
  qualityScore: z.number().int().min(0).max(100),
  confidence: z.number().int().min(0).max(100),
  perRequirement: z.array(z.object({
    requirementId: z.string().min(1).max(128),
    status: z.enum(['MET', 'PARTIAL', 'NOT_MET']),
    rationale: z.string().max(500),
  }).strict()).max(30),
  summary: z.string().min(1).max(2000),
}).strict()

export type VerificationOutput = z.infer<typeof verificationOutputSchema>
