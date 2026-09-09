import { access } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import puppeteer, {
  type Browser,
  type ScreenshotOptions,
} from 'puppeteer-core';
import type {
  CanvasInstance,
  ExportImageFormat,
  ImageDocument,
  TemplateDocument,
} from '../src/domain';
import {
  canvasInstances,
  canvasSize,
  continuousCarouselSize,
  effectiveCanvasState,
  isContinuousCarouselManifest,
  templateCanvasFor,
} from '../src/domain';
import {
  buildTemplateDocument,
  type TemplateRuntimeContext,
} from '../src/templateRuntime';

const chromeCandidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter(Boolean) as string[];

let browserPromise: Promise<Browser> | undefined;

async function executablePath() {
  for (const candidate of chromeCandidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  throw new Error(
    'Chrome or Chromium was not found. Set CHROME_PATH to enable image export.',
  );
}

async function browser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      executablePath: await executablePath(),
      headless: true,
      args:
        process.env.CHROME_NO_SANDBOX === '1'
          ? ['--no-sandbox', '--disable-setuid-sandbox']
          : [],
    });
    browserPromise
      .then((instance) =>
        instance.on('disconnected', () => {
          browserPromise = undefined;
        }),
      )
      .catch(() => {
        browserPromise = undefined;
      });
  }
  return browserPromise;
}

export interface RenderImageOptions {
  format?: ExportImageFormat;
  scale?: number;
  quality?: number;
  includeBackground?: boolean;
}

export interface RenderedCanvas {
  canvas: CanvasInstance;
  bytes: Buffer;
  width: number;
  height: number;
}

export function imageScreenshotOptions(
  format: ExportImageFormat,
  options: RenderImageOptions = {},
): ScreenshotOptions {
  return {
    type: format,
    // Preserve the page's alpha channel for formats that support transparency.
    // Explicit template backgrounds still render normally; only transparent pixels remain transparent.
    omitBackground: format !== 'jpeg',
    ...(format === 'jpeg'
      ? { quality: Math.min(100, Math.max(1, options.quality ?? 90)) }
      : {}),
  };
}

function runtimeContext(
  template: TemplateDocument,
  canvas: CanvasInstance,
  index: number,
  count: number,
): TemplateRuntimeContext {
  const size = canvasSize(template, {}, canvas);
  const definition = templateCanvasFor(template.manifest, canvas);
  const continuous = isContinuousCarouselManifest(template.manifest);
  const carouselSize = continuous
    ? continuousCarouselSize(template.manifest)
    : undefined;
  return {
    canvas: {
      id: canvas.id,
      templateCanvasId: canvas.templateCanvasId,
      name: canvas.name,
      index,
      count,
      width: size.width,
      height: size.height,
      editable: continuous ? [] : (definition?.editable ?? []),
    },
    ...(continuous && carouselSize
      ? {
          carousel: {
            mode: 'continuous' as const,
            direction: template.manifest.carousel!.direction,
            width: carouselSize.width,
            height: carouselSize.height,
            segmentWidth: template.manifest.width,
            segmentHeight: template.manifest.height,
            segments: template.manifest.carousel!.segments.map(
              (segment, segmentIndex) => ({ ...segment, index: segmentIndex }),
            ),
          },
        }
      : {}),
    elements: (template.manifest.elements ?? [])
      .filter(
        (element) =>
          !element.canvasIds?.length ||
          element.canvasIds.includes(canvas.templateCanvasId),
      )
      .map((element) => ({
        id: element.id,
        label: element.label,
        type: element.type,
        allow: element.allow ?? [],
      })),
  };
}

export async function renderCanvas(
  template: TemplateDocument,
  image: ImageDocument,
  canvas: CanvasInstance,
  index: number,
  options: RenderImageOptions = {},
): Promise<RenderedCanvas> {
  const size = canvasSize(template, image.state, canvas);
  const continuous = isContinuousCarouselManifest(template.manifest);
  const renderSize = continuous
    ? continuousCarouselSize(template.manifest)
    : size;
  const scale = Math.min(4, Math.max(0.25, options.scale ?? 1));
  if (renderSize.width * renderSize.height * scale * scale > 48_000_000)
    throw new Error('Canvas is too large to render safely.');
  const format = options.format ?? 'png';
  const page = await (await browser()).newPage();
  page.setDefaultTimeout(10_000);
  try {
    await page.setViewport({
      width: renderSize.width,
      height: renderSize.height,
      deviceScaleFactor: scale,
    });
    const state = effectiveCanvasState(template.manifest, image.state, canvas);
    await page.setContent(
      buildTemplateDocument(
        template,
        state,
        false,
        runtimeContext(
          template,
          canvas,
          index,
          canvasInstances(template.manifest, image.state).length,
        ),
      ),
      { waitUntil: 'load', timeout: 10_000 },
    );
    await page.waitForFunction(
      () => document.documentElement.dataset.imageBuilderReady === 'true',
    );
    await page.evaluate(() => document.fonts.ready);
    const element = await page.$('#ib-canvas');
    if (!element)
      throw new Error('Template must contain an element with id="ib-canvas".');
    const screenshotOptions = imageScreenshotOptions(format, options);
    let bytes: Uint8Array;
    if (continuous) {
      const bounds = await element.boundingBox();
      if (!bounds)
        throw new Error('The continuous carousel canvas is not visible.');
      const direction = template.manifest.carousel!.direction;
      bytes = await page.screenshot({
        ...screenshotOptions,
        clip: {
          x: bounds.x + (direction === 'horizontal' ? index * size.width : 0),
          y: bounds.y + (direction === 'vertical' ? index * size.height : 0),
          width: size.width,
          height: size.height,
        },
      });
    } else {
      bytes = await element.screenshot(screenshotOptions);
    }
    return {
      canvas,
      bytes: Buffer.from(bytes),
      width: size.width,
      height: size.height,
    };
  } finally {
    await page.close();
  }
}

export async function renderCanvases(
  template: TemplateDocument,
  image: ImageDocument,
  options: RenderImageOptions = {},
) {
  const canvases = canvasInstances(template.manifest, image.state);
  const rendered: RenderedCanvas[] = [];
  for (const [index, canvas] of canvases.entries())
    rendered.push(await renderCanvas(template, image, canvas, index, options));
  return rendered;
}

export async function renderPng(
  template: TemplateDocument,
  image: ImageDocument,
): Promise<Buffer> {
  const canvas = canvasInstances(template.manifest, image.state)[0];
  return (await renderCanvas(template, image, canvas, 0, { format: 'png' }))
    .bytes;
}

const safeStem = (value: string) =>
  value
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'canvas';

export function canvasFilename(
  template: TemplateDocument,
  image: ImageDocument,
  canvas: CanvasInstance,
  index: number,
  format: ExportImageFormat,
) {
  const pattern = template.manifest.export?.filenamePattern ?? '{index}-{name}';
  const digits = Math.max(
    2,
    String(canvasInstances(template.manifest, image.state).length).length,
  );
  const stem = pattern
    .replaceAll('{index}', String(index + 1).padStart(digits, '0'))
    .replaceAll('{name}', canvas.name)
    .replaceAll('{id}', canvas.id)
    .replaceAll('{title}', image.title)
    .replaceAll('{format}', format);
  return `${safeStem(stem).toLowerCase()}.${format === 'jpeg' ? 'jpg' : format}`;
}

export async function renderZip(
  template: TemplateDocument,
  image: ImageDocument,
  options: RenderImageOptions = {},
) {
  const format = options.format ?? 'png';
  const rendered = await renderCanvases(template, image, {
    ...options,
    format,
  });
  const entries: Record<string, Uint8Array> = {};
  rendered.forEach((item, index) => {
    entries[canvasFilename(template, image, item.canvas, index, format)] =
      item.bytes;
  });
  return Buffer.from(zipSync(entries, { level: 0 }));
}

const pagePresets: Record<'16:9' | '4:3' | 'A4' | 'Letter', [number, number]> =
  {
    '16:9': [720, 405],
    '4:3': [720, 540],
    A4: [595.28, 841.89],
    Letter: [612, 792],
  };

function oriented(
  size: [number, number],
  orientation: 'portrait' | 'landscape' | 'auto',
  canvas: RenderedCanvas,
): [number, number] {
  const presetLandscape = size[0] >= size[1];
  if (orientation === 'auto') {
    const canvasLandscape = canvas.width >= canvas.height;
    return canvasLandscape === presetLandscape ? size : [size[1], size[0]];
  }
  const landscape = orientation === 'landscape';
  return landscape === presetLandscape ? size : [size[1], size[0]];
}

export async function renderPdf(
  template: TemplateDocument,
  image: ImageDocument,
  scale?: number,
) {
  const settings = template.manifest.export?.pdf ?? {};
  const renderScale = scale ?? (settings.quality === 'print' ? 2 : 1);
  const rendered = await renderCanvases(template, image, {
    format: 'png',
    scale: renderScale,
    includeBackground: settings.includeBackground,
  });
  const pdf = await PDFDocument.create();
  if (settings.title) pdf.setTitle(settings.title);
  if (settings.author) pdf.setAuthor(settings.author);
  for (const item of rendered) {
    const imageAsset = await pdf.embedPng(item.bytes);
    const margin = settings.margins ?? 0;
    const bleed = settings.bleed ?? 0;
    const natural: [number, number] = [item.width * 0.75, item.height * 0.75];
    const base =
      settings.pageSize && settings.pageSize !== 'canvas'
        ? pagePresets[settings.pageSize]
        : natural;
    const [baseWidth, baseHeight] = oriented(
      base,
      settings.orientation ?? 'auto',
      item,
    );
    const page = pdf.addPage([baseWidth + bleed * 2, baseHeight + bleed * 2]);
    const availableWidth = Math.max(1, baseWidth - margin * 2);
    const availableHeight = Math.max(1, baseHeight - margin * 2);
    const fit = Math.min(
      availableWidth / imageAsset.width,
      availableHeight / imageAsset.height,
    );
    const width = imageAsset.width * fit;
    const height = imageAsset.height * fit;
    page.drawImage(imageAsset, {
      x: bleed + (baseWidth - width) / 2,
      y: bleed + (baseHeight - height) / 2,
      width,
      height,
    });
  }
  return Buffer.from(await pdf.save());
}

export async function closeRenderer() {
  const pending = browserPromise;
  browserPromise = undefined;
  if (pending)
    await pending.then((instance) => instance.close()).catch(() => undefined);
}
