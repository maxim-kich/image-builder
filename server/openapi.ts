export function createOpenApiDocument(publicUrl: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Image Builder API',
      version: '0.1.0',
      description:
        'Create single-canvas, independent multi-canvas, and continuous-carousel drafts; manage portable HTML templates; and render image, ZIP, or PDF exports.',
    },
    servers: [{ url: `${publicUrl}/api/v1` }],
    security: [{ bearerAuth: [] }],
    paths: {
      '/health': {
        get: {
          security: [],
          summary: 'Check service health',
          responses: { '200': { description: 'Healthy' } },
        },
      },
      '/templates': {
        get: {
          summary: 'List templates',
          responses: { '200': { description: 'Template documents' } },
        },
        post: {
          summary: 'Upload a self-contained HTML template',
          responses: { '201': { description: 'Created template' } },
        },
      },
      '/templates/{id}': {
        get: {
          summary: 'Get a template',
          responses: { '200': { description: 'Template document' } },
        },
        delete: {
          summary: 'Delete a template and its connected image drafts',
          responses: {
            '204': { description: 'Template and connected images deleted' },
          },
        },
      },
      '/templates/{id}/html': {
        get: {
          summary: 'Download a template as HTML',
          responses: { '200': { description: 'HTML template file' } },
        },
      },
      '/images': {
        get: {
          summary: 'List image drafts',
          responses: { '200': { description: 'Image documents' } },
        },
        post: {
          summary: 'Create an image draft',
          responses: { '201': { description: 'Created image' } },
        },
      },
      '/images/{id}': {
        get: {
          summary: 'Get an image draft',
          responses: { '200': { description: 'Image document' } },
        },
        patch: {
          summary: 'Update title or template state',
          responses: {
            '200': { description: 'Updated image' },
            '409': { description: 'Revision conflict' },
          },
        },
        delete: {
          summary: 'Delete an image draft',
          responses: { '204': { description: 'Deleted' } },
        },
      },
      '/images/{id}/duplicate': {
        post: {
          summary: 'Duplicate an image draft',
          responses: { '201': { description: 'Created copy' } },
        },
      },
      '/images/{id}/png': {
        get: {
          summary: 'Render a PNG',
          responses: { '200': { description: 'PNG image' } },
        },
      },
      '/images/{id}/export': {
        get: {
          summary:
            'Render one selected canvas or carousel segment as PNG, JPEG, or WebP',
          responses: { '200': { description: 'Rendered image file' } },
        },
      },
      '/images/{id}/zip': {
        get: {
          summary:
            'Render all canvases or segments into an ordered ZIP archive',
          responses: { '200': { description: 'ZIP archive' } },
        },
      },
      '/images/{id}/pdf': {
        get: {
          summary:
            'Render all canvases or segments as an ordered multi-page PDF',
          responses: { '200': { description: 'PDF document' } },
        },
      },
    },
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
    },
  };
}
