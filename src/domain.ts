export type JsonPrimitive = string | number | boolean | null;
export type StateValue =
  | JsonPrimitive
  | StateValue[]
  | { [key: string]: StateValue };
export type ImageState = Record<string, StateValue>;

export type TemplateControlType =
  | 'text'
  | 'image'
  | 'number'
  | 'select'
  | 'boolean'
  | 'toggle'
  | 'color'
  | 'spacing'
  | 'border'
  | 'size'
  | 'position';

export type TemplateControlScope = 'template' | 'canvas' | 'element' | 'export';

export interface TemplateControl {
  key: string;
  label: string;
  type: TemplateControlType;
  scope?: TemplateControlScope;
  canvasId?: string;
  elementId?: string;
  default?: StateValue;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ label: string; value: string | number }>;
  hint?: string;
}

export type CanvasEditableProperty =
  | 'width'
  | 'height'
  | 'background'
  | 'backgroundImage'
  | 'padding'
  | 'spacing'
  | 'cornerRadius'
  | 'borderColor'
  | 'borderWidth'
  | 'borderStyle'
  | 'borderRadius'
  | 'shadow'
  | 'safeAreaGuides';

export interface TemplateCanvas {
  id: string;
  name: string;
  width?: number;
  height?: number;
  state?: ImageState;
  editable?: CanvasEditableProperty[];
}

export interface TemplateCanvasRules {
  allowAdd?: boolean;
  allowDelete?: boolean;
  allowDuplicate?: boolean;
  allowRename?: boolean;
  allowReorder?: boolean;
  min?: number;
  max?: number;
  sharedSize?: boolean;
}

export interface ContinuousCarouselSegment {
  id: string;
  name: string;
}

export interface ContinuousCarousel {
  mode: 'continuous';
  direction: 'horizontal' | 'vertical';
  segments: ContinuousCarouselSegment[];
  showGuides?: boolean;
}

export interface TemplateElement {
  id: string;
  label: string;
  type: 'text' | 'image' | 'shape' | 'icon' | 'group';
  canvasIds?: string[];
  allow?: Array<
    'move' | 'resize' | 'rotate' | 'reorder' | 'duplicate' | 'delete'
  >;
}

export type ExportImageFormat = 'png' | 'jpeg' | 'webp';
export type ExportScale = 1 | 2 | 'custom';

export interface TemplatePdfExport {
  enabled?: boolean;
  pageSize?: 'canvas' | '16:9' | '4:3' | 'A4' | 'Letter';
  orientation?: 'portrait' | 'landscape' | 'auto';
  quality?: 'screen' | 'print';
  margins?: number;
  bleed?: number;
  includeBackground?: boolean;
  filename?: string;
  title?: string;
  author?: string;
}

export interface TemplateExport {
  currentCanvas?: boolean;
  separateImages?: boolean;
  zip?: boolean;
  formats?: ExportImageFormat[];
  defaultFormat?: ExportImageFormat;
  scales?: ExportScale[];
  defaultScale?: number;
  filenamePattern?: string;
  pdf?: TemplatePdfExport;
}

export interface TemplateManifest {
  version?: 1 | 2;
  name: string;
  description: string;
  width: number;
  height: number;
  controls: TemplateControl[];
  canvases?: TemplateCanvas[];
  carousel?: ContinuousCarousel;
  canvasRules?: TemplateCanvasRules;
  sharedStyles?: ImageState;
  elements?: TemplateElement[];
  export?: TemplateExport;
}

export interface TemplateDocument {
  id: string;
  name: string;
  description: string;
  html: string;
  manifest: TemplateManifest;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface CanvasInstance {
  id: string;
  templateCanvasId: string;
  name: string;
  width?: number;
  height?: number;
  state: ImageState;
}

export interface ImageDocument {
  id: string;
  title: string;
  templateId: string;
  state: ImageState;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

const canvasStateKey = '__canvases';
const templateStateKey = '__template';
const sharedStylesKey = '__sharedStyles';
const exportStateKey = '__export';
const carouselStateKey = '__carousel';

function controlsFor(manifest: TemplateManifest, scope: TemplateControlScope) {
  return manifest.controls.filter(
    (control) => (control.scope ?? 'canvas') === scope,
  );
}

function defaultsFor(controls: TemplateControl[]) {
  return Object.fromEntries(
    controls
      .filter((control) => control.default !== undefined)
      .map((control) => [control.key, structuredClone(control.default!)]),
  ) as ImageState;
}

export function isMultiCanvasManifest(manifest: TemplateManifest) {
  return Boolean(manifest.canvases?.length);
}

export function isContinuousCarouselManifest(manifest: TemplateManifest) {
  return manifest.carousel?.mode === 'continuous';
}

export function defaultStateFor(manifest: TemplateManifest): ImageState {
  if (
    !isMultiCanvasManifest(manifest) &&
    !isContinuousCarouselManifest(manifest)
  )
    return defaultsFor(manifest.controls);
  const templateDefaults = defaultsFor(controlsFor(manifest, 'template'));
  const canvasDefaults = defaultsFor(controlsFor(manifest, 'canvas'));
  const exportDefaults = defaultsFor(controlsFor(manifest, 'export'));
  if (isContinuousCarouselManifest(manifest)) {
    return {
      [templateStateKey]: templateDefaults,
      [sharedStylesKey]: structuredClone(manifest.sharedStyles ?? {}),
      [carouselStateKey]: canvasDefaults,
      [exportStateKey]: exportDefaults,
    };
  }
  return {
    [templateStateKey]: templateDefaults,
    [sharedStylesKey]: structuredClone(manifest.sharedStyles ?? {}),
    [canvasStateKey]: manifest.canvases!.map((canvas) => ({
      id: canvas.id,
      templateCanvasId: canvas.id,
      name: canvas.name,
      ...(canvas.width ? { width: canvas.width } : {}),
      ...(canvas.height ? { height: canvas.height } : {}),
      state: {
        ...structuredClone(canvasDefaults),
        ...structuredClone(canvas.state ?? {}),
      },
    })),
    [exportStateKey]: exportDefaults,
  };
}

function stateObject(value: StateValue | undefined): ImageState {
  return value && !Array.isArray(value) && typeof value === 'object'
    ? (value as ImageState)
    : {};
}

export function templateState(state: ImageState): ImageState {
  return stateObject(state[templateStateKey]);
}

export function sharedStyleState(state: ImageState): ImageState {
  return stateObject(state[sharedStylesKey]);
}

export function exportState(state: ImageState): ImageState {
  return stateObject(state[exportStateKey]);
}

export function carouselState(state: ImageState): ImageState {
  return stateObject(state[carouselStateKey]);
}

export function canvasInstances(
  manifest: TemplateManifest,
  state: ImageState,
): CanvasInstance[] {
  if (isContinuousCarouselManifest(manifest)) {
    const sharedState = carouselState(state);
    return manifest.carousel!.segments.map((segment) => ({
      id: segment.id,
      templateCanvasId: segment.id,
      name: segment.name,
      width: manifest.width,
      height: manifest.height,
      state: sharedState,
    }));
  }
  if (!isMultiCanvasManifest(manifest)) {
    return [
      { id: 'canvas', templateCanvasId: 'canvas', name: 'Canvas 1', state },
    ];
  }
  const value = state[canvasStateKey];
  if (!Array.isArray(value))
    return defaultStateFor(manifest)[
      canvasStateKey
    ] as unknown as CanvasInstance[];
  const parsed = (value as unknown[]).filter((item): item is CanvasInstance =>
    Boolean(
      item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      typeof (item as { id?: unknown }).id === 'string',
    ),
  );
  return parsed.length
    ? parsed
    : (defaultStateFor(manifest)[
        canvasStateKey
      ] as unknown as CanvasInstance[]);
}

export function withCanvasInstances(
  state: ImageState,
  canvases: CanvasInstance[],
): ImageState {
  return { ...state, [canvasStateKey]: canvases as unknown as StateValue };
}

export function withTemplateState(
  state: ImageState,
  value: ImageState,
): ImageState {
  return { ...state, [templateStateKey]: value };
}

export function withExportState(
  state: ImageState,
  value: ImageState,
): ImageState {
  return { ...state, [exportStateKey]: value };
}

export function withCarouselState(
  state: ImageState,
  value: ImageState,
): ImageState {
  return { ...state, [carouselStateKey]: value };
}

export function effectiveCanvasState(
  manifest: TemplateManifest,
  state: ImageState,
  canvas: CanvasInstance,
): ImageState {
  if (isContinuousCarouselManifest(manifest)) {
    return {
      ...sharedStyleState(state),
      ...templateState(state),
      ...carouselState(state),
    };
  }
  if (!isMultiCanvasManifest(manifest)) return state;
  return {
    ...sharedStyleState(state),
    ...templateState(state),
    ...canvas.state,
  };
}

export function templateCanvasFor(
  manifest: TemplateManifest,
  canvas: CanvasInstance,
) {
  return (
    manifest.canvases?.find((item) => item.id === canvas.templateCanvasId) ??
    manifest.canvases?.[0]
  );
}

export function continuousCarouselSize(manifest: TemplateManifest) {
  const count = manifest.carousel?.segments.length ?? 1;
  return manifest.carousel?.direction === 'vertical'
    ? { width: manifest.width, height: manifest.height * count }
    : { width: manifest.width * count, height: manifest.height };
}

export function canvasSize(
  template: TemplateDocument,
  state: ImageState,
  canvas?: CanvasInstance,
) {
  if (canvas && isMultiCanvasManifest(template.manifest)) {
    const definition = templateCanvasFor(template.manifest, canvas);
    return {
      width: Math.min(
        4000,
        Math.max(
          64,
          Math.round(
            canvas.width ?? definition?.width ?? template.manifest.width,
          ),
        ),
      ),
      height: Math.min(
        4000,
        Math.max(
          64,
          Math.round(
            canvas.height ?? definition?.height ?? template.manifest.height,
          ),
        ),
      ),
    };
  }
  const dynamicWidth = Number(state.canvasWidth);
  const dynamicHeight = Number(state.canvasHeight);
  return {
    width:
      template.id === 'fit-frame' && Number.isFinite(dynamicWidth)
        ? Math.min(4000, Math.max(64, Math.round(dynamicWidth)))
        : template.manifest.width,
    height:
      template.id === 'fit-frame' && Number.isFinite(dynamicHeight)
        ? Math.min(4000, Math.max(64, Math.round(dynamicHeight)))
        : template.manifest.height,
  };
}

export function templateCanvasCount(manifest: TemplateManifest) {
  return manifest.canvases?.length ?? manifest.carousel?.segments.length ?? 1;
}
