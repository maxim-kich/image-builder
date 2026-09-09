import { z } from 'zod';
import type { TemplateManifest } from '../src/domain';

const optionSchema = z.object({
  label: z.string().min(1).max(100),
  value: z.union([z.string(), z.number()]),
});

const controlSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/),
  label: z.string().min(1).max(120),
  type: z.enum([
    'text',
    'image',
    'number',
    'select',
    'boolean',
    'toggle',
    'color',
    'spacing',
    'border',
    'size',
    'position',
  ]),
  scope: z.enum(['template', 'canvas', 'element', 'export']).optional(),
  canvasId: z.string().min(1).max(64).optional(),
  elementId: z.string().min(1).max(64).optional(),
  default: z.json().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
  options: z.array(optionSchema).max(100).optional(),
  hint: z.string().max(240).optional(),
});

const editableCanvasPropertySchema = z.enum([
  'width',
  'height',
  'background',
  'backgroundImage',
  'padding',
  'spacing',
  'cornerRadius',
  'borderColor',
  'borderWidth',
  'borderStyle',
  'borderRadius',
  'shadow',
  'safeAreaGuides',
]);

const canvasSchema = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),
  name: z.string().min(1).max(120),
  width: z.number().int().min(64).max(4000).optional(),
  height: z.number().int().min(64).max(4000).optional(),
  state: z.record(z.string().max(64), z.json()).optional(),
  editable: z.array(editableCanvasPropertySchema).max(20).optional(),
});

const canvasRulesSchema = z
  .object({
    allowAdd: z.boolean().optional(),
    allowDelete: z.boolean().optional(),
    allowDuplicate: z.boolean().optional(),
    allowRename: z.boolean().optional(),
    allowReorder: z.boolean().optional(),
    min: z.number().int().min(1).max(100).optional(),
    max: z.number().int().min(1).max(100).optional(),
    sharedSize: z.boolean().optional(),
  })
  .optional();

const continuousCarouselSchema = z
  .object({
    mode: z.literal('continuous'),
    direction: z.enum(['horizontal', 'vertical']).default('horizontal'),
    segments: z
      .array(
        z.object({
          id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),
          name: z.string().min(1).max(120),
        }),
      )
      .min(2)
      .max(100),
    showGuides: z.boolean().optional(),
  })
  .optional();

const elementSchema = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),
  label: z.string().min(1).max(120),
  type: z.enum(['text', 'image', 'shape', 'icon', 'group']),
  canvasIds: z.array(z.string().min(1).max(64)).max(100).optional(),
  allow: z
    .array(
      z.enum(['move', 'resize', 'rotate', 'reorder', 'duplicate', 'delete']),
    )
    .max(6)
    .optional(),
});

const pdfExportSchema = z
  .object({
    enabled: z.boolean().optional(),
    pageSize: z.enum(['canvas', '16:9', '4:3', 'A4', 'Letter']).optional(),
    orientation: z.enum(['portrait', 'landscape', 'auto']).optional(),
    quality: z.enum(['screen', 'print']).optional(),
    margins: z.number().min(0).max(500).optional(),
    bleed: z.number().min(0).max(500).optional(),
    includeBackground: z.boolean().optional(),
    filename: z.string().min(1).max(160).optional(),
    title: z.string().max(240).optional(),
    author: z.string().max(240).optional(),
  })
  .optional();

const exportSchema = z
  .object({
    currentCanvas: z.boolean().optional(),
    separateImages: z.boolean().optional(),
    zip: z.boolean().optional(),
    formats: z
      .array(z.enum(['png', 'jpeg', 'webp']))
      .min(1)
      .max(3)
      .optional(),
    defaultFormat: z.enum(['png', 'jpeg', 'webp']).optional(),
    scales: z
      .array(z.union([z.literal(1), z.literal(2), z.literal('custom')]))
      .min(1)
      .max(3)
      .optional(),
    defaultScale: z.number().min(0.25).max(4).optional(),
    filenamePattern: z.string().min(1).max(160).optional(),
    pdf: pdfExportSchema,
  })
  .optional();

const manifestInputSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]).optional(),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(280),
  width: z.number().int().min(64).max(4000).optional(),
  height: z.number().int().min(64).max(4000).optional(),
  controls: z.array(controlSchema).max(100),
  canvases: z.array(canvasSchema).min(1).max(100).optional(),
  carousel: continuousCarouselSchema,
  canvasRules: canvasRulesSchema,
  sharedStyles: z.record(z.string().max(64), z.json()).optional(),
  elements: z.array(elementSchema).max(200).optional(),
  export: exportSchema,
});

export const templateManifestSchema = manifestInputSchema.transform(
  (data, context) => {
    const firstCanvas = data.canvases?.[0];
    const width = data.width ?? firstCanvas?.width;
    const height = data.height ?? firstCanvas?.height;
    if (!width)
      context.addIssue({
        code: 'custom',
        path: ['width'],
        message: 'Width is required at the template or first-canvas level.',
      });
    if (!height)
      context.addIssue({
        code: 'custom',
        path: ['height'],
        message: 'Height is required at the template or first-canvas level.',
      });
    return {
      ...data,
      width: width ?? 0,
      height: height ?? 0,
    } as TemplateManifest;
  },
);

const manifestPattern =
  /<script\b(?=[^>]*\bid=["']image-builder-manifest["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/i;

export function parseTemplateManifest(html: string): TemplateManifest {
  if (Buffer.byteLength(html, 'utf8') > 1_000_000)
    throw new Error('Template HTML must be 1 MB or smaller.');
  const match = manifestPattern.exec(html);
  if (!match)
    throw new Error(
      'Missing <script id="image-builder-manifest" type="application/json"> manifest.',
    );
  let json: unknown;
  try {
    json = JSON.parse(match[1]);
  } catch {
    throw new Error('The image-builder-manifest contains invalid JSON.');
  }
  const parsed = templateManifestSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Invalid template manifest at ${issue.path.join('.') || 'root'}: ${issue.message}`,
    );
  }
  const manifest = parsed.data;
  const keys = new Set<string>();
  for (const control of manifest.controls) {
    const identity = `${control.scope ?? 'canvas'}:${control.canvasId ?? '*'}:${control.elementId ?? '*'}:${control.key}`;
    if (keys.has(identity))
      throw new Error(
        `Duplicate template control key in the same scope: ${control.key}`,
      );
    keys.add(identity);
    if (control.type === 'select' && !control.options?.length)
      throw new Error(`Select control ${control.key} must define options.`);
    if (control.scope === 'element' && !control.elementId)
      throw new Error(`Element control ${control.key} must define elementId.`);
  }
  const canvasIds = new Set<string>();
  for (const canvas of manifest.canvases ?? []) {
    if (canvasIds.has(canvas.id))
      throw new Error(`Duplicate canvas id: ${canvas.id}`);
    canvasIds.add(canvas.id);
    if (!canvas.width && !manifest.width)
      throw new Error(
        `Canvas ${canvas.id} must define width or inherit a template width.`,
      );
    if (!canvas.height && !manifest.height)
      throw new Error(
        `Canvas ${canvas.id} must define height or inherit a template height.`,
      );
  }
  if (manifest.canvases?.length && manifest.carousel) {
    throw new Error(
      'A template cannot define both independent canvases and a continuous carousel.',
    );
  }
  if (manifest.carousel) {
    if (manifest.version !== 2)
      throw new Error(
        'Continuous carousel templates require manifest version 2.',
      );
    const segmentIds = new Set<string>();
    for (const segment of manifest.carousel.segments) {
      if (segmentIds.has(segment.id))
        throw new Error(`Duplicate carousel segment id: ${segment.id}`);
      segmentIds.add(segment.id);
    }
    const totalWidth =
      manifest.width *
      (manifest.carousel.direction === 'horizontal'
        ? manifest.carousel.segments.length
        : 1);
    const totalHeight =
      manifest.height *
      (manifest.carousel.direction === 'vertical'
        ? manifest.carousel.segments.length
        : 1);
    if (totalWidth > 16_384 || totalHeight > 16_384) {
      throw new Error(
        'The continuous carousel canvas cannot exceed 16384 px in either direction.',
      );
    }
  }
  const rules = manifest.canvasRules;
  const initialCount = manifest.canvases?.length ?? 1;
  if (rules?.min && rules.max && rules.min > rules.max)
    throw new Error('canvasRules.min cannot be greater than canvasRules.max.');
  if (rules?.min && initialCount < rules.min)
    throw new Error('The initial canvas count is below canvasRules.min.');
  if (rules?.max && initialCount > rules.max)
    throw new Error('The initial canvas count is above canvasRules.max.');
  if (
    manifest.export?.defaultFormat &&
    manifest.export.formats &&
    !manifest.export.formats.includes(manifest.export.defaultFormat)
  ) {
    throw new Error('export.defaultFormat must be included in export.formats.');
  }
  return manifest;
}
