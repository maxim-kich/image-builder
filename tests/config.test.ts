import { describe, expect, it } from 'vitest';
import { loadConfig } from '../server/config';

const production = {
  NODE_ENV: 'production',
  IMAGE_BUILDER_PUBLIC_URL: 'https://img-builder.maximkich.com',
};

describe('API token configuration', () => {
  it('accepts six-character tokens in production after trimming', () => {
    expect(loadConfig({ ...production, IMAGE_BUILDER_API_TOKEN: ' sixsix ' }).apiToken).toBe('sixsix');
  });

  it('rejects shorter tokens and still requires production authentication', () => {
    expect(() => loadConfig({ ...production, IMAGE_BUILDER_API_TOKEN: 'short' })).toThrow('at least 6 characters');
    expect(() => loadConfig({ ...production, IMAGE_BUILDER_API_TOKEN: '   ' })).toThrow('required in production');
    expect(() => loadConfig(production)).toThrow('required in production');
  });
});
