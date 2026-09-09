# Coolify deployment and Hermes MCP

This is a single-owner application. The browser, REST API, and MCP share one bearer token. No Auth0 setup is required. Anyone with that token can read, edit, export, and delete drafts and install executable HTML templates.

## What belongs in GitHub

Publish the application source and the three starter HTML files in `examples/templates/`. Do not publish local databases, uploaded templates, image drafts, exported images, `.env` files, or tokens. Those application records live in the database, not in the bundled examples.

The Git and Docker ignore files exclude local data, exports, credentials, retired local templates, and agent/graph tooling. A new database starts with three templates and an empty gallery.

## Deploy

1. Create a Coolify application from the GitHub repository.
2. Select the Docker Compose build pack and `/compose.remote.yaml`.
3. Set these runtime environment variables in Coolify:

   | Variable | Value |
   | --- | --- |
   | `IMAGE_BUILDER_PUBLIC_URL` | Public HTTPS origin, such as `https://images.example.com` |
   | `IMAGE_BUILDER_API_TOKEN` | Your private access token (minimum 6 characters; longer random tokens recommended) |
   | `POSTGRES_PASSWORD` | A different random password; hexadecimal avoids URL-encoding issues |

4. Assign the HTTPS domain to `image-builder`, routing to container port `8080`. Point the domain's DNS at your server. Do not expose PostgreSQL publicly.
5. Deploy. Check `/api/v1/health`, sign into the browser with the bearer token, and export an image.
6. Configure PostgreSQL backups. Keep the `image_builder_postgres` named volume across redeployments. Do not use `docker compose down -v` on a real deployment: it removes persistent data.

See [Coolify's Compose documentation](https://coolify.io/docs/knowledge-base/docker/compose) and [domain routing documentation](https://coolify.io/docs/knowledge-base/domains).

## Container renderer

The Docker image sets `CHROME_NO_SANDBOX=1` because Chromium's namespace sandbox is unavailable under the tested default Docker permissions. The Compose application runs as the `node` user, drops all Linux capabilities, prevents privilege escalation, uses a read-only root filesystem, and provides temporary writable storage. It does not request privileged mode or `SYS_ADMIN`.

These container restrictions do not replace Chromium's sandbox. Install only templates you trust. This deployment is intended for an owner and their trusted agents, not anonymous users uploading arbitrary HTML. Local non-Docker execution keeps Chromium's sandbox enabled by default.

## Hermes

Set `IMAGE_BUILDER_API_TOKEN` privately in the environment used by your active Hermes instance. Add this to that instance's `config.yaml`:

```yaml
mcp_servers:
  image-builder:
    url: "https://images.example.com/mcp"
    headers:
      Authorization: "Bearer ${IMAGE_BUILDER_API_TOKEN}"
```

Use the same token as the Coolify application. Restart or reload the active Hermes instance, then ask it to list Image Builder templates and create a draft. Keep credentials out of chat and source control. [Hermes MCP configuration](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp).

The endpoint exposes nine tools, including template upload, draft creation/update, PNG rendering, and deletion. ZIP and PDF exports are available through the REST API and browser.

## Release verification

Before deploying a release, run `npm ci`, `npm run build`, `npm test`, `npm run lint`, and `npm audit`. Test the Compose stack against a disposable database, including PNG/ZIP/PDF exports, missing/wrong-token rejection, authenticated MCP, and persistence after container recreation. Confirm the final Git candidate list contains only source files and the three bundled starter templates.
