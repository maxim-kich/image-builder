import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server/app';
import type { AppConfig } from '../server/config';
import { createStorage } from '../server/storage';
import { parseTemplateManifest } from '../server/template';

describe('REST API', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    const html = await readFile('examples/templates/basic-card.html', 'utf8');
    const storage = createStorage('sqlite::memory:');
    await storage.init([{ id: 'basic-card', html, manifest: parseTemplateManifest(html) }]);
    const config: AppConfig = { host: '127.0.0.1', port: 5180, publicUrl: 'http://127.0.0.1:5180', databaseUrl: 'sqlite::memory:', isProduction: false };
    app = await buildApp({ config, storage, serveFrontend: false, logger: false });
  });
  afterEach(async () => app.close());

  it('creates, updates, lists, and deletes an image', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/images', payload: { templateId: 'basic-card', title: 'API image' } });
    expect(created.statusCode).toBe(201);
    const image = created.json();
    const updated = await app.inject({ method: 'PATCH', url: `/api/v1/images/${image.id}`, payload: { title: 'Updated', expectedRevision: 1 } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().revision).toBe(2);
    expect((await app.inject({ method: 'GET', url: '/api/v1/images' })).json().items).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/images/${image.id}` })).statusCode).toBe(204);
  });

  it('requires a configured bearer token', async () => {
    await app.close();
    const html = await readFile('examples/templates/basic-card.html', 'utf8');
    const storage = createStorage('sqlite::memory:'); await storage.init([{ id: 'basic-card', html, manifest: parseTemplateManifest(html) }]);
    const config: AppConfig = { host: '127.0.0.1', port: 5180, publicUrl: 'http://127.0.0.1:5180', databaseUrl: 'sqlite::memory:', apiToken: 'long-test-token', isProduction: false };
    app = await buildApp({ config, storage, serveFrontend: false, logger: false });
    expect((await app.inject({ method: 'GET', url: '/api/v1/templates' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/templates', headers: { authorization: 'Bearer long-test-token' } })).statusCode).toBe(200);
  });

  it('downloads and deletes an unused template', async () => {
    const html = await readFile('examples/templates/basic-card.html', 'utf8');
    const download = await app.inject({ method: 'GET', url: '/api/v1/templates/basic-card/html' });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toContain('text/html');
    expect(download.headers['content-disposition']).toBe('attachment; filename="Basic-statement.html"');
    expect(download.body).toBe(html);
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/templates/basic-card' })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/v1/templates' })).json().items).toHaveLength(0);
  });

  it('deletes a template together with its connected images', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/images', payload: { templateId: 'basic-card', title: 'Connected image' } });
    expect(created.statusCode).toBe(201);
    const imageId = created.json().id;
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/templates/basic-card' })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/v1/images/${imageId}` })).statusCode).toBe(404);
  });
});
