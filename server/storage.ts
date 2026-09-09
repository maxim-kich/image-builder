import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { ImageDocument, ImageState, TemplateDocument, TemplateManifest } from '../src/domain';
import { defaultStateFor } from '../src/domain';

export type UpdateResult<T> = { status: 'updated'; value: T } | { status: 'not_found' } | { status: 'conflict'; value: T };

export interface BuiltinTemplate { id: string; html: string; manifest: TemplateManifest }

export interface ImageBuilderStorage {
  kind: 'sqlite' | 'postgres';
  init(builtins: BuiltinTemplate[]): Promise<void>;
  archiveTemplate(id: string): Promise<void>;
  listTemplates(): Promise<TemplateDocument[]>;
  getTemplate(id: string): Promise<TemplateDocument | null>;
  createTemplate(html: string, manifest: TemplateManifest): Promise<TemplateDocument>;
  deleteTemplate(id: string): Promise<'deleted' | 'not_found'>;
  listImages(): Promise<ImageDocument[]>;
  getImage(id: string): Promise<ImageDocument | null>;
  createImage(input: { templateId: string; title?: string; state?: ImageState }): Promise<ImageDocument>;
  updateImage(id: string, input: { title?: string; state?: ImageState; expectedRevision?: number }): Promise<UpdateResult<ImageDocument>>;
  deleteImage(id: string): Promise<boolean>;
  close(): Promise<void>;
}

interface TemplateRow {
  id: string; name: string; description: string; html: string; manifest: string | TemplateManifest;
  built_in: number | boolean; created_at: string | Date; updated_at: string | Date; revision: number;
}
interface ImageRow {
  id: string; title: string; template_id: string; state: string | ImageState;
  created_at: string | Date; updated_at: string | Date; revision: number;
}

const iso = (value: string | Date) => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const templateFromRow = (row: TemplateRow): TemplateDocument => ({
  id: row.id, name: row.name, description: row.description, html: row.html,
  manifest: typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest,
  builtIn: Boolean(row.built_in), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), revision: Number(row.revision),
});
const imageFromRow = (row: ImageRow): ImageDocument => ({
  id: row.id, title: row.title, templateId: row.template_id,
  state: typeof row.state === 'string' ? JSON.parse(row.state) : row.state,
  createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), revision: Number(row.revision),
});

class SqliteStorage implements ImageBuilderStorage {
  readonly kind = 'sqlite' as const;
  private database?: DatabaseSync;
  constructor(private readonly path: string) {}

  async init(builtins: BuiltinTemplate[]) {
    if (this.path !== ':memory:') await mkdir(dirname(this.path), { recursive: true });
    this.database = new DatabaseSync(this.path);
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, html TEXT NOT NULL,
        manifest TEXT NOT NULL, built_in INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS images (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, template_id TEXT NOT NULL REFERENCES templates(id),
        state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS archived_templates (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS deleted_builtin_templates (
        id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS images_updated_at_idx ON images(updated_at DESC);
    `);
    const now = new Date().toISOString();
    for (const builtin of builtins) {
      const wasDeleted = this.db().prepare('SELECT 1 FROM deleted_builtin_templates WHERE id=?').get(builtin.id);
      if (wasDeleted) continue;
      this.db().prepare(`INSERT INTO templates (id,name,description,html,manifest,built_in,created_at,updated_at,revision)
        VALUES (?,?,?,?,?,1,?,?,1) ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, html=excluded.html, manifest=excluded.manifest, updated_at=excluded.updated_at, revision=templates.revision+1
        WHERE templates.html <> excluded.html OR templates.manifest <> excluded.manifest`)
        .run(builtin.id, builtin.manifest.name, builtin.manifest.description, builtin.html, JSON.stringify(builtin.manifest), now, now);
    }
    const retired = this.db().prepare('SELECT id FROM templates WHERE built_in=1').all();
    for (const row of retired) if (!builtins.some(item => item.id === row.id)) await this.archiveTemplate(String(row.id));
  }
  private db() { if (!this.database) throw new Error('Storage is not initialized.'); return this.database; }
  async archiveTemplate(id: string) { this.db().prepare('INSERT OR IGNORE INTO archived_templates (id) VALUES (?)').run(id); }
  async listTemplates() { return (this.db().prepare('SELECT * FROM templates WHERE id NOT IN (SELECT id FROM archived_templates) ORDER BY built_in DESC, updated_at DESC').all() as unknown as TemplateRow[]).map(templateFromRow); }
  async getTemplate(id: string) { const row = this.db().prepare('SELECT * FROM templates WHERE id=?').get(id) as unknown as TemplateRow | undefined; return row ? templateFromRow(row) : null; }
  async createTemplate(html: string, manifest: TemplateManifest) {
    const now = new Date().toISOString(); const id = randomUUID();
    this.db().prepare('INSERT INTO templates VALUES (?,?,?,?,?,0,?,?,1)').run(id, manifest.name, manifest.description, html, JSON.stringify(manifest), now, now);
    return (await this.getTemplate(id))!;
  }
  async deleteTemplate(id: string) {
    const template = await this.getTemplate(id); if (!template) return 'not_found' as const;
    const database = this.db();
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare('DELETE FROM images WHERE template_id=?').run(id);
      database.prepare('DELETE FROM templates WHERE id=?').run(id);
      if (template.builtIn) database.prepare('INSERT OR REPLACE INTO deleted_builtin_templates (id,deleted_at) VALUES (?,?)').run(id, new Date().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    return 'deleted' as const;
  }
  async listImages() { return (this.db().prepare('SELECT * FROM images ORDER BY updated_at DESC').all() as unknown as ImageRow[]).map(imageFromRow); }
  async getImage(id: string) { const row = this.db().prepare('SELECT * FROM images WHERE id=?').get(id) as unknown as ImageRow | undefined; return row ? imageFromRow(row) : null; }
  async createImage(input: { templateId: string; title?: string; state?: ImageState }) {
    const template = await this.getTemplate(input.templateId); if (!template) throw new Error(`Template ${input.templateId} was not found.`);
    const now = new Date().toISOString(); const id = randomUUID();
    this.db().prepare('INSERT INTO images VALUES (?,?,?,?,?,?,1)').run(id, input.title || 'Untitled image', input.templateId, JSON.stringify({ ...defaultStateFor(template.manifest), ...input.state }), now, now);
    return (await this.getImage(id))!;
  }
  async updateImage(id: string, input: { title?: string; state?: ImageState; expectedRevision?: number }) {
    const current = await this.getImage(id); if (!current) return { status: 'not_found' as const };
    if (input.expectedRevision && input.expectedRevision !== current.revision) return { status: 'conflict' as const, value: current };
    const now = new Date().toISOString();
    const result = this.db().prepare(`UPDATE images SET title=?, state=?, updated_at=?, revision=revision+1 WHERE id=? AND revision=?`)
      .run(input.title ?? current.title, JSON.stringify(input.state ?? current.state), now, id, current.revision);
    if (Number(result.changes) === 0) { const latest = await this.getImage(id); return latest ? { status: 'conflict' as const, value: latest } : { status: 'not_found' as const }; }
    return { status: 'updated' as const, value: (await this.getImage(id))! };
  }
  async deleteImage(id: string) { return Number(this.db().prepare('DELETE FROM images WHERE id=?').run(id).changes) > 0; }
  async close() { this.database?.close(); this.database = undefined; }
}

class PostgresStorage implements ImageBuilderStorage {
  readonly kind = 'postgres' as const;
  private pool: Pool;
  constructor(url: string) { this.pool = new Pool({ connectionString: url }); }
  async init(builtins: BuiltinTemplate[]) {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS image_builder_templates (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, html TEXT NOT NULL,
        manifest JSONB NOT NULL, built_in BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, revision INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS image_builder_images (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, template_id TEXT NOT NULL REFERENCES image_builder_templates(id),
        state JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, revision INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS image_builder_archived_templates (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS image_builder_deleted_builtin_templates (
        id TEXT PRIMARY KEY, deleted_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS image_builder_images_updated_at_idx ON image_builder_images(updated_at DESC);
    `);
    const now = new Date().toISOString();
    for (const builtin of builtins) {
      await this.pool.query(`INSERT INTO image_builder_templates (id,name,description,html,manifest,built_in,created_at,updated_at,revision)
        SELECT $1,$2,$3,$4,$5::jsonb,TRUE,$6,$6,1
        WHERE NOT EXISTS (SELECT 1 FROM image_builder_deleted_builtin_templates WHERE id=$1)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,html=excluded.html,manifest=excluded.manifest,updated_at=excluded.updated_at,revision=image_builder_templates.revision+1
        WHERE image_builder_templates.html <> excluded.html OR image_builder_templates.manifest <> excluded.manifest`,
        [builtin.id, builtin.manifest.name, builtin.manifest.description, builtin.html, JSON.stringify(builtin.manifest), now]);
    }
    await this.pool.query(`INSERT INTO image_builder_archived_templates (id)
      SELECT id FROM image_builder_templates WHERE built_in=TRUE AND NOT (id = ANY($1::text[])) ON CONFLICT DO NOTHING`, [builtins.map(item => item.id)]);
  }
  async archiveTemplate(id: string) { await this.pool.query('INSERT INTO image_builder_archived_templates (id) VALUES ($1) ON CONFLICT DO NOTHING', [id]); }
  async listTemplates() { return (await this.pool.query<TemplateRow>('SELECT * FROM image_builder_templates WHERE id NOT IN (SELECT id FROM image_builder_archived_templates) ORDER BY built_in DESC, updated_at DESC')).rows.map(templateFromRow); }
  async getTemplate(id: string) { const row = (await this.pool.query<TemplateRow>('SELECT * FROM image_builder_templates WHERE id=$1',[id])).rows[0]; return row ? templateFromRow(row) : null; }
  async createTemplate(html: string, manifest: TemplateManifest) {
    const id = randomUUID(); const now = new Date().toISOString();
    const row = (await this.pool.query<TemplateRow>('INSERT INTO image_builder_templates VALUES ($1,$2,$3,$4,$5::jsonb,FALSE,$6,$6,1) RETURNING *',[id,manifest.name,manifest.description,html,JSON.stringify(manifest),now])).rows[0];
    return templateFromRow(row);
  }
  async deleteTemplate(id: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query<TemplateRow>('SELECT * FROM image_builder_templates WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if (!row) { await client.query('ROLLBACK'); return 'not_found' as const; }
      const template = templateFromRow(row);
      await client.query('DELETE FROM image_builder_images WHERE template_id=$1',[id]);
      await client.query('DELETE FROM image_builder_templates WHERE id=$1',[id]);
      if (template.builtIn) await client.query('INSERT INTO image_builder_deleted_builtin_templates (id,deleted_at) VALUES ($1,$2) ON CONFLICT(id) DO UPDATE SET deleted_at=excluded.deleted_at',[id,new Date().toISOString()]);
      await client.query('COMMIT');
      return 'deleted' as const;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  async listImages() { return (await this.pool.query<ImageRow>('SELECT * FROM image_builder_images ORDER BY updated_at DESC')).rows.map(imageFromRow); }
  async getImage(id: string) { const row = (await this.pool.query<ImageRow>('SELECT * FROM image_builder_images WHERE id=$1',[id])).rows[0]; return row ? imageFromRow(row) : null; }
  async createImage(input: { templateId: string; title?: string; state?: ImageState }) {
    const template = await this.getTemplate(input.templateId); if (!template) throw new Error(`Template ${input.templateId} was not found.`);
    const id = randomUUID(); const now = new Date().toISOString();
    const row = (await this.pool.query<ImageRow>('INSERT INTO image_builder_images VALUES ($1,$2,$3,$4::jsonb,$5,$5,1) RETURNING *',[id,input.title || 'Untitled image',input.templateId,JSON.stringify({...defaultStateFor(template.manifest),...input.state}),now])).rows[0];
    return imageFromRow(row);
  }
  async updateImage(id: string, input: { title?: string; state?: ImageState; expectedRevision?: number }) {
    const current = await this.getImage(id); if (!current) return { status: 'not_found' as const };
    if (input.expectedRevision && input.expectedRevision !== current.revision) return { status: 'conflict' as const, value: current };
    const row = (await this.pool.query<ImageRow>(`UPDATE image_builder_images SET title=$1,state=$2::jsonb,updated_at=$3,revision=revision+1 WHERE id=$4 AND revision=$5 RETURNING *`,[input.title ?? current.title,JSON.stringify(input.state ?? current.state),new Date().toISOString(),id,current.revision])).rows[0];
    if (!row) { const latest = await this.getImage(id); return latest ? { status: 'conflict' as const, value: latest } : { status: 'not_found' as const }; }
    return { status: 'updated' as const, value: imageFromRow(row) };
  }
  async deleteImage(id: string) { return (await this.pool.query('DELETE FROM image_builder_images WHERE id=$1',[id])).rowCount === 1; }
  async close() { await this.pool.end(); }
}

export function createStorage(databaseUrl: string): ImageBuilderStorage {
  if (/^postgres(ql)?:\/\//.test(databaseUrl)) return new PostgresStorage(databaseUrl);
  const raw = databaseUrl.startsWith('sqlite:') ? databaseUrl.slice(7) : databaseUrl;
  return new SqliteStorage(raw === ':memory:' ? raw : resolve(raw));
}
