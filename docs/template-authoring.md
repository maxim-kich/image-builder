# Image Builder HTML template contract

Image Builder templates are self-contained HTML files. The same file is used in the editor and in headless Chromium for export, so preview and export share one renderer. Version 1 single-canvas templates remain supported. Manifest version 2 has two different collection models: independent canvases for presentations and image sets, and one continuous carousel canvas that is cropped into segments at export.

## Required anatomy

Every template must include:

1. A JSON manifest in `<script id="image-builder-manifest" type="application/json">`.
2. One render root with `id="ib-canvas"`.
3. Inline CSS and embedded assets. Network access is blocked.

For single and independent multi-canvas templates, the render root represents the current canvas. A continuous carousel uses the same root as one large surface containing every segment.

## Version 1: single canvas

```html
<script id="image-builder-manifest" type="application/json">
  {
    "name": "Quote card",
    "description": "A square card with editable copy.",
    "width": 1080,
    "height": 1080,
    "controls": [
      {
        "key": "title",
        "label": "Title",
        "type": "text",
        "default": "A useful thought"
      },
      { "key": "image", "label": "Image", "type": "image" }
    ]
  }
</script>
<main id="ib-canvas">
  <img data-ib-image="image" alt="" />
  <h1 data-ib-text="title"></h1>
</main>
```

## Version 2: independent canvases

Add `"version": 2` and a `canvases` array. Canvas order in the array is the initial editor and export order.

These are separate render roots with separate per-canvas state. They are appropriate for presentations, PDF pages, image sets, and carousels whose slides do not need artwork to cross an edge. Placing related canvases next to each other in the editor does not turn them into one continuous surface.

```json
{
  "version": 2,
  "name": "Product carousel",
  "description": "Cover, feature, and details canvases.",
  "width": 1080,
  "height": 1350,
  "canvases": [
    { "id": "cover", "name": "Cover", "state": { "title": "Launch day" } },
    {
      "id": "feature",
      "name": "Feature",
      "state": { "title": "Built for focus" }
    },
    {
      "id": "details",
      "name": "Details",
      "state": { "title": "See the difference" }
    }
  ],
  "canvasRules": {
    "allowAdd": true,
    "allowDelete": true,
    "allowDuplicate": true,
    "allowRename": true,
    "allowReorder": true,
    "min": 2,
    "max": 12,
    "sharedSize": true
  },
  "controls": [
    {
      "key": "brand",
      "label": "Brand",
      "type": "text",
      "scope": "template",
      "default": "Acme"
    },
    { "key": "title", "label": "Headline", "type": "text", "scope": "canvas" }
  ]
}
```

Each canvas accepts:

| Field             | Type    | Notes                                                               |
| ----------------- | ------- | ------------------------------------------------------------------- |
| `id`              | string  | Stable author-defined identifier.                                   |
| `name`            | string  | Initial editor and filename label.                                  |
| `width`, `height` | integer | Optional 64–4000 px override. Otherwise inherits the template size. |
| `state`           | object  | Initial per-canvas values and optional style overrides.             |
| `editable`        | array   | Canvas properties the end user may change.                          |

The optional `canvasRules` object controls structural editing. `min` and `max` are 1–100. `sharedSize: true` applies width or height edits to every canvas. Add and delete are disabled unless explicitly enabled; duplicate, rename, and reorder are enabled by default.

## Version 2: continuous carousel

Use `carousel.mode: "continuous"` when artwork must cross from one exported image into the next. `width` and `height` describe one exported segment; Image Builder makes `#ib-canvas` wide or tall enough to hold every segment, displays non-exported split guides in the editor, and crops the one render root into ordered image files during export.

Do not combine `carousel` and `canvases` in one manifest. Independent canvases keep their existing behavior.

```json
{
  "version": 2,
  "name": "Continuous four-part carousel",
  "description": "One wide canvas exported as four square images.",
  "width": 1080,
  "height": 1080,
  "carousel": {
    "mode": "continuous",
    "direction": "horizontal",
    "segments": [
      { "id": "cover", "name": "Cover" },
      { "id": "idea", "name": "Idea" },
      { "id": "detail", "name": "Detail" },
      { "id": "finish", "name": "Finish" }
    ],
    "showGuides": true
  },
  "controls": [
    {
      "key": "accent",
      "label": "Accent",
      "type": "color",
      "scope": "template",
      "default": "#42c07e"
    }
  ]
}
```

`direction` may be `horizontal` or `vertical`. Segment identifiers must be unique. The complete render surface may not exceed 16,384 px in either direction. Continuous templates have one shared structure and one shared editing state, so use template-scoped controls for content that appears across the strip. The segment list controls selection, filenames, ZIP order, PDF page order, and export crop positions; it does not create separate DOM roots.

At runtime, Image Builder sets the root dimensions and these CSS custom properties:

```css
#ib-canvas {
  width: var(--ib-carousel-width);
  height: var(--ib-carousel-height);
}
/* Also available: --ib-segment-width, --ib-segment-height, --ib-segment-count. */
```

Position content anywhere on that full surface. For example, an image at `left: 900px; width: 500px` crosses the boundary between the first and second 1080 px segments and is split cleanly in the exported files. Split guides are editor-only and never appear in exports.

## Editable canvas properties

Put any supported property in a canvas's `editable` array:

```json
{
  "id": "cover",
  "name": "Cover",
  "editable": [
    "width",
    "height",
    "background",
    "backgroundImage",
    "padding",
    "spacing",
    "cornerRadius",
    "borderColor",
    "borderWidth",
    "borderStyle",
    "borderRadius",
    "shadow",
    "safeAreaGuides"
  ],
  "state": {
    "background": "linear-gradient(135deg, #274033, #111211)",
    "padding": 80,
    "safeAreaGuides": false
  }
}
```

Image Builder exposes matching controls and applies these values to `#ib-canvas`. Safe-area guides are editor-only and are omitted from export. Properties not listed in `editable` remain fixed by the template.

## Controls and scopes

Controls are grouped in the editor according to `scope`:

| Scope      | Meaning                                                        |
| ---------- | -------------------------------------------------------------- |
| `template` | One value shared by every canvas.                              |
| `canvas`   | A value stored on the current canvas. This is the default.     |
| `element`  | A current-canvas value shown when its `elementId` is selected. |
| `export`   | A saved export preference.                                     |

Use `canvasId` to show a control only for instances derived from one authored canvas. Element controls must define `elementId`.

Supported control types are `text`, `image`, `number`, `select`, `boolean`, `toggle`, `color`, `spacing`, `border`, `size`, and `position`. `size` stores `{ "width", "height" }`; `position` stores `{ "x", "y" }`. Values must be JSON-safe.

```json
{
  "key": "accent",
  "label": "Accent",
  "type": "color",
  "scope": "template",
  "default": "#42c07e"
}
```

## Elements and permissions

Describe editable elements in `elements` and mark their DOM nodes with `data-ib-element`:

```json
{
  "elements": [
    {
      "id": "headline",
      "label": "Headline",
      "type": "text",
      "allow": ["move", "resize"]
    },
    {
      "id": "photo",
      "label": "Photo",
      "type": "image",
      "canvasIds": ["cover"],
      "allow": ["move", "resize", "rotate", "reorder", "duplicate", "delete"]
    }
  ]
}
```

```html
<h1 data-ib-element="headline" data-ib-text="title"></h1>
```

Clicking a marked node selects it in the editor. The allowed operations are also available to template JavaScript through `ImageBuilder.getContext()`. Templates implement their own element geometry and call `patchState()` after an allowed interaction; the host keeps the structure and permission list fixed.

## Shared styles and per-canvas overrides

`sharedStyles` supplies reusable values to every canvas. Effective state is merged in this order:

1. shared styles;
2. template-scoped controls;
3. current-canvas state.

That makes per-canvas overrides optional and predictable. Put shared dimensions in top-level `width` and `height`, shared visual values in `sharedStyles`, and exceptions in a canvas's `state`, `width`, or `height`.

For independent canvases, the canvas runtime context includes `index` and `count`, so templates can create page numbers or coordinated backgrounds. A real edge-crossing composition must use the continuous carousel model above.

## Export settings

```json
{
  "export": {
    "currentCanvas": true,
    "separateImages": true,
    "zip": true,
    "formats": ["png", "jpeg", "webp"],
    "defaultFormat": "png",
    "scales": [1, 2, "custom"],
    "defaultScale": 1,
    "filenamePattern": "{index}-{name}",
    "pdf": {
      "enabled": true,
      "pageSize": "canvas",
      "orientation": "auto",
      "quality": "print",
      "margins": 0,
      "bleed": 0,
      "includeBackground": true,
      "filename": "product-carousel.pdf",
      "title": "Product carousel",
      "author": "Acme Studio"
    }
  }
}
```

Filename patterns support `{index}`, `{name}`, `{id}`, `{title}`, and `{format}`. Indices are zero-padded to at least two digits, so the default pattern produces `01-cover.png`, `02-feature.png`, and `03-details.png` in canvas order.

PDF page sizes are `canvas`, `16:9`, `4:3`, `A4`, and `Letter`. Each ordered independent canvas, or each cropped continuous-carousel segment, becomes one page. Orientation is `auto`, `portrait`, or `landscape`; quality is `screen` or `print`. Margins and bleed are PDF points.

## Runtime API

Image Builder injects the API before template scripts execute:

```js
window.ImageBuilder.getState();
window.ImageBuilder.getContext();
window.ImageBuilder.patchState({ zoom: 1.25 });
window.ImageBuilder.setState({ title: 'Replacement state' });
window.ImageBuilder.requestImage('photo');
window.ImageBuilder.selectElement('headline');
window.ImageBuilder.interactive;
```

`getContext()` returns the current canvas or selected export segment (`id`, `templateCanvasId`, `name`, `index`, `count`, `width`, `height`, and `editable`) plus its elements and allowed operations. Continuous templates also receive `context.carousel` with `mode`, `direction`, total `width` and `height`, segment dimensions, and the ordered `segments` list. Build the continuous layout from `context.carousel`; do not reposition the full composition from `context.canvas.index`, because that field only identifies the selected or exported crop.

Listen for updates to redraw custom behavior:

```js
document.addEventListener('imagebuilder:state', (event) => {
  const { state, context, interactive } = event.detail;
  document.querySelector('#title').textContent = state.title;
  document.querySelector('#page').textContent =
    `${context.canvas.index + 1} / ${context.canvas.count}`;
});
```

Use `patchState` for drag, zoom, toggles, or other interactions. It updates the current independent canvas, or the one shared state of a continuous carousel, and becomes part of the saved draft. Check `interactive` before attaching behavior that should not run during export. `requestImage(key)` opens the image picker for that state key.

The built-in `data-ib-text` and `data-ib-image` attributes remain available for simple bindings.

## Security and portability

- Templates preview in a sandboxed iframe without same-origin access.
- A content security policy blocks network requests, forms, plug-ins, and external objects.
- Inline JavaScript is allowed for template behavior.
- Fonts, images, and other required assets must be embedded as data URLs.
- HTML must be no larger than 1 MB. User images may be up to 8 MB each.
- Export runs template JavaScript in a dedicated Chromium page with a ten-second timeout.
- Only install templates you trust.

See [`examples/templates/basic-card.html`](../examples/templates/basic-card.html) for a version 1 starter, [`examples/templates/carousel-story.html`](../examples/templates/carousel-story.html) for an independent-canvas version 2 set, [`examples/templates/continuous-carousel.html`](../examples/templates/continuous-carousel.html) for a true edge-crossing carousel.
