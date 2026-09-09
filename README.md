## Slop-Disclaimer

It's a vibe coded app, that works as a tool for my agents. You can self host it locally or on VPS and connect your agent to it, both REST or MCP supported.

Use it as you wish. There is no contribution expected. And of course this readme was not meant to be read by humans, let your agent read and explain it for you.


# Image Builder

A small, self-hosted editor for preparing reusable images, carousels, presentations, and documents. It has two top-level views:

- **Gallery** keeps persistent image drafts and their exports.
- **Templates** starts with three preinstalled examples: **Basic statement**, **Three-part story**, and **Continuous carousel starter**. Users can also upload HTML templates.

Version 2 templates can define either independent ordered canvases or one continuous carousel surface cropped into ordered segments. Both support image, ZIP, and multi-page PDF exports; independent canvases also support structural editing and per-canvas state.

## Run locally

Requires Node 22+ and Chrome or Chromium for PNG export.

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5180`. Local data is stored in `data/image-builder.sqlite`.

If port `5180` is already in use:

```bash
PORT=5190 npm run dev
```

## Build and run

```bash
npm run build
IMAGE_BUILDER_API_TOKEN='a-long-random-token' \
IMAGE_BUILDER_PUBLIC_URL='http://localhost:5180' \
PORT=5180 npm start
```

New installations seed the three example templates automatically. Restarting keeps their IDs stable and respects deleted built-ins. Retired templates remain available to existing drafts.

Production mode requires `IMAGE_BUILDER_API_TOKEN`. The browser keeps that token in session storage and sends it as a bearer token. Remote deployments must use an HTTPS public URL.

## Docker

Local Docker with persistent SQLite:

```bash
cp .env.example .env
# replace IMAGE_BUILDER_API_TOKEN in .env
docker compose up --build
```

For a VPS with a reverse proxy and PostgreSQL:

```bash
docker compose -f compose.remote.yaml up -d --build
```

Set `IMAGE_BUILDER_PUBLIC_URL` to the public HTTPS origin, `IMAGE_BUILDER_API_TOKEN` to a long random token, and `POSTGRES_PASSWORD` to a separate database password. Point the reverse proxy at the `image-builder` service on port `8080`.

## REST API

OpenAPI is available at `/api/v1/openapi.json`. Main routes:

```text
GET    /api/v1/templates
POST   /api/v1/templates             { "html": "<!doctype html>..." }
GET    /api/v1/images
POST   /api/v1/images                { "templateId": "basic-card", "title": "Post" }
GET    /api/v1/images/:id
PATCH  /api/v1/images/:id            { "state": {...}, "expectedRevision": 1 }
POST   /api/v1/images/:id/duplicate
GET    /api/v1/images/:id/png
GET    /api/v1/images/:id/export     ?canvasId=...&format=png&scale=1
GET    /api/v1/images/:id/zip        ?format=png&scale=1
GET    /api/v1/images/:id/pdf        ?scale=1
DELETE /api/v1/images/:id
```

When a token is configured, add `Authorization: Bearer <token>`.

## MCP

The Streamable HTTP MCP endpoint is `/mcp`. It uses the same bearer token as REST and exposes:

```text
list_templates · get_template · upload_template · list_images · get_image
create_image · update_image · render_image · delete_image
```

Example client configuration:

```json
{
  "mcpServers": {
    "image-builder": {
      "type": "http",
      "url": "https://images.example.com/mcp",
      "headers": { "Authorization": "Bearer ${IMAGE_BUILDER_API_TOKEN}" }
    }
  }
}
```

The `render_image` tool returns the exported PNG in the MCP response. Writes support revisions so an agent can avoid overwriting a newer browser or agent edit.

## HTML templates

Read [the template authoring contract](docs/template-authoring.md). It distinguishes separate multi-canvas documents from true continuous carousels and describes scoped controls, canvas rules, elements, export behavior, the JavaScript bridge, and security boundaries. Uploadable examples live at [examples/templates/basic-card.html](examples/templates/basic-card.html), [examples/templates/carousel-story.html](examples/templates/carousel-story.html), and [examples/templates/continuous-carousel.html](examples/templates/continuous-carousel.html).

The preview runs templates in an opaque sandbox with network access blocked. Export runs the same HTML in a short-lived Chromium page. Only install templates you trust, and keep their assets embedded.

## Architecture

```text
src/                    React editor, gallery, template library, shared runtime
server/                 Fastify REST API, Streamable HTTP MCP, storage, PNG renderer
examples/templates/     Three preinstalled templates and uploadable examples
docs/                   Template authoring contract
```

SQLite is the zero-configuration local default. A PostgreSQL implementation is selected automatically when `DATABASE_URL` starts with `postgres://` or `postgresql://`. The editor and renderer both call `buildTemplateDocument`, which prevents preview/export drift.
