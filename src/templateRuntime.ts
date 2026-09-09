import type { ImageState, TemplateDocument } from './domain';

export interface TemplateRuntimeContext {
  canvas?: {
    id: string;
    templateCanvasId: string;
    name: string;
    index: number;
    count: number;
    width: number;
    height: number;
    editable: string[];
  };
  carousel?: {
    mode: 'continuous';
    direction: 'horizontal' | 'vertical';
    width: number;
    height: number;
    segmentWidth: number;
    segmentHeight: number;
    segments: Array<{ id: string; name: string; index: number }>;
  };
  elements?: Array<{
    id: string;
    label: string;
    type: string;
    allow: string[];
  }>;
}

function serialized(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

const CSP = [
  "default-src 'none'",
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data:',
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export function buildTemplateDocument(
  template: Pick<TemplateDocument, 'html'>,
  initialState: ImageState,
  interactive: boolean,
  runtimeContext: TemplateRuntimeContext = {},
): string {
  const bootstrap = `<meta http-equiv="Content-Security-Policy" content="${CSP}">
<script>
(() => {
  let state = ${serialized(initialState)};
  let context = ${serialized(runtimeContext)};
  const interactive = ${interactive ? 'true' : 'false'};
  const clone = () => JSON.parse(JSON.stringify(state));
  const notify = () => {
    document.dispatchEvent(new CustomEvent('imagebuilder:state', { detail: { state: clone(), context, interactive } }));
  };
  const applyCanvasProperties = () => {
    const canvas = document.querySelector('#ib-canvas');
    if (!(canvas instanceof HTMLElement) || !context.canvas) return;
    const editable = new Set(context.canvas.editable || []);
    const unit = (value) => typeof value === 'number' ? value + 'px' : String(value);
    if (context.carousel) {
      canvas.style.width = context.carousel.width + 'px';
      canvas.style.height = context.carousel.height + 'px';
      canvas.style.setProperty('--ib-carousel-width', context.carousel.width + 'px');
      canvas.style.setProperty('--ib-carousel-height', context.carousel.height + 'px');
      canvas.style.setProperty('--ib-segment-width', context.carousel.segmentWidth + 'px');
      canvas.style.setProperty('--ib-segment-height', context.carousel.segmentHeight + 'px');
      canvas.style.setProperty('--ib-segment-count', String(context.carousel.segments.length));
    }
    if (editable.has('background') && state.background != null) canvas.style.background = String(state.background);
    if (editable.has('backgroundImage') && typeof state.backgroundImage === 'string') canvas.style.backgroundImage = 'url(' + JSON.stringify(state.backgroundImage) + ')';
    if (editable.has('padding') && state.padding != null) canvas.style.padding = unit(state.padding);
    if (editable.has('spacing') && state.spacing != null) canvas.style.gap = unit(state.spacing);
    if (editable.has('cornerRadius') && state.cornerRadius != null) canvas.style.borderRadius = unit(state.cornerRadius);
    if (editable.has('borderRadius') && state.borderRadius != null) canvas.style.borderRadius = unit(state.borderRadius);
    if (editable.has('borderColor') && state.borderColor != null) canvas.style.borderColor = String(state.borderColor);
    if (editable.has('borderWidth') && state.borderWidth != null) canvas.style.borderWidth = unit(state.borderWidth);
    if (editable.has('borderStyle') && state.borderStyle != null) canvas.style.borderStyle = String(state.borderStyle);
    if (editable.has('shadow') && state.shadow != null) canvas.style.boxShadow = String(state.shadow);
    let guide = canvas.querySelector(':scope > [data-ib-safe-area]');
    if (interactive && editable.has('safeAreaGuides') && state.safeAreaGuides) {
      if (!guide) {
        guide = document.createElement('div');
        guide.setAttribute('data-ib-safe-area', '');
        guide.setAttribute('aria-hidden', 'true');
        Object.assign(guide.style, { position: 'absolute', inset: '5%', border: '2px dashed rgba(255,255,255,.65)', pointerEvents: 'none', zIndex: '2147483647' });
        canvas.appendChild(guide);
      }
    } else guide?.remove();
  };
  const applyBindings = () => {
    document.querySelectorAll('[data-ib-text]').forEach((node) => {
      const key = node.getAttribute('data-ib-text');
      node.textContent = state[key] == null ? '' : String(state[key]);
    });
    document.querySelectorAll('[data-ib-image]').forEach((node) => {
      const key = node.getAttribute('data-ib-image');
      const value = state[key];
      if (node instanceof HTMLImageElement) {
        const next = typeof value === 'string' ? value : '';
        if (node.getAttribute('src') !== next) {
          if (next) node.setAttribute('src', next);
          else node.removeAttribute('src');
        }
        node.hidden = !value;
      }
    });
    applyCanvasProperties();
    notify();
  };
  window.ImageBuilder = {
    interactive,
    getState: clone,
    getContext() { return JSON.parse(JSON.stringify(context)); },
    setState(next) { state = { ...next }; applyBindings(); },
    patchState(patch) {
      state = { ...state, ...patch };
      applyBindings();
      if (interactive) parent.postMessage({ type: 'imagebuilder:state', state: clone(), patch: JSON.parse(JSON.stringify(patch)) }, '*');
    },
    requestImage(key = 'image') {
      if (interactive) parent.postMessage({ type: 'imagebuilder:request-image', key }, '*');
    },
    selectElement(id) {
      if (interactive) parent.postMessage({ type: 'imagebuilder:select-element', id }, '*');
    },
  };
  addEventListener('message', (event) => {
    if (event.data?.type === 'imagebuilder:set-state' && event.data.state) {
      if (event.data.context) context = JSON.parse(JSON.stringify(event.data.context));
      window.ImageBuilder.setState(event.data.state);
    }
  });
  const ready = () => {
    applyBindings();
    if (interactive) document.addEventListener('click', (event) => {
      parent.postMessage({ type: 'imagebuilder:focus-canvas', x: event.clientX, y: event.clientY }, '*');
      const clicked = event.target instanceof Element ? event.target : null;
      const target = clicked?.closest('[data-ib-element]');
      const binding = clicked?.closest('[data-ib-text], [data-ib-image]');
      const id = target?.getAttribute('data-ib-element') ?? '';
      const bound = target ? [target, ...target.querySelectorAll('[data-ib-text], [data-ib-image]')] : binding ? [binding] : [];
      const keys = [...new Set(bound.flatMap((node) => [node.getAttribute('data-ib-text'), node.getAttribute('data-ib-image')]).filter(Boolean))];
      if (id || keys.length > 0) parent.postMessage({ type: 'imagebuilder:select-element', id, keys }, '*');
    });
    document.documentElement.dataset.imageBuilderReady = 'true';
    parent.postMessage({ type: 'imagebuilder:ready' }, '*');
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();
</script>`;

  if (/<head(?:\s[^>]*)?>/i.test(template.html)) {
    return template.html.replace(
      /<head(\s[^>]*)?>/i,
      (match) => `${match}${bootstrap}`,
    );
  }
  return `<!doctype html><html><head>${bootstrap}</head><body>${template.html}</body></html>`;
}

declare global {
  interface Window {
    ImageBuilder?: {
      interactive: boolean;
      getState(): ImageState;
      getContext(): TemplateRuntimeContext;
      setState(state: ImageState): void;
      patchState(patch: ImageState): void;
      requestImage(key?: string): void;
      selectElement(id: string): void;
    };
  }
}
