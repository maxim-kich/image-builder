import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ImageBuilderStorage } from '../server/storage';
import { createStorage } from '../server/storage';
import { parseTemplateManifest } from '../server/template';

describe('SQLite storage', () => {
  let storage: ImageBuilderStorage;
  beforeEach(async () => {
    const html = await readFile('examples/templates/basic-card.html', 'utf8');
    storage = createStorage('sqlite::memory:');
    await storage.init([{ id: 'basic-card', html, manifest: parseTemplateManifest(html) }]);
  });
  afterEach(async () => storage.close());

  it('seeds the built-in template and persists image revisions', async () => {
    expect((await storage.listTemplates())[0].id).toBe('basic-card');
    const image = await storage.createImage({ templateId: 'basic-card', title: 'Test' });
    expect(image.state.title).toBe('Make the useful thing clear.');
    const updated = await storage.updateImage(image.id, { state: { ...image.state, zoom: 2 }, expectedRevision: 1 });
    expect(updated.status).toBe('updated');
    if (updated.status === 'updated') expect(updated.value.revision).toBe(2);
  });

  it('deletes an unused built-in template', async () => {
    expect(await storage.deleteTemplate('basic-card')).toBe('deleted');
    expect(await storage.getTemplate('basic-card')).toBeNull();
  });

  it('deletes images connected to a deleted template', async () => {
    const image = await storage.createImage({ templateId: 'basic-card', title: 'Uses template' });
    expect(await storage.deleteTemplate('basic-card')).toBe('deleted');
    expect(await storage.getTemplate('basic-card')).toBeNull();
    expect(await storage.getImage(image.id)).toBeNull();
  });
});

it('seeds three examples once, preserves drafts, and respects deleted built-ins after restart', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { loadBuiltinTemplates } = await import('../server/builtins');
  const directory = await mkdtemp(join(tmpdir(), 'image-builder-seeds-'));
  const url = `sqlite:${join(directory, 'test.sqlite')}`;
  let store = createStorage(url);
  try {
    const builtins = await loadBuiltinTemplates();
    await store.init(builtins);
    const first = await store.listTemplates();
    expect(first.map(item => item.id).sort()).toEqual(['basic-card', 'carousel-story', 'continuous-carousel']);
    expect(first.every(item => item.builtIn)).toBe(true);
    const uploaded = await store.createTemplate(builtins[0].html, builtins[0].manifest);
    const draft = await store.createImage({ templateId: uploaded.id });
    await store.archiveTemplate(uploaded.id);
    expect(await store.listTemplates()).toHaveLength(3);
    expect(await store.getTemplate(uploaded.id)).not.toBeNull();
    expect(await store.getImage(draft.id)).not.toBeNull();
    await store.deleteTemplate('basic-card');
    await store.close();
    store = createStorage(url);
    await store.init(builtins);
    expect(await store.listTemplates()).toHaveLength(2);
    expect(await store.getTemplate('basic-card')).toBeNull();
    expect((await store.getTemplate('carousel-story'))?.revision).toBe(1);
    expect(await store.getImage(draft.id)).not.toBeNull();
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
