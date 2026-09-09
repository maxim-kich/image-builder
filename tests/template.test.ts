import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseTemplateManifest } from '../server/template';
import { canvasFilename, imageScreenshotOptions } from '../server/render';
import {
  canvasInstances,
  carouselState,
  continuousCarouselSize,
  defaultStateFor,
  effectiveCanvasState,
  templateState,
} from '../src/domain';
import { buildTemplateDocument } from '../src/templateRuntime';

describe('template contract', () => {
  it('parses the built-in template manifest', async () => {
    const html = await readFile('examples/templates/basic-card.html', 'utf8');
    const manifest = parseTemplateManifest(html);
    expect(manifest.name).toBe('Basic statement');
    expect(manifest.width).toBe(1080);
    expect(manifest.controls.map((control) => control.key)).toContain('tone');
    expect(manifest.controls.map((control) => control.key)).not.toContain(
      'background',
    );
  });

  it('rejects templates without a manifest', () => {
    expect(() => parseTemplateManifest('<main id="ib-canvas"></main>')).toThrow(
      /manifest/i,
    );
  });

  it('injects sandbox policy and initial state', () => {
    const html =
      '<!doctype html><html><head></head><body><main id="ib-canvas"></main></body></html>';
    const document = buildTemplateDocument(
      { html },
      { title: '<unsafe>' },
      true,
    );
    expect(document).toContain('Content-Security-Policy');
    expect(document).toContain('imagebuilder:set-state');
    expect(document).toContain('event.data.context');
    expect(document).toContain('imagebuilder:focus-canvas');
    expect(document).toContain("closest('[data-ib-text], [data-ib-image]')");
    expect(document).toContain(
      "querySelectorAll('[data-ib-text], [data-ib-image]')",
    );
    expect(document).toContain('if (id || keys.length > 0)');
    expect(document).toContain("type: 'imagebuilder:select-element', id, keys");
    expect(document).toContain('\\u003cunsafe>');
  });

  it('parses multi-canvas structure, permissions, controls, and export behavior', async () => {
    const html = await readFile(
      'examples/templates/carousel-story.html',
      'utf8',
    );
    const manifest = parseTemplateManifest(html);
    expect(manifest.version).toBe(2);
    expect(manifest.canvases?.map((canvas) => canvas.id)).toEqual([
      'cover',
      'feature',
      'details',
    ]);
    expect(manifest.canvasRules).toMatchObject({
      allowAdd: true,
      min: 2,
      max: 12,
      sharedSize: true,
    });
    expect(
      manifest.elements?.find((element) => element.id === 'headline')?.allow,
    ).toContain('resize');
    expect(manifest.export?.formats).toEqual(['png', 'jpeg', 'webp']);
    expect(manifest.export?.pdf?.enabled).toBe(true);

    const state = defaultStateFor(manifest);
    const canvases = canvasInstances(manifest, state);
    expect(canvases).toHaveLength(3);
    expect(templateState(state).brand).toBe('IMAGE BUILDER');
    expect(effectiveCanvasState(manifest, state, canvases[1])).toMatchObject({
      brand: 'IMAGE BUILDER',
      accent: '#42c07e',
      title: 'Start with the outcome.',
      showNumber: true,
    });
    const template = {
      id: 'story',
      name: manifest.name,
      description: manifest.description,
      html,
      manifest,
      builtIn: false,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      revision: 1,
    };
    const image = {
      id: 'draft',
      title: 'QA Story',
      templateId: 'story',
      state,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      revision: 1,
    };
    expect(canvasFilename(template, image, canvases[0], 0, 'png')).toBe(
      '01-cover.png',
    );
  });

  it('rejects invalid multi-canvas limits and duplicate canvas ids', () => {
    const html = (manifest: object) =>
      `<script id="image-builder-manifest" type="application/json">${JSON.stringify(manifest)}</script><main id="ib-canvas"></main>`;
    const base = {
      version: 2,
      name: 'Set',
      description: 'Canvas set',
      width: 1080,
      height: 1080,
      controls: [],
    };
    expect(() =>
      parseTemplateManifest(
        html({
          ...base,
          canvases: [{ id: 'page', name: 'One' }],
          canvasRules: { min: 2 },
        }),
      ),
    ).toThrow(/below canvasRules.min/);
    expect(() =>
      parseTemplateManifest(
        html({
          ...base,
          canvases: [
            { id: 'page', name: 'One' },
            { id: 'page', name: 'Two' },
          ],
        }),
      ),
    ).toThrow(/Duplicate canvas id/);
  });

  it('parses a continuous carousel as one shared canvas with ordered export segments', async () => {
    const html = await readFile(
      'examples/templates/continuous-carousel.html',
      'utf8',
    );
    const manifest = parseTemplateManifest(html);
    expect(manifest.version).toBe(2);
    expect(manifest.canvases).toBeUndefined();
    expect(manifest.carousel).toMatchObject({
      mode: 'continuous',
      direction: 'horizontal',
      showGuides: true,
    });
    expect(manifest.carousel?.segments.map((segment) => segment.id)).toEqual([
      'cover',
      'story',
      'proof',
      'finish',
    ]);
    expect(continuousCarouselSize(manifest)).toEqual({
      width: 4320,
      height: 1080,
    });

    const state = defaultStateFor(manifest);
    const segments = canvasInstances(manifest, state);
    expect(segments).toHaveLength(4);
    expect(templateState(state).headline).toBe(
      'One idea. One continuous story.',
    );
    expect(carouselState(state)).toEqual({});
    expect(effectiveCanvasState(manifest, state, segments[2]).accent).toBe(
      '#61e68d',
    );
  });

  it('rejects ambiguous or oversized continuous carousel manifests', () => {
    const html = (manifest: object) =>
      `<script id="image-builder-manifest" type="application/json">${JSON.stringify(manifest)}</script><main id="ib-canvas"></main>`;
    const base = {
      version: 2,
      name: 'Strip',
      description: 'Continuous strip',
      width: 1080,
      height: 1080,
      controls: [],
    };
    const carousel = {
      mode: 'continuous',
      direction: 'horizontal',
      segments: [
        { id: 'one', name: 'One' },
        { id: 'two', name: 'Two' },
      ],
    };
    expect(() =>
      parseTemplateManifest(
        html({ ...base, canvases: [{ id: 'page', name: 'Page' }], carousel }),
      ),
    ).toThrow(/cannot define both/i);
    expect(() =>
      parseTemplateManifest(
        html({
          ...base,
          carousel: {
            ...carousel,
            segments: [
              { id: 'same', name: 'One' },
              { id: 'same', name: 'Two' },
            ],
          },
        }),
      ),
    ).toThrow(/Duplicate carousel segment id/);
    expect(() =>
      parseTemplateManifest(
        html({
          ...base,
          width: 4000,
          carousel: {
            ...carousel,
            segments: Array.from({ length: 5 }, (_, index) => ({
              id: `s${index}`,
              name: `Segment ${index}`,
            })),
          },
        }),
      ),
    ).toThrow(/16384/);
  });

  it('preserves transparency for alpha-capable image exports', () => {
    expect(imageScreenshotOptions('png').omitBackground).toBe(true);
    expect(imageScreenshotOptions('webp').omitBackground).toBe(true);
    expect(imageScreenshotOptions('jpeg').omitBackground).toBe(false);
  });
});
