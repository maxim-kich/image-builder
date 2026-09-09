import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import middie from '@fastify/middie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AppConfig } from './config';
import { createMcpServer } from './mcp';
import { createOpenApiDocument } from './openapi';
import { canvasInstances } from '../src/domain';
import {
  canvasFilename,
  closeRenderer,
  renderCanvas,
  renderPdf,
  renderPng,
  renderZip,
} from './render';
import {
  createImageSchema,
  exportImageSchema,
  updateImageSchema,
  uploadTemplateSchema,
} from './schemas';
import type { ImageBuilderStorage } from './storage';
import { parseTemplateManifest } from './template';

interface BuildOptions {
  config: AppConfig;
  storage: ImageBuilderStorage;
  serveFrontend?: boolean;
  logger?: boolean;
}

function equalToken(received: string | undefined, expected: string) {
  if (!received) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

const safeFileStem = (value: string) =>
  value
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'template';

export async function buildApp({
  config,
  storage,
  serveFrontend = true,
  logger = true,
}: BuildOptions) {
  const app = Fastify({ logger, bodyLimit: 12 * 1024 * 1024 });
  app.addHook('onClose', async () => {
    await Promise.all([storage.close(), closeRenderer()]);
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    return payload;
  });

  const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.apiToken) return;
    const header = request.headers.authorization;
    if (
      !header?.startsWith('Bearer ') ||
      !equalToken(header.slice(7), config.apiToken)
    ) {
      return reply
        .code(401)
        .send({
          error: 'invalid_token',
          message: 'A valid Image Builder bearer token is required.',
        });
    }
  };

  app.get('/api/v1/health', async () => ({
    ok: true,
    storage: storage.kind,
    authRequired: Boolean(config.apiToken),
    apiVersion: 'v1',
    mcpEndpoint: `${config.publicUrl}/mcp`,
    openApi: `${config.publicUrl}/api/v1/openapi.json`,
  }));
  app.get('/api/v1/openapi.json', async () =>
    createOpenApiDocument(config.publicUrl),
  );

  app.get('/api/v1/templates', { preHandler: authenticate }, async () => ({
    items: await storage.listTemplates(),
  }));
  app.get<{ Params: { id: string } }>(
    '/api/v1/templates/:id',
    { preHandler: authenticate },
    async (request, reply) =>
      (await storage.getTemplate(request.params.id)) ??
      reply.code(404).send({ error: 'not_found' }),
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/templates/:id/html',
    { preHandler: authenticate },
    async (request, reply) => {
      const template = await storage.getTemplate(request.params.id);
      if (!template) return reply.code(404).send({ error: 'not_found' });
      return reply
        .type('text/html; charset=utf-8')
        .header(
          'Content-Disposition',
          `attachment; filename="${safeFileStem(template.name)}.html"`,
        )
        .send(template.html);
    },
  );
  app.post(
    '/api/v1/templates',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = uploadTemplateSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: 'invalid_request', details: parsed.error.issues });
      try {
        const manifest = parseTemplateManifest(parsed.data.html);
        return reply
          .code(201)
          .send(await storage.createTemplate(parsed.data.html, manifest));
      } catch (error) {
        return reply
          .code(400)
          .send({
            error: 'invalid_template',
            message:
              error instanceof Error ? error.message : 'Invalid template.',
          });
      }
    },
  );
  app.delete<{ Params: { id: string } }>(
    '/api/v1/templates/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const result = await storage.deleteTemplate(request.params.id);
      if (result === 'not_found')
        return reply.code(404).send({ error: result });
      return reply.code(204).send();
    },
  );

  app.get('/api/v1/images', { preHandler: authenticate }, async () => ({
    items: await storage.listImages(),
  }));
  app.post(
    '/api/v1/images',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = createImageSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: 'invalid_request', details: parsed.error.issues });
      try {
        return reply.code(201).send(await storage.createImage(parsed.data));
      } catch (error) {
        return reply
          .code(404)
          .send({
            error: 'template_not_found',
            message:
              error instanceof Error ? error.message : 'Template not found.',
          });
      }
    },
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/images/:id',
    { preHandler: authenticate },
    async (request, reply) =>
      (await storage.getImage(request.params.id)) ??
      reply.code(404).send({ error: 'not_found' }),
  );
  app.patch<{ Params: { id: string } }>(
    '/api/v1/images/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = updateImageSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: 'invalid_request', details: parsed.error.issues });
      const result = await storage.updateImage(request.params.id, parsed.data);
      if (result.status === 'not_found')
        return reply.code(404).send({ error: 'not_found' });
      if (result.status === 'conflict')
        return reply
          .code(409)
          .send({ error: 'revision_conflict', current: result.value });
      return result.value;
    },
  );
  app.post<{ Params: { id: string } }>(
    '/api/v1/images/:id/duplicate',
    { preHandler: authenticate },
    async (request, reply) => {
      const source = await storage.getImage(request.params.id);
      if (!source) return reply.code(404).send({ error: 'not_found' });
      return reply
        .code(201)
        .send(
          await storage.createImage({
            templateId: source.templateId,
            title: `${source.title} copy`,
            state: source.state,
          }),
        );
    },
  );
  app.delete<{ Params: { id: string } }>(
    '/api/v1/images/:id',
    { preHandler: authenticate },
    async (request, reply) =>
      (await storage.deleteImage(request.params.id))
        ? reply.code(204).send()
        : reply.code(404).send({ error: 'not_found' }),
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/images/:id/png',
    { preHandler: authenticate },
    async (request, reply) => {
      const image = await storage.getImage(request.params.id);
      if (!image) return reply.code(404).send({ error: 'not_found' });
      const template = await storage.getTemplate(image.templateId);
      if (!template)
        return reply.code(404).send({ error: 'template_not_found' });
      try {
        const png = await renderPng(template, image);
        return reply
          .type('image/png')
          .header(
            'Content-Disposition',
            `attachment; filename="image-builder-${image.id.slice(0, 8)}.png"`,
          )
          .send(png);
      } catch (error) {
        return reply
          .code(503)
          .send({
            error: 'render_unavailable',
            message: error instanceof Error ? error.message : 'Render failed.',
          });
      }
    },
  );
  app.get<{
    Params: { id: string };
    Querystring: {
      canvasId?: string;
      format?: string;
      scale?: string;
      quality?: string;
    };
  }>(
    '/api/v1/images/:id/export',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = exportImageSchema.safeParse(request.query);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: 'invalid_export', details: parsed.error.issues });
      const image = await storage.getImage(request.params.id);
      if (!image) return reply.code(404).send({ error: 'not_found' });
      const template = await storage.getTemplate(image.templateId);
      if (!template)
        return reply.code(404).send({ error: 'template_not_found' });
      const formats = template.manifest.export?.formats ?? ['png'];
      if (!formats.includes(parsed.data.format))
        return reply.code(400).send({ error: 'format_not_allowed' });
      const canvases = canvasInstances(template.manifest, image.state);
      const index = parsed.data.canvasId
        ? canvases.findIndex((canvas) => canvas.id === parsed.data.canvasId)
        : 0;
      if (index < 0) return reply.code(404).send({ error: 'canvas_not_found' });
      try {
        const rendered = await renderCanvas(
          template,
          image,
          canvases[index],
          index,
          parsed.data,
        );
        const type =
          parsed.data.format === 'jpeg'
            ? 'image/jpeg'
            : `image/${parsed.data.format}`;
        return reply
          .type(type)
          .header(
            'Content-Disposition',
            `attachment; filename="${canvasFilename(template, image, canvases[index], index, parsed.data.format)}"`,
          )
          .send(rendered.bytes);
      } catch (error) {
        return reply
          .code(503)
          .send({
            error: 'render_unavailable',
            message: error instanceof Error ? error.message : 'Render failed.',
          });
      }
    },
  );
  app.get<{
    Params: { id: string };
    Querystring: { format?: string; scale?: string; quality?: string };
  }>(
    '/api/v1/images/:id/zip',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = exportImageSchema
        .omit({ canvasId: true })
        .safeParse(request.query);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: 'invalid_export', details: parsed.error.issues });
      const image = await storage.getImage(request.params.id);
      if (!image) return reply.code(404).send({ error: 'not_found' });
      const template = await storage.getTemplate(image.templateId);
      if (!template)
        return reply.code(404).send({ error: 'template_not_found' });
      if (template.manifest.export?.zip === false)
        return reply.code(400).send({ error: 'zip_not_allowed' });
      if (
        !(template.manifest.export?.formats ?? ['png']).includes(
          parsed.data.format,
        )
      )
        return reply.code(400).send({ error: 'format_not_allowed' });
      try {
        const zip = await renderZip(template, image, parsed.data);
        return reply
          .type('application/zip')
          .header(
            'Content-Disposition',
            `attachment; filename="${safeFileStem(image.title)}.zip"`,
          )
          .send(zip);
      } catch (error) {
        return reply
          .code(503)
          .send({
            error: 'render_unavailable',
            message: error instanceof Error ? error.message : 'Render failed.',
          });
      }
    },
  );
  app.get<{ Params: { id: string }; Querystring: { scale?: string } }>(
    '/api/v1/images/:id/pdf',
    { preHandler: authenticate },
    async (request, reply) => {
      const scale =
        request.query.scale === undefined
          ? undefined
          : Number(request.query.scale);
      if (
        scale !== undefined &&
        (!Number.isFinite(scale) || scale < 0.25 || scale > 4)
      )
        return reply.code(400).send({ error: 'invalid_export_scale' });
      const image = await storage.getImage(request.params.id);
      if (!image) return reply.code(404).send({ error: 'not_found' });
      const template = await storage.getTemplate(image.templateId);
      if (!template)
        return reply.code(404).send({ error: 'template_not_found' });
      if (!template.manifest.export?.pdf?.enabled)
        return reply.code(400).send({ error: 'pdf_not_allowed' });
      try {
        const pdf = await renderPdf(template, image, scale);
        const filename =
          template.manifest.export.pdf.filename ??
          `${safeFileStem(image.title)}.pdf`;
        return reply
          .type('application/pdf')
          .header(
            'Content-Disposition',
            `attachment; filename="${safeFileStem(filename.replace(/\.pdf$/i, ''))}.pdf"`,
          )
          .send(pdf);
      } catch (error) {
        return reply
          .code(503)
          .send({
            error: 'render_unavailable',
            message: error instanceof Error ? error.message : 'Render failed.',
          });
      }
    },
  );

  app.all('/mcp', { preHandler: authenticate }, async (request, reply) => {
    if (request.method !== 'POST')
      return reply
        .code(405)
        .send({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Method not allowed' },
          id: null,
        });
    const server = createMcpServer(storage, config.publicUrl);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    reply.hijack();
    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
      reply.raw.on('close', () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      request.log.error(error, 'MCP request failed');
      if (!reply.raw.headersSent)
        reply.raw.writeHead(500, { 'Content-Type': 'application/json' });
      if (!reply.raw.writableEnded)
        reply.raw.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          }),
        );
    }
  });

  app.get('/docs/templates', async (_request, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .send(
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Image Builder templates</title><style>body{max-width:760px;margin:48px auto;padding:0 20px;background:#111211;color:#cfdacd;font:16px/1.6 ui-monospace,monospace}a{color:#42c07e}code,pre{background:#202221}code{padding:2px 5px}pre{padding:16px;overflow:auto}</style><main><h1>Image Builder template contract</h1><p>A template is one self-contained HTML file with a JSON manifest in <code>#image-builder-manifest</code> and one render root named <code>#ib-canvas</code>.</p><p>Manifest version 2 supports two distinct models: independent canvases for presentations and image sets, or one continuous carousel surface cropped into ordered segments for edge-crossing artwork. It also supports scoped controls, editable elements, and image, ZIP, or multi-page PDF export.</p><p>The editor injects <code>window.ImageBuilder</code>. Use <code>getState()</code> and <code>getContext()</code> to read the current canvas or carousel, <code>patchState({...})</code> to publish interactive changes, and <code>requestImage(key)</code> to open the image picker. Listen for <code>imagebuilder:state</code> on <code>document</code> to redraw.</p><p>Preview scripts run in a sandbox and network access is blocked. Embed assets as data URLs. See <code>docs/template-authoring.md</code>, <code>examples/templates/carousel-story.html</code>, and <code>examples/templates/continuous-carousel.html</code> in the project for the complete contract and starters.</p></main></html>`,
      ),
  );

  if (serveFrontend) {
    if (config.isProduction) {
      const dist = resolve('dist');
      await access(dist);
      await app.register(fastifyStatic, { root: dist, wildcard: false });
      app.setNotFoundHandler((_request, reply) => reply.sendFile('index.html'));
    } else {
      await app.register(middie);
      const { createServer } = await import('vite');
      const vite = await createServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use((request, response, next) => {
        if (
          request.url?.startsWith('/api/') ||
          request.url === '/mcp' ||
          request.url?.startsWith('/docs/')
        )
          return next();
        return vite.middlewares(request, response, next);
      });
      app.addHook('onClose', async () => vite.close());
    }
  }
  return app;
}
