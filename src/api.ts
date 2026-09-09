import type { ExportImageFormat, ImageDocument, ImageState, TemplateDocument } from './domain';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

const tokenKey = 'image-builder-api-token';

export function getApiToken() {
  return sessionStorage.getItem(tokenKey) ?? '';
}

export function setApiToken(token: string) {
  if (token) sessionStorage.setItem(tokenKey, token);
  else sessionStorage.removeItem(tokenKey);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getApiToken();
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(path, {
    ...options,
    headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new ApiError(response.status, body.message ?? body.error ?? 'Request failed');
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function download(path: string, fallbackName: string) {
  const token = getApiToken();
  const response = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body.message ?? 'Export failed');
  }
  const disposition = response.headers.get('content-disposition');
  const name = /filename="([^"]+)"/i.exec(disposition ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export const api = {
  health: () => request<{ ok: boolean; authRequired: boolean; storage: string }>('/api/v1/health'),
  listTemplates: () => request<{ items: TemplateDocument[] }>('/api/v1/templates').then((r) => r.items),
  getTemplate: (id: string) => request<TemplateDocument>(`/api/v1/templates/${id}`),
  uploadTemplate: (html: string) => request<TemplateDocument>('/api/v1/templates', {
    method: 'POST', body: JSON.stringify({ html }),
  }),
  deleteTemplate: (id: string) => request<void>(`/api/v1/templates/${id}`, { method: 'DELETE' }),
  async downloadTemplate(id: string, name: string) {
    const token = getApiToken();
    const response = await fetch(`/api/v1/templates/${id}/html`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new ApiError(response.status, 'Template download failed');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name.replace(/[^a-z0-9_-]+/gi, '-') || 'template'}.html`;
    link.click();
    URL.revokeObjectURL(url);
  },
  listImages: () => request<{ items: ImageDocument[] }>('/api/v1/images').then((r) => r.items),
  getImage: (id: string) => request<ImageDocument>(`/api/v1/images/${id}`),
  createImage: (templateId: string, title?: string) => request<ImageDocument>('/api/v1/images', {
    method: 'POST', body: JSON.stringify({ templateId, title }),
  }),
  updateImage: (id: string, state: ImageState, title: string, expectedRevision?: number) =>
    request<ImageDocument>(`/api/v1/images/${id}`, {
      method: 'PATCH', body: JSON.stringify({ state, title, expectedRevision }),
    }),
  duplicateImage: (id: string) => request<ImageDocument>(`/api/v1/images/${id}/duplicate`, { method: 'POST' }),
  deleteImage: (id: string) => request<void>(`/api/v1/images/${id}`, { method: 'DELETE' }),
  async downloadImage(id: string, title: string) {
    await download(`/api/v1/images/${id}/png`, `${title.replace(/[^a-z0-9_-]+/gi, '-') || 'image'}.png`);
  },
  downloadCanvas: (id: string, canvasId: string, format: ExportImageFormat, scale: number, title: string) =>
    download(`/api/v1/images/${id}/export?${new URLSearchParams({ canvasId, format, scale: String(scale) })}`, `${title}.${format}`),
  downloadZip: (id: string, format: ExportImageFormat, scale: number, title: string) =>
    download(`/api/v1/images/${id}/zip?${new URLSearchParams({ format, scale: String(scale) })}`, `${title}.zip`),
  downloadPdf: (id: string, scale: number, title: string) =>
    download(`/api/v1/images/${id}/pdf?${new URLSearchParams({ scale: String(scale) })}`, `${title}.pdf`),
};
