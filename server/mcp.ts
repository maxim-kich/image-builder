import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { defaultStateFor } from '../src/domain';
import { imageStateSchema } from './schemas';
import { renderPng } from './render';
import type { ImageBuilderStorage } from './storage';
import { parseTemplateManifest } from './template';

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const notFound = (kind: string, id: string) => ({ isError: true, content: [{ type: 'text' as const, text: `${kind} ${id} was not found.` }] });

export function createMcpServer(storage: ImageBuilderStorage, publicUrl: string) {
  const server = new McpServer({ name: 'image-builder', version: '0.1.0' }, {
    instructions: 'Create, edit, inspect, and render persistent social-image drafts. Read a template before creating an image and pass expectedRevision when coordinating edits.',
  });

  server.registerTool('list_templates', {
    title: 'List image templates',
    description: 'List built-in and uploaded HTML templates with their dimensions and control schemas.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => json((await storage.listTemplates()).map(({ html: _html, ...template }) => template)));

  server.registerTool('get_template', {
    title: 'Get template guide',
    description: 'Get one template manifest and its editable controls. HTML is omitted unless includeHtml is true.',
    inputSchema: { id: z.string().min(1), includeHtml: z.boolean().default(false) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ id, includeHtml }) => {
    const template = await storage.getTemplate(id);
    if (!template) return notFound('Template', id);
    const { html: _html, ...summary } = template;
    return json(includeHtml ? template : summary);
  });

  server.registerTool('upload_template', {
    title: 'Upload HTML template',
    description: 'Install a self-contained HTML template after the user explicitly approves running its code. The file must follow the Image Builder manifest contract.',
    inputSchema: { html: z.string().min(1).max(1_000_000) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ html }) => {
    try {
      const template = await storage.createTemplate(html, parseTemplateManifest(html));
      const { html: _html, ...summary } = template;
      return json(summary);
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Invalid template.' }] };
    }
  });

  server.registerTool('list_images', {
    title: 'List image drafts', description: 'List saved images, most recently updated first.', inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => json((await storage.listImages()).map((image) => ({ ...image, editUrl: `${publicUrl}/edit/${image.id}` }))));

  server.registerTool('get_image', {
    title: 'Get image draft', description: 'Get the current state, revision, and edit URL for one image.',
    inputSchema: { id: z.string().min(1) }, annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ id }) => {
    const image = await storage.getImage(id);
    return image ? json({ ...image, editUrl: `${publicUrl}/edit/${image.id}` }) : notFound('Image', id);
  });

  server.registerTool('create_image', {
    title: 'Create image draft',
    description: 'Create a persistent image from a template. Omitted state fields use template defaults.',
    inputSchema: { templateId: z.string().min(1), title: z.string().min(1).max(200).optional(), state: imageStateSchema.optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ templateId, title, state }) => {
    const template = await storage.getTemplate(templateId);
    if (!template) return notFound('Template', templateId);
    const image = await storage.createImage({ templateId, title, state: { ...defaultStateFor(template.manifest), ...state } });
    return json({ ...image, editUrl: `${publicUrl}/edit/${image.id}` });
  });

  server.registerTool('update_image', {
    title: 'Update image draft',
    description: 'Replace an image state or title. Pass expectedRevision to avoid overwriting another edit.',
    inputSchema: { id: z.string().min(1), title: z.string().min(1).max(200).optional(), state: imageStateSchema.optional(), expectedRevision: z.number().int().positive().optional() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ id, title, state, expectedRevision }) => {
    const result = await storage.updateImage(id, { title, state, expectedRevision });
    if (result.status === 'not_found') return notFound('Image', id);
    if (result.status === 'conflict') return { isError: true, content: [{ type: 'text' as const, text: `Revision conflict. Current image:\n${JSON.stringify(result.value, null, 2)}` }] };
    return json({ ...result.value, editUrl: `${publicUrl}/edit/${id}` });
  });

  server.registerTool('render_image', {
    title: 'Render image PNG',
    description: 'Render one image draft using the same HTML template as the visual editor and return a PNG.',
    inputSchema: { id: z.string().min(1) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ id }) => {
    const image = await storage.getImage(id); if (!image) return notFound('Image', id);
    const template = await storage.getTemplate(image.templateId); if (!template) return notFound('Template', image.templateId);
    const png = await renderPng(template, image);
    return { content: [
      { type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' },
      { type: 'text' as const, text: `Edit: ${publicUrl}/edit/${id}` },
    ] };
  });

  server.registerTool('delete_image', {
    title: 'Delete image draft', description: 'Permanently delete an image draft.',
    inputSchema: { id: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ id }) => await storage.deleteImage(id) ? json({ deleted: true, id }) : notFound('Image', id));

  return server;
}
