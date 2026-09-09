import { z } from 'zod';

export const imageStateSchema = z.record(z.string().max(64), z.json());

export const createImageSchema = z.object({
  templateId: z.string().min(1).max(120),
  title: z.string().min(1).max(200).optional(),
  state: imageStateSchema.optional(),
});

export const updateImageSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  state: imageStateSchema.optional(),
  expectedRevision: z.number().int().positive().optional(),
}).refine((value) => value.title !== undefined || value.state !== undefined, {
  message: 'Provide title or state.',
});

export const uploadTemplateSchema = z.object({
  html: z.string().min(1).max(1_000_000),
});

export const exportImageSchema = z.object({
  canvasId: z.string().min(1).max(120).optional(),
  format: z.enum(['png', 'jpeg', 'webp']).default('png'),
  scale: z.coerce.number().min(.25).max(4).default(1),
  quality: z.coerce.number().int().min(1).max(100).default(90),
});
