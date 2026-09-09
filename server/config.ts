import { resolve } from 'node:path';

const MIN_API_TOKEN_LENGTH = 6;

export interface AppConfig {
  host: string;
  port: number;
  publicUrl: string;
  databaseUrl: string;
  apiToken?: string;
  isProduction: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT ?? env.IMAGE_BUILDER_PORT ?? 5180);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT must be between 1 and 65535.');
  const isProduction = env.NODE_ENV === 'production';
  const host = env.HOST ?? env.IMAGE_BUILDER_HOST ?? (isProduction ? '0.0.0.0' : '127.0.0.1');
  const publicUrl = (env.IMAGE_BUILDER_PUBLIC_URL ?? `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`).replace(/\/$/, '');
  const apiToken = env.IMAGE_BUILDER_API_TOKEN?.trim() || undefined;
  if (isProduction && !apiToken) throw new Error('IMAGE_BUILDER_API_TOKEN is required in production.');
  if (apiToken && apiToken.length < MIN_API_TOKEN_LENGTH) throw new Error(`IMAGE_BUILDER_API_TOKEN must contain at least ${MIN_API_TOKEN_LENGTH} characters.`);
  const localPublicUrl = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(publicUrl);
  if (isProduction && !publicUrl.startsWith('https://') && !localPublicUrl) throw new Error('IMAGE_BUILDER_PUBLIC_URL must use HTTPS in production unless it is localhost.');
  return {
    host,
    port,
    publicUrl,
    apiToken,
    isProduction,
    databaseUrl: env.DATABASE_URL?.trim() || `sqlite:${resolve('data/image-builder.sqlite')}`,
  };
}
