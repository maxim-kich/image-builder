import { buildApp } from './app';
import { loadConfig } from './config';
import { createStorage } from './storage';
import { loadBuiltinTemplates } from './builtins';

const config = loadConfig();
const storage = createStorage(config.databaseUrl);
await storage.init(await loadBuiltinTemplates());
const app = await buildApp({ config, storage });
await app.listen({ host: config.host, port: config.port });
