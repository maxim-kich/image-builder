import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BuiltinTemplate } from './storage';
import { parseTemplateManifest } from './template';

export async function loadBuiltinTemplates(): Promise<BuiltinTemplate[]> {
  return Promise.all(['basic-card', 'carousel-story', 'continuous-carousel'].map(async (id) => {
    const html = await readFile(resolve('examples/templates', `${id}.html`), 'utf8');
    return { id, html, manifest: parseTemplateManifest(html) };
  }));
}
