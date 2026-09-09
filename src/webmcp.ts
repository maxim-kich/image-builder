import { useEffect } from 'react';
import { api } from './api';

declare global {
  interface Document {
    modelContext?: {
      registerTool(tool: Record<string, unknown>, options?: { signal?: AbortSignal }): void | Promise<void>;
    };
  }
}

export function useImageBuilderWebMcp(onCreated: (id: string) => void) {
  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: Record<string, unknown>) => {
      void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined);
    };

    register({
      name: 'list_image_builder_templates',
      title: 'List image templates',
      description: 'List reusable templates currently available in Image Builder.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async () => (await api.listTemplates()).map(({ id, name, description }) => ({ id, name, description })),
    });
    register({
      name: 'create_image_builder_image',
      title: 'Create image draft',
      description: 'Create a persistent image draft from a selected Image Builder template.',
      inputSchema: {
        type: 'object',
        properties: { templateId: { type: 'string' }, title: { type: 'string' } },
        required: ['templateId'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input: unknown) => {
        const value = input as { templateId?: string; title?: string };
        if (!value.templateId) throw new Error('templateId is required');
        const image = await api.createImage(value.templateId, value.title);
        onCreated(image.id);
        return { id: image.id, title: image.title, editPath: `/edit/${image.id}` };
      },
    });
    return () => lifecycle.abort();
  }, [onCreated]);
}
