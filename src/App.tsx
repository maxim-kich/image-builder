import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { flushSync } from 'react-dom';
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Download,
  FileArchive,
  FileCode2,
  FileText,
  GripVertical,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { api, ApiError, getApiToken, setApiToken } from './api';
import type {
  CanvasInstance,
  ExportImageFormat,
  ImageDocument,
  ImageState,
  StateValue,
  TemplateControl,
  TemplateDocument,
} from './domain';
import {
  canvasInstances,
  canvasSize,
  carouselState,
  continuousCarouselSize,
  defaultStateFor,
  effectiveCanvasState,
  exportState,
  isContinuousCarouselManifest,
  isMultiCanvasManifest,
  templateCanvasCount,
  templateCanvasFor,
  templateState,
  withCanvasInstances,
  withCarouselState,
  withExportState,
  withTemplateState,
} from './domain';
import {
  buildTemplateDocument,
  type TemplateRuntimeContext,
} from './templateRuntime';
import { useImageBuilderWebMcp } from './webmcp';

type Route =
  | { name: 'gallery' }
  | { name: 'templates' }
  | { name: 'edit'; id: string };

type CanvasDragSession = {
  id: string;
  pointerId: number;
  grabX: number;
  grabY: number;
  startX: number;
  startY: number;
  pointerX: number;
  pointerY: number;
  lastX: number;
  dx: number;
  dy: number;
  width: number;
  active: boolean;
};

function currentRoute(): Route {
  const match = /^\/edit\/([^/]+)$/.exec(location.pathname);
  if (match) return { name: 'edit', id: decodeURIComponent(match[1]) };
  return location.pathname === '/templates'
    ? { name: 'templates' }
    : { name: 'gallery' };
}

function useRoute() {
  const [route, setRoute] = useState<Route>(currentRoute);
  useEffect(() => {
    const update = () => setRoute(currentRoute());
    addEventListener('popstate', update);
    return () => removeEventListener('popstate', update);
  }, []);
  const navigate = useCallback((path: string) => {
    history.pushState({}, '', path);
    setRoute(currentRoute());
    scrollTo({ top: 0 });
  }, []);
  return { route, navigate };
}

const asciiLogo = `██╗███╗   ███╗ █████╗  ██████╗ ███████╗    ██████╗ ██╗   ██╗██╗██╗     ██████╗ ███████╗██████╗
██║████╗ ████║██╔══██╗██╔════╝ ██╔════╝    ██╔══██╗██║   ██║██║██║     ██╔══██╗██╔════╝██╔══██╗
██║██╔████╔██║███████║██║  ███╗█████╗      ██████╔╝██║   ██║██║██║     ██║  ██║█████╗  ██████╔╝
██║██║╚██╔╝██║██╔══██║██║   ██║██╔══╝      ██╔══██╗██║   ██║██║██║     ██║  ██║██╔══╝  ██╔══██╗
██║██║ ╚═╝ ██║██║  ██║╚██████╔╝███████╗    ██████╔╝╚██████╔╝██║███████╗██████╔╝███████╗██║  ██║
╚═╝╚═╝     ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝    ╚═════╝  ╚═════╝ ╚═╝╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝`;

function Wordmark({ navigate }: { navigate(path: string): void }) {
  return (
    <button
      className="wordmark"
      onClick={() => navigate('/')}
      aria-label="Image Builder home"
    >
      <span aria-hidden="true" className="brand-ascii-logo">
        {asciiLogo}
      </span>
      <span className="sr-only">Image Builder</span>
    </button>
  );
}

function TopBar({
  route,
  navigate,
}: {
  route: Route;
  navigate(path: string): void;
}) {
  const galleryActive = route.name === 'gallery' || route.name === 'edit';
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <Wordmark navigate={navigate} />
        <nav className="main-nav" aria-label="Primary navigation">
          <button
            className={`nav-link ${galleryActive ? 'is-active' : ''}`}
            onClick={() => navigate('/')}
            aria-current={galleryActive ? 'page' : undefined}
          >
            Gallery
          </button>
          <button
            className={`nav-link ${route.name === 'templates' ? 'is-active' : ''}`}
            onClick={() => navigate('/templates')}
            aria-current={route.name === 'templates' ? 'page' : undefined}
          >
            Templates
          </button>
        </nav>
      </div>
    </header>
  );
}

function templateCollectionLabel(template: TemplateDocument) {
  const count = templateCanvasCount(template.manifest);
  if (count <= 1) return '';
  return isContinuousCarouselManifest(template.manifest)
    ? `${count} segments`
    : `${count} canvases`;
}

function TemplateFrame({
  template,
  state,
  canvas,
  canvasIndex = 0,
  interactive = false,
  maxHeight = 620,
  onState,
  onRequestImage,
  onSelectElement,
  onFocusCanvas,
}: {
  template: TemplateDocument;
  state: ImageState;
  canvas?: CanvasInstance;
  canvasIndex?: number;
  interactive?: boolean;
  maxHeight?: number;
  onState?(state: ImageState, patch?: ImageState): void;
  onRequestImage?(key: string): void;
  onSelectElement?(id: string, keys: string[]): void;
  onFocusCanvas?(point?: { x: number; y: number }): void;
}) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(640);
  const [availableHeight, setAvailableHeight] = useState(
    Math.min(maxHeight, 620),
  );
  const allCanvases = canvasInstances(template.manifest, state);
  const activeCanvas = canvas ?? allCanvases[0];
  const continuous = isContinuousCarouselManifest(template.manifest);
  const frameState = effectiveCanvasState(
    template.manifest,
    state,
    activeCanvas,
  );
  const segmentSize = canvasSize(template, state, activeCanvas);
  const size = continuous
    ? continuousCarouselSize(template.manifest)
    : segmentSize;
  const definition = templateCanvasFor(template.manifest, activeCanvas);
  const context = useMemo<TemplateRuntimeContext>(
    () =>
      isMultiCanvasManifest(template.manifest) || continuous
        ? {
            canvas: {
              id: activeCanvas.id,
              templateCanvasId: activeCanvas.templateCanvasId,
              name: activeCanvas.name,
              index: canvasIndex,
              count: allCanvases.length,
              width: segmentSize.width,
              height: segmentSize.height,
              editable: continuous ? [] : (definition?.editable ?? []),
            },
            ...(continuous
              ? {
                  carousel: {
                    mode: 'continuous' as const,
                    direction: template.manifest.carousel!.direction,
                    width: size.width,
                    height: size.height,
                    segmentWidth: segmentSize.width,
                    segmentHeight: segmentSize.height,
                    segments: template.manifest.carousel!.segments.map(
                      (segment, index) => ({ ...segment, index }),
                    ),
                  },
                }
              : {}),
            elements: (template.manifest.elements ?? [])
              .filter(
                (element) =>
                  !element.canvasIds?.length ||
                  element.canvasIds.includes(activeCanvas.templateCanvasId),
              )
              .map((element) => ({
                id: element.id,
                label: element.label,
                type: element.type,
                allow: element.allow ?? [],
              })),
          }
        : {},
    [
      activeCanvas,
      allCanvases.length,
      canvasIndex,
      continuous,
      definition,
      segmentSize.height,
      segmentSize.width,
      size.height,
      size.width,
      template.manifest,
    ],
  );
  const emptyCanvasUploadKey = template.manifest.elements?.length
    ? undefined
    : template.manifest.controls.find(
        (control) => control.type === 'image' && control.key === 'image',
      )?.key;
  const [doc] = useState(() =>
    buildTemplateDocument(template, frameState, interactive, context),
  );
  const slidePreview = continuous && interactive;
  const viewportSize = slidePreview ? segmentSize : size;
  const scale = Math.min(
    1,
    availableWidth / viewportSize.width,
    availableHeight / viewportSize.height,
    maxHeight / viewportSize.height,
  );
  const vertical = template.manifest.carousel?.direction === 'vertical';
  const previewBackground =
    typeof frameState.background === 'string'
      ? frameState.background
      : typeof frameState.backgroundColor === 'string'
        ? frameState.backgroundColor
        : 'transparent';
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setAvailableWidth(entry.contentRect.width);
      if (entry.contentRect.height > 0)
        setAvailableHeight(entry.contentRect.height);
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    iframe.current?.contentWindow?.postMessage(
      { type: 'imagebuilder:set-state', state: frameState, context },
      '*',
    );
  }, [context, frameState]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow) return;
      if (event.data?.type === 'imagebuilder:state')
        onState?.(
          event.data.state as ImageState,
          event.data.patch as ImageState | undefined,
        );
      if (event.data?.type === 'imagebuilder:request-image')
        onRequestImage?.(event.data.key ?? 'image');
      if (event.data?.type === 'imagebuilder:select-element')
        onSelectElement?.(event.data.id, event.data.keys ?? []);
      if (event.data?.type === 'imagebuilder:focus-canvas')
        onFocusCanvas?.({
          x: Number(event.data.x) || 0,
          y: Number(event.data.y) || 0,
        });
    };
    addEventListener('message', receive);
    return () => removeEventListener('message', receive);
  }, [onFocusCanvas, onRequestImage, onSelectElement, onState]);
  return (
    <div
      className={`frame-host ${slidePreview ? 'carousel-strip-host' : ''}`}
      ref={host}
      aria-label={slidePreview ? 'Scrollable continuous canvas' : undefined}
      onScroll={slidePreview ? (event) => {
        const node = event.currentTarget;
        const offset = vertical ? node.scrollTop : node.scrollLeft;
        const limit = vertical ? node.scrollHeight - node.clientHeight : node.scrollWidth - node.clientWidth;
        const length = vertical ? segmentSize.height : segmentSize.width;
        const index = offset >= limit - 1 ? allCanvases.length - 1 : Math.floor(offset / (length * scale));
        onFocusCanvas?.(vertical ? { x: 0, y: index * length } : { x: index * length, y: 0 });
      } : undefined}
    >
      <div
        className="frame-sizer"
        style={{ width: size.width * scale, height: size.height * scale }}
      >
        <iframe
          ref={iframe}
          title={`${template.name} preview`}
          srcDoc={doc}
          sandbox="allow-scripts"
          style={{
            width: size.width,
            height: size.height,
            transform: `translate3d(0, 0, 0) scale(${scale})`,
            background: previewBackground,
          }}
          onLoad={() =>
            iframe.current?.contentWindow?.postMessage(
              { type: 'imagebuilder:set-state', state: frameState, context },
              '*',
            )
          }
        />
        {interactive &&
        emptyCanvasUploadKey &&
        !frameState[emptyCanvasUploadKey] &&
        onRequestImage ? (
          <button
            type="button"
            className="frame-upload-hitbox"
            aria-label="Upload image"
            onClick={() => onRequestImage(emptyCanvasUploadKey)}
          />
        ) : null}
      </div>
    </div>
  );
}

function AuthGate({ onReady }: { onReady(): void }) {
  const [token, setToken] = useState(getApiToken());
  const [error, setError] = useState('');
  const submit = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setApiToken(token.trim());
    try {
      await api.listTemplates();
      setError('');
      onReady();
    } catch {
      setError('That token was not accepted.');
    }
  };
  return (
    <div className="gate">
      <form onSubmit={submit} className="gate-panel">
        <p className="eyebrow">Private workspace</p>
        <h1>Connect to Image Builder.</h1>
        <p>
          Enter the access token configured on this server. It stays in this
          browser tab.
        </p>
        <label htmlFor="access-token">
          <span>Access token</span>
        </label>
        <Input
          id="access-token"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
        {error && <p className="error-text">{error}</p>}
        <Button type="submit">Open workspace</Button>
      </form>
    </div>
  );
}

function Loading() {
  return (
    <div className="loading-state">
      <span className="loading-glyph">[···]</span>
      <p>Loading workspace</p>
    </div>
  );
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busy = false,
  error = '',
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string;
  onOpenChange(open: boolean): void;
  onConfirm(): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="confirm-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="dialog-body confirm-dialog-body">
          <p>{description}</p>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            className="confirm-cancel"
            variant="ghost"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            className="confirm-destructive"
            variant="destructive"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? 'Deleting…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Gallery({
  images,
  templates,
  navigate,
  refresh,
  onNew,
}: {
  images: ImageDocument[];
  templates: TemplateDocument[];
  navigate(path: string): void;
  refresh(): Promise<void>;
  onNew(): void;
}) {
  const [draftTemplates, setDraftTemplates] = useState<TemplateDocument[]>([]);
  useEffect(() => {
    let cancelled = false;
    const missing = [...new Set(images.map(image => image.templateId))]
      .filter(id => !templates.some(template => template.id === id));
    void Promise.all(missing.map(id => api.getTemplate(id))).then(items => {
      if (!cancelled) setDraftTemplates(items);
    }).catch(() => { /* Keep the available gallery cards visible. */ });
    return () => { cancelled = true; };
  }, [images, templates]);
  const templateMap = useMemo(
    () => new Map([...draftTemplates, ...templates].map((item) => [item.id, item])),
    [templates, draftTemplates],
  );
  const [deleteTarget, setDeleteTarget] = useState<ImageDocument>();
  const [deleting, setDeleting] = useState(false);
  const duplicate = async (image: ImageDocument) => {
    const copy = await api.duplicateImage(image.id);
    await refresh();
    navigate(`/edit/${copy.id}`);
  };
  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteImage(deleteTarget.id);
      await refresh();
      setDeleteTarget(undefined);
    } finally {
      setDeleting(false);
    }
  };
  return (
    <section className="workspace" aria-labelledby="gallery-title">
      <header className="page-header">
        <h1 id="gallery-title">Gallery</h1>
        <Button className="primary-action" onClick={onNew}>
          New image
        </Button>
      </header>
      {images.length > 0 ? (
        <div className="gallery-grid">
          {images.map((image) => {
            const template = templateMap.get(image.templateId);
            if (!template) return null;
            return (
              <article className="image-card" key={image.id}>
                <button
                  className="card-preview-button"
                  onClick={() => navigate(`/edit/${image.id}`)}
                  aria-label={`Edit ${image.title}`}
                >
                  <TemplateFrame
                    template={template}
                    state={image.state}
                    maxHeight={300}
                  />
                </button>
                <div className="card-meta">
                  <div>
                    <h2>{image.title}</h2>
                    <p>{new Date(image.updatedAt).toLocaleDateString()}</p>
                  </div>
                  <div className="card-actions">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Download PNG"
                      onClick={() =>
                        void api.downloadImage(image.id, image.title)
                      }
                    >
                      <Download />
                      <span className="sr-only">Download</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Duplicate"
                      onClick={() => void duplicate(image)}
                    >
                      <Copy />
                      <span className="sr-only">Duplicate</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Delete"
                      onClick={() => setDeleteTarget(image)}
                    >
                      <Trash2 />
                      <span className="sr-only">Delete</span>
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="inline-empty">
          <span>[ empty gallery ]</span>
          <p>Use New image to create your first image.</p>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete image?"
        description={
          deleteTarget
            ? `“${deleteTarget.title}” will be permanently removed.`
            : ''
        }
        confirmLabel="Delete image"
        busy={deleting}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(undefined);
        }}
        onConfirm={() => void remove()}
      />
    </section>
  );
}

function NewImageDialog({
  open,
  templates,
  onOpenChange,
  navigate,
}: {
  open: boolean;
  templates: TemplateDocument[];
  onOpenChange(open: boolean): void;
  navigate(path: string): void;
}) {
  const [creating, setCreating] = useState<string>();
  const [error, setError] = useState('');
  const create = async (template: TemplateDocument) => {
    setCreating(template.id);
    setError('');
    try {
      const image = await api.createImage(
        template.id,
        `Untitled ${template.name}`,
      );
      onOpenChange(false);
      navigate(`/edit/${image.id}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not create the image.',
      );
    } finally {
      setCreating(undefined);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="template-picker-dialog">
        <DialogHeader>
          <DialogTitle>Choose a template</DialogTitle>
          <DialogDescription>
            Select a starting point. It opens directly in the editor.
          </DialogDescription>
        </DialogHeader>
        <div className="dialog-body template-picker-body">
          <div className="template-picker-list">
            {templates.map((template) => (
              <button
                type="button"
                className="template-picker-item"
                key={template.id}
                disabled={Boolean(creating)}
                onClick={() => void create(template)}
              >
                <div className="template-picker-preview">
                  <TemplateFrame
                    template={template}
                    state={defaultStateFor(template.manifest)}
                    maxHeight={112}
                  />
                </div>
                <span className="template-picker-copy">
                  <strong>{template.name}</strong>
                  <small>{template.description}</small>
                  <span>
                    {template.manifest.width} × {template.manifest.height}
                    {templateCollectionLabel(template)
                      ? ` · ${templateCollectionLabel(template)}`
                      : ''}
                  </span>
                </span>
                <span className="template-picker-action">
                  {creating === template.id ? 'Creating…' : 'Use template'}
                </span>
              </button>
            ))}
          </div>
          {error && <p className="error-text">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TemplateUpload({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onUploaded(template: TemplateDocument): void;
}) {
  const [file, setFile] = useState<File>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const template = await api.uploadTemplate(await file.text());
      onUploaded(template);
      onOpenChange(false);
      setFile(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="upload-dialog">
        <DialogHeader>
          <DialogTitle>Upload HTML template</DialogTitle>
          <DialogDescription>
            Add one self-contained template file.
          </DialogDescription>
        </DialogHeader>
        <div className="dialog-body upload-dialog-body">
          <label className={`dropzone ${file ? 'has-file' : ''}`}>
            <input
              type="file"
              accept="text/html,.html"
              onChange={(event) => setFile(event.target.files?.[0])}
            />
            <FileCode2 />
            <strong>{file?.name ?? 'Choose an HTML file'}</strong>
            <span>
              {file
                ? `${Math.ceil(file.size / 1024)} KB selected`
                : 'HTML · maximum 1 MB'}
            </span>
          </label>
          <a
            className="doc-link"
            href="/docs/templates"
            target="_blank"
            rel="noreferrer"
          >
            Read the template contract →
          </a>
          {error && <p className="error-text">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            className="dialog-cancel"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            className="dialog-primary"
            disabled={!file || busy}
            onClick={() => void upload()}
          >
            {busy ? 'Uploading' : 'Upload template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Templates({
  templates,
  images,
  refresh,
  navigate,
}: {
  templates: TemplateDocument[];
  images: ImageDocument[];
  refresh(): Promise<void>;
  navigate(path: string): void;
}) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TemplateDocument>();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [creating, setCreating] = useState<string>();
  const [createError, setCreateError] = useState('');
  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await api.deleteTemplate(deleteTarget.id);
      await refresh();
      setDeleteTarget(undefined);
    } catch (cause) {
      setDeleteError(
        cause instanceof Error
          ? cause.message
          : 'Template could not be deleted.',
      );
    } finally {
      setDeleting(false);
    }
  };
  const requestDelete = (template: TemplateDocument) => {
    setDeleteError('');
    setDeleteTarget(template);
  };
  const start = async (template: TemplateDocument) => {
    setCreating(template.id);
    setCreateError('');
    try {
      const image = await api.createImage(
        template.id,
        `Untitled ${template.name}`,
      );
      await refresh();
      navigate(`/edit/${image.id}`);
    } catch (cause) {
      setCreateError(
        cause instanceof Error ? cause.message : 'Image could not be created.',
      );
    } finally {
      setCreating(undefined);
    }
  };
  const connectedImageCount = deleteTarget
    ? images.filter((image) => image.templateId === deleteTarget.id).length
    : 0;
  const deleteDescription = deleteTarget
    ? connectedImageCount > 0
      ? `“${deleteTarget.name}” and ${connectedImageCount} connected ${connectedImageCount === 1 ? 'image' : 'images'} will be permanently deleted.`
      : `“${deleteTarget.name}” will be permanently deleted. No images are connected to this template.`
    : '';
  return (
    <section
      className="workspace templates-page"
      aria-labelledby="templates-title"
    >
      <header className="page-header">
        <h1 id="templates-title">Templates</h1>
        <Button className="primary-action" onClick={() => setUploadOpen(true)}>
          New template
        </Button>
      </header>
      {createError && (
        <p className="error-text template-page-error" role="alert">
          {createError}
        </p>
      )}
      <div className="template-grid">
        {templates.map((template) => (
          <article className="template-library-card" key={template.id}>
            <div className="template-preview">
              <TemplateFrame
                template={template}
                state={defaultStateFor(template.manifest)}
                maxHeight={260}
              />
            </div>
            <div className="template-card-body">
              <h2>{template.name}</h2>
              <p>{template.description}</p>
              <div className="template-footer">
                <span className="template-tag">
                  {templateCollectionLabel(template)
                    ? templateCollectionLabel(template)
                    : template.builtIn
                      ? 'Built in'
                      : 'HTML'}
                </span>
                <div className="template-actions">
                  <Button
                    className="template-start"
                    variant="ghost"
                    size="sm"
                    disabled={Boolean(creating)}
                    onClick={() => void start(template)}
                  >
                    {creating === template.id ? 'Creating…' : 'Start'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Download HTML"
                    onClick={() =>
                      void api.downloadTemplate(template.id, template.name)
                    }
                  >
                    <Download />
                    <span className="sr-only">Download HTML</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Delete template"
                    onClick={() => requestDelete(template)}
                  >
                    <Trash2 />
                    <span className="sr-only">Delete template</span>
                  </Button>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
      <TemplateUpload
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={() => {
          void refresh();
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete template?"
        description={deleteDescription}
        confirmLabel="Delete template"
        busy={deleting}
        error={deleteError}
        onOpenChange={(open) => {
          if (!open && !deleting) {
            setDeleteTarget(undefined);
            setDeleteError('');
          }
        }}
        onConfirm={() => void remove()}
      />
    </section>
  );
}

const presets = [
  { label: 'Square', width: 1080, height: 1080 },
  { label: 'Portrait', width: 1080, height: 1350 },
  { label: 'Story', width: 1080, height: 1920 },
  { label: 'Landscape', width: 1200, height: 628 },
];

async function imageFileToDataUrl(file: File): Promise<string> {
  if (file.size > 8 * 1024 * 1024)
    throw new Error('Please choose an image smaller than 8 MB.');
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Could not read the image.'));
    reader.onerror = () => reject(new Error('Could not read the image.'));
    reader.readAsDataURL(file);
  });
}

const stateText = (value: StateValue | undefined) =>
  value === null || value === undefined
    ? ''
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);

function Control({
  control,
  value,
  onChange,
}: {
  control: TemplateControl;
  value: StateValue | undefined;
  onChange(value: StateValue): void;
}) {
  if (control.type === 'image')
    return (
      <div className="file-control">
        <span>{control.label}</span>
        <div className="image-control-actions">
          <label className="image-picker">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                void imageFileToDataUrl(file)
                  .then(onChange)
                  .catch((cause) =>
                    alert(
                      cause instanceof Error
                        ? cause.message
                        : 'Could not read the image.',
                    ),
                  );
                event.currentTarget.value = '';
              }}
            />
            <strong>
              <Upload /> {value ? 'Replace image' : 'Upload image'}
            </strong>
          </label>
          {value ? (
            <Button
              type="button"
              variant="ghost"
              className="remove-image-button"
              onClick={() => onChange('')}
            >
              <Trash2 /> Remove
            </Button>
          ) : null}
        </div>
        {control.hint && <small>{control.hint}</small>}
      </div>
    );
  if (control.type === 'boolean' || control.type === 'toggle')
    return (
      <label className="check-control">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{control.label}</span>
      </label>
    );
  if (control.type === 'select')
    return (
      <label className="field-control">
        <span>{control.label}</span>
        <select
          value={stateText(value)}
          onChange={(event) => {
            const option = control.options?.find(
              (item) => String(item.value) === event.target.value,
            );
            onChange(option?.value ?? event.target.value);
          }}
        >
          {control.options?.map((option) => (
            <option key={String(option.value)} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  if (control.type === 'color')
    return (
      <label className="field-control color-control">
        <span>{control.label}</span>
        <span>
          <input
            type="color"
            value={
              typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
                ? value
                : '#000000'
            }
            onChange={(event) => onChange(event.target.value)}
          />
          <Input
            value={stateText(value)}
            onChange={(event) => onChange(event.target.value)}
          />
        </span>
        {control.hint && <small>{control.hint}</small>}
      </label>
    );
  if (control.type === 'size' || control.type === 'position') {
    const object =
      value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const firstKey = control.type === 'size' ? 'width' : 'x';
    const secondKey = control.type === 'size' ? 'height' : 'y';
    return (
      <fieldset className="composite-control">
        <legend>{control.label}</legend>
        <label>
          <span>{firstKey}</span>
          <Input
            type="number"
            value={Number(object[firstKey] ?? 0)}
            min={control.min}
            max={control.max}
            step={control.step}
            onChange={(event) =>
              onChange({ ...object, [firstKey]: Number(event.target.value) })
            }
          />
        </label>
        <label>
          <span>{secondKey}</span>
          <Input
            type="number"
            value={Number(object[secondKey] ?? 0)}
            min={control.min}
            max={control.max}
            step={control.step}
            onChange={(event) =>
              onChange({ ...object, [secondKey]: Number(event.target.value) })
            }
          />
        </label>
      </fieldset>
    );
  }
  if (control.type === 'number' && control.key === 'zoom')
    return (
      <label className="range-control">
        <span>
          <span>{control.label}</span>
          <output>{Number(value ?? 1).toFixed(2)}×</output>
        </span>
        <Slider
          min={control.min}
          max={control.max}
          step={control.step}
          value={[Number(value ?? control.default ?? 0)]}
          onValueChange={(values) =>
            onChange(Array.isArray(values) ? values[0] : values)
          }
        />
      </label>
    );
  return (
    <label className="field-control">
      <span>{control.label}</span>
      <Input
        type={control.type === 'number' ? 'number' : 'text'}
        value={stateText(value)}
        min={control.min}
        max={control.max}
        step={control.step}
        onChange={(event) =>
          onChange(
            control.type === 'number'
              ? Number(event.target.value)
              : event.target.value,
          )
        }
      />
      {control.hint && <small>{control.hint}</small>}
    </label>
  );
}

function SizeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange(value: number): void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const next = Number(draft);
    if (!Number.isFinite(next)) {
      setDraft(String(value));
      return;
    }
    const constrained = Math.min(4000, Math.max(64, Math.round(next)));
    setDraft(String(constrained));
    if (constrained !== value) onChange(constrained);
  };
  return (
    <div className="size-field">
      <label htmlFor={id}>{label}</label>
      <span>
        <Input
          id={id}
          type="number"
          min={64}
          max={4000}
          step={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        <small>px</small>
      </span>
    </div>
  );
}

function ExportDialog({
  open,
  image,
  template,
  activeCanvas,
  onOpenChange,
}: {
  open: boolean;
  image: ImageDocument;
  template: TemplateDocument;
  activeCanvas: CanvasInstance;
  onOpenChange(open: boolean): void;
}) {
  const settings = template.manifest.export ?? {};
  const canvases = canvasInstances(template.manifest, image.state);
  const continuous = isContinuousCarouselManifest(template.manifest);
  const formats = settings.formats ?? ['png'];
  const scaleChoices = settings.scales ?? [1, 2, 'custom'];
  const initialMode =
    settings.currentCanvas !== false
      ? 'current'
      : settings.separateImages !== false
        ? 'separate'
        : settings.zip !== false
          ? 'zip'
          : 'pdf';
  const [mode, setMode] = useState<'current' | 'separate' | 'zip' | 'pdf'>(
    initialMode,
  );
  const [format, setFormat] = useState<ExportImageFormat>(
    settings.defaultFormat ?? formats[0],
  );
  const [scale, setScale] = useState(settings.defaultScale ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setBusy(true);
    setError('');
    try {
      if (mode === 'current')
        await api.downloadCanvas(
          image.id,
          activeCanvas.id,
          format,
          scale,
          image.title,
        );
      if (mode === 'separate')
        for (const canvas of canvases)
          await api.downloadCanvas(
            image.id,
            canvas.id,
            format,
            scale,
            image.title,
          );
      if (mode === 'zip')
        await api.downloadZip(image.id, format, scale, image.title);
      if (mode === 'pdf') await api.downloadPdf(image.id, scale, image.title);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Export failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="export-dialog">
        <DialogHeader>
          <DialogTitle>
            {continuous ? 'Export carousel' : 'Export canvases'}
          </DialogTitle>
          <DialogDescription>
            Export the current {continuous ? 'segment' : 'canvas'} or the
            complete ordered set.
          </DialogDescription>
        </DialogHeader>
        <div className="dialog-body export-dialog-body">
          <div className="export-mode-grid">
            {settings.currentCanvas !== false && (
              <button
                type="button"
                className={mode === 'current' ? 'is-selected' : ''}
                onClick={() => setMode('current')}
              >
                <Download />
                <strong>Current {continuous ? 'segment' : 'canvas'}</strong>
                <small>One image file</small>
              </button>
            )}
            {settings.separateImages !== false && canvases.length > 1 && (
              <button
                type="button"
                className={mode === 'separate' ? 'is-selected' : ''}
                onClick={() => setMode('separate')}
              >
                <Copy />
                <strong>Separate images</strong>
                <small>{canvases.length} downloads</small>
              </button>
            )}
            {settings.zip !== false && canvases.length > 1 && (
              <button
                type="button"
                className={mode === 'zip' ? 'is-selected' : ''}
                onClick={() => setMode('zip')}
              >
                <FileArchive />
                <strong>ZIP archive</strong>
                <small>{canvases.length} ordered files</small>
              </button>
            )}
            {settings.pdf?.enabled && (
              <button
                type="button"
                className={mode === 'pdf' ? 'is-selected' : ''}
                onClick={() => setMode('pdf')}
              >
                <FileText />
                <strong>Multi-page PDF</strong>
                <small>One {continuous ? 'segment' : 'canvas'} per page</small>
              </button>
            )}
          </div>
          {mode !== 'pdf' && (
            <label className="field-control">
              <span>Format</span>
              <select
                value={format}
                onChange={(event) =>
                  setFormat(event.target.value as ExportImageFormat)
                }
              >
                {formats.map((item) => (
                  <option value={item} key={item}>
                    {item === 'jpeg' ? 'JPEG' : item.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field-control">
            <span>Scale</span>
            <select
              value={
                scaleChoices.includes(scale as 1 | 2) ? String(scale) : 'custom'
              }
              onChange={(event) => {
                if (event.target.value !== 'custom')
                  setScale(Number(event.target.value));
              }}
            >
              {scaleChoices.map((item) => (
                <option key={String(item)} value={item}>
                  {item === 'custom' ? 'Custom' : `${item}×`}
                </option>
              ))}
            </select>
          </label>
          {scaleChoices.includes('custom') &&
            !scaleChoices.includes(scale as 1 | 2) && (
              <div className="field-control">
                <span>Custom scale</span>
                <Input
                  aria-label="Custom export scale"
                  type="number"
                  min={0.25}
                  max={4}
                  step={0.25}
                  value={scale}
                  onChange={(event) =>
                    setScale(
                      Math.min(4, Math.max(0.25, Number(event.target.value))),
                    )
                  }
                />
              </div>
            )}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            className="dialog-primary"
            disabled={busy}
            onClick={() => void run()}
          >
            {busy ? 'Exporting…' : 'Export'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const canvasPropertyControls: Record<string, TemplateControl> = {
  background: { key: 'background', label: 'Background', type: 'text' },
  backgroundImage: {
    key: 'backgroundImage',
    label: 'Background image',
    type: 'image',
  },
  padding: {
    key: 'padding',
    label: 'Padding',
    type: 'spacing',
    min: 0,
    max: 1000,
  },
  spacing: {
    key: 'spacing',
    label: 'Spacing',
    type: 'spacing',
    min: 0,
    max: 1000,
  },
  cornerRadius: {
    key: 'cornerRadius',
    label: 'Corner radius',
    type: 'number',
    min: 0,
    max: 2000,
  },
  borderColor: { key: 'borderColor', label: 'Border color', type: 'color' },
  borderWidth: {
    key: 'borderWidth',
    label: 'Border width',
    type: 'number',
    min: 0,
    max: 200,
  },
  borderStyle: {
    key: 'borderStyle',
    label: 'Border style',
    type: 'select',
    options: ['none', 'solid', 'dashed', 'dotted', 'double'].map((value) => ({
      label: value,
      value,
    })),
  },
  borderRadius: {
    key: 'borderRadius',
    label: 'Border radius',
    type: 'number',
    min: 0,
    max: 2000,
  },
  shadow: {
    key: 'shadow',
    label: 'Shadow',
    type: 'text',
    hint: 'CSS box-shadow value',
  },
  safeAreaGuides: {
    key: 'safeAreaGuides',
    label: 'Safe-area guides',
    type: 'toggle',
  },
};

function Editor({
  id,
  templates,
  navigate,
  onSaved,
}: {
  id: string;
  templates: TemplateDocument[];
  navigate(path: string): void;
  onSaved(): Promise<void>;
}) {
  const [image, setImage] = useState<ImageDocument>();
  const [template, setTemplate] = useState<TemplateDocument>();
  const [activeCanvasId, setActiveCanvasId] = useState('');
  const [selectedElementId, setSelectedElementId] = useState('');
  const [selectedControlKeys, setSelectedControlKeys] = useState<string[]>([]);
  const [draggedCanvasId, setDraggedCanvasId] = useState('');
  const [droppingCanvasId, setDroppingCanvasId] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [uploadKey, setUploadKey] = useState('image');
  const [uploadCanvasId, setUploadCanvasId] = useState('');
  const [status, setStatus] = useState<
    'loading' | 'saved' | 'saving' | 'error'
  >('loading');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dropTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const canvasDrag = useRef<CanvasDragSession | undefined>(undefined);
  const canvasOrder = useRef<CanvasInstance[]>([]);
  const suppressCanvasClick = useRef(false);
  const current = useRef<ImageDocument | undefined>(undefined);
  const editVersion = useRef(0);
  const savingRequest = useRef(false);
  const needsSave = useRef(false);
  const persist = useRef<() => void>(() => undefined);
  const canvasUpload = useRef<HTMLInputElement>(null);
  const elementControls = useRef<HTMLElement>(null);
  const controlPanel = useRef<HTMLElement>(null);
  const templateCache = useRef(templates);
  useEffect(() => {
    current.current = image;
  }, [image]);
  useEffect(() => {
    templateCache.current = templates;
  }, [templates]);
  useEffect(() => {
    void (async () => {
      const loaded = await api.getImage(id);
      const loadedTemplate =
        templateCache.current.find((item) => item.id === loaded.templateId) ??
        (await api.getTemplate(loaded.templateId));
      setImage(loaded);
      setTemplate(loadedTemplate);
      setActiveCanvasId(
        canvasInstances(loadedTemplate.manifest, loaded.state)[0]?.id ??
          'canvas',
      );
      setStatus('saved');
    })().catch(() => setStatus('error'));
  }, [id]);
  persist.current = () => {
    if (savingRequest.current) {
      needsSave.current = true;
      return;
    }
    const target = current.current;
    if (!target) return;
    const version = editVersion.current;
    savingRequest.current = true;
    needsSave.current = false;
    void api
      .updateImage(target.id, target.state, target.title, target.revision)
      .then((saved) => {
        const latest = current.current;
        if (latest && editVersion.current !== version) {
          const rebased = { ...latest, revision: saved.revision };
          current.current = rebased;
          setImage(rebased);
          needsSave.current = true;
          setStatus('saving');
        } else {
          current.current = saved;
          setImage(saved);
          setStatus('saved');
          void onSaved();
        }
      })
      .catch(() => setStatus('error'))
      .finally(() => {
        savingRequest.current = false;
        if (needsSave.current) persist.current();
      });
  };
  const scheduleSave = useCallback((next: ImageDocument) => {
    editVersion.current += 1;
    setImage(next);
    current.current = next;
    setStatus('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => persist.current(), 450);
  }, []);
  const update = useCallback(
    (changes: Partial<Pick<ImageDocument, 'state' | 'title'>>) => {
      const base = current.current;
      if (base) scheduleSave({ ...base, ...changes });
    },
    [scheduleSave],
  );
  const replaceState = useCallback(
    (state: ImageState) => update({ state }),
    [update],
  );
  const patchLegacy = useCallback(
    (value: ImageState) => {
      const base = current.current;
      if (base) replaceState({ ...base.state, ...value });
    },
    [replaceState],
  );
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (dropTimer.current) clearTimeout(dropTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!selectedElementId && selectedControlKeys.length === 0) return;
    const target =
      selectedControlKeys
        .map((key) =>
          controlPanel.current?.querySelector(
            `[data-control-key="${CSS.escape(key)}"]`,
          ),
        )
        .find(Boolean) ?? elementControls.current;
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeCanvasId, selectedControlKeys, selectedElementId]);
  if (!image || !template) return <Loading />;

  const multi = isMultiCanvasManifest(template.manifest);
  const continuous = isContinuousCarouselManifest(template.manifest);
  const canvasSet = multi || continuous;
  const canvases = canvasInstances(template.manifest, image.state);
  canvasOrder.current = canvases;
  const activeIndex = Math.max(
    0,
    canvases.findIndex((canvas) => canvas.id === activeCanvasId),
  );
  const activeCanvas = canvases[activeIndex];
  const activeDefinition = templateCanvasFor(template.manifest, activeCanvas);
  const activeState = effectiveCanvasState(
    template.manifest,
    image.state,
    activeCanvas,
  );
  const size = canvasSize(template, image.state, activeCanvas);
  const rules = template.manifest.canvasRules ?? {};
  const minCanvases = rules.min ?? 1;
  const maxCanvases = rules.max ?? 100;
  const updateCanvases = (next: CanvasInstance[]) => {
    canvasOrder.current = next;
    replaceState(
      withCanvasInstances(current.current?.state ?? image.state, next),
    );
  };
  const patchCanvasById = (canvasId: string, value: ImageState) => {
    if (continuous) {
      return replaceState(
        withCarouselState(image.state, {
          ...carouselState(image.state),
          ...value,
        }),
      );
    }
    if (!multi) return patchLegacy(value);
    updateCanvases(
      canvases.map((canvas) =>
        canvas.id === canvasId
          ? { ...canvas, state: { ...canvas.state, ...value } }
          : canvas,
      ),
    );
  };
  const patchCanvas = (value: ImageState) =>
    patchCanvasById(activeCanvas.id, value);
  const updateCanvasSize = (dimension: 'width' | 'height', value: number) => {
    if (!multi)
      return patchLegacy({
        [dimension === 'width' ? 'canvasWidth' : 'canvasHeight']: value,
      });
    updateCanvases(
      canvases.map((canvas) =>
        rules.sharedSize || canvas.id === activeCanvas.id
          ? { ...canvas, [dimension]: value }
          : canvas,
      ),
    );
  };
  const addCanvas = () => {
    if (canvases.length >= maxCanvases) return;
    const definition = activeDefinition ?? template.manifest.canvases![0];
    const defaults =
      canvasInstances(
        template.manifest,
        defaultStateFor(template.manifest),
      ).find((item) => item.templateCanvasId === definition.id)?.state ?? {};
    const id = `${definition.id}-${crypto.randomUUID().slice(0, 8)}`;
    updateCanvases([
      ...canvases,
      {
        id,
        templateCanvasId: definition.id,
        name: `Canvas ${canvases.length + 1}`,
        width: definition.width,
        height: definition.height,
        state: structuredClone(defaults),
      },
    ]);
    setActiveCanvasId(id);
  };
  const duplicateCanvas = (sourceId = activeCanvas.id) => {
    if (canvases.length >= maxCanvases) return;
    const sourceIndex = canvases.findIndex((canvas) => canvas.id === sourceId);
    if (sourceIndex < 0) return;
    const source = canvases[sourceIndex];
    const id = `${source.templateCanvasId}-${crypto.randomUUID().slice(0, 8)}`;
    const copy = {
      ...structuredClone(source),
      id,
      name: `${source.name} copy`,
    };
    const next = [...canvases];
    next.splice(sourceIndex + 1, 0, copy);
    updateCanvases(next);
    setActiveCanvasId(id);
  };
  const deleteCanvas = (targetId = activeCanvas.id) => {
    if (canvases.length <= minCanvases) return;
    const targetIndex = canvases.findIndex((canvas) => canvas.id === targetId);
    if (targetIndex < 0) return;
    const next = canvases.filter((canvas) => canvas.id !== targetId);
    updateCanvases(next);
    setActiveCanvasId(next[Math.min(targetIndex, next.length - 1)].id);
  };
  const draggedStage = (canvasId: string) =>
    document.querySelector<HTMLElement>(
      `.canvas-stage[data-canvas-id="${CSS.escape(canvasId)}"]`,
    );
  const positionDraggedCanvas = () => {
    const drag = canvasDrag.current;
    if (!drag?.active) return;
    const stage = draggedStage(drag.id);
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    const baseLeft = bounds.left - drag.dx;
    const baseTop = bounds.top - drag.dy;
    drag.dx = drag.pointerX - drag.grabX - baseLeft;
    drag.dy = drag.pointerY - drag.grabY - baseTop;
    stage.style.transform = `translate3d(${drag.dx}px, ${drag.dy}px, 0)`;
  };
  const moveCanvas = (
    fromId: string,
    toId: string,
    side: 'before' | 'after',
  ) => {
    if (fromId === toId) return;
    const before = new Map<string, DOMRect>();
    document
      .querySelectorAll<HTMLElement>('.canvas-stage[data-canvas-id]')
      .forEach((stage) => {
        if (stage.dataset.canvasId !== fromId)
          before.set(
            stage.dataset.canvasId ?? '',
            stage.getBoundingClientRect(),
          );
      });
    const previous = canvasOrder.current;
    const next = [...previous];
    const from = next.findIndex((canvas) => canvas.id === fromId);
    if (from < 0) return;
    const [moved] = next.splice(from, 1);
    const target = next.findIndex((canvas) => canvas.id === toId);
    if (target < 0) return;
    next.splice(target + (side === 'after' ? 1 : 0), 0, moved);
    if (next.every((canvas, index) => canvas.id === previous[index]?.id))
      return;
    flushSync(() => updateCanvases(next));
    document
      .querySelectorAll<HTMLElement>('.canvas-stage[data-canvas-id]')
      .forEach((stage) => {
        if (stage.dataset.canvasId === fromId) return;
        const oldBounds = before.get(stage.dataset.canvasId ?? '');
        if (!oldBounds) return;
        const bounds = stage.getBoundingClientRect();
        const offset = oldBounds.left - bounds.left;
        if (Math.abs(offset) > 1)
          stage.animate(
            [
              { transform: `translate3d(${offset}px, 0, 0)` },
              { transform: 'translate3d(0, 0, 0)' },
            ],
            { duration: 190, easing: 'cubic-bezier(.2, .8, .2, 1)' },
          );
      });
    positionDraggedCanvas();
  };
  const beginCanvasDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    canvasId: string,
  ) => {
    if (rules.allowReorder === false || event.button !== 0) return;
    if (dropTimer.current) clearTimeout(dropTimer.current);
    const stage = event.currentTarget.closest<HTMLElement>('.canvas-stage');
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    canvasDrag.current = {
      id: canvasId,
      pointerId: event.pointerId,
      grabX: event.clientX - bounds.left,
      grabY: event.clientY - bounds.top,
      startX: event.clientX,
      startY: event.clientY,
      pointerX: event.clientX,
      pointerY: event.clientY,
      lastX: event.clientX,
      dx: 0,
      dy: 0,
      width: bounds.width,
      active: false,
    };
    setActiveCanvasId(canvasId);
    setDroppingCanvasId('');
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* Synthetic pointer events do not own capture. */
    }
  };
  const continueCanvasDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = canvasDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.pointerX = event.clientX;
    drag.pointerY = event.clientY;
    if (!drag.active) {
      if (
        Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 7
      )
        return;
      drag.active = true;
      draggedStage(drag.id)?.classList.add('is-dragging');
      setDraggedCanvasId(drag.id);
    }
    event.preventDefault();
    positionDraggedCanvas();
    const direction = event.clientX - drag.lastX;
    drag.lastX = event.clientX;
    const order = canvasOrder.current;
    const index = order.findIndex((canvas) => canvas.id === drag.id);
    const draggedCenter = event.clientX - drag.grabX + drag.width / 2;
    const stickyDistance = 24;
    if (direction > 0 && index >= 0 && index < order.length - 1) {
      const next = order[index + 1];
      const bounds = draggedStage(next.id)?.getBoundingClientRect();
      if (
        bounds &&
        draggedCenter > bounds.left + bounds.width / 2 + stickyDistance
      )
        moveCanvas(drag.id, next.id, 'after');
    } else if (direction < 0 && index > 0) {
      const previous = order[index - 1];
      const bounds = draggedStage(previous.id)?.getBoundingClientRect();
      if (
        bounds &&
        draggedCenter < bounds.left + bounds.width / 2 - stickyDistance
      )
        moveCanvas(drag.id, previous.id, 'before');
    }
  };
  const finishCanvasDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = canvasDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* Pointer capture may already be released. */
    }
    canvasDrag.current = undefined;
    if (!drag.active) return;
    const stage = draggedStage(drag.id);
    if (stage) {
      stage.classList.remove('is-dragging');
      stage.classList.add('is-dropping');
      void stage.offsetWidth;
      stage.style.transform = 'translate3d(0, 0, 0)';
    }
    suppressCanvasClick.current = true;
    setDraggedCanvasId('');
    setDroppingCanvasId(drag.id);
    dropTimer.current = setTimeout(() => {
      const droppedStage = draggedStage(drag.id);
      if (droppedStage) {
        droppedStage.classList.remove('is-dropping');
        droppedStage.style.removeProperty('transform');
      }
      setDroppingCanvasId('');
      suppressCanvasClick.current = false;
    }, 210);
  };
  const handleCanvasUpload = async (file?: File) => {
    if (!file) return;
    try {
      patchCanvasById(uploadCanvasId || activeCanvas.id, {
        [uploadKey]: await imageFileToDataUrl(file),
        ...(uploadKey === 'image' ? { x: 0, y: 0, zoom: 1 } : {}),
      });
    } catch (cause) {
      alert(
        cause instanceof Error ? cause.message : 'Could not read the image.',
      );
    }
  };
  const requestImage = (canvasId: string, key: string) => {
    setActiveCanvasId(canvasId);
    setUploadCanvasId(canvasId);
    setUploadKey(key);
    canvasUpload.current?.click();
  };
  const selectElement = (
    canvasId: string,
    elementId: string,
    keys: string[],
  ) => {
    setActiveCanvasId(canvasId);
    setSelectedElementId(elementId);
    setSelectedControlKeys(keys);
  };
  const isFitFrame = template.id === 'fit-frame';
  const controlGroups = {
    template: template.manifest.controls.filter(
      (control) => control.scope === 'template',
    ),
    canvas: template.manifest.controls.filter(
      (control) =>
        (control.scope ?? 'canvas') === 'canvas' &&
        (!control.canvasId ||
          control.canvasId === activeCanvas.templateCanvasId) &&
        (!isFitFrame ||
          !['canvasWidth', 'canvasHeight', 'x', 'y', 'background'].includes(
            control.key,
          )),
    ),
    element: template.manifest.controls.filter(
      (control) =>
        control.scope === 'element' &&
        control.elementId === selectedElementId &&
        (!control.canvasId ||
          control.canvasId === activeCanvas.templateCanvasId),
    ),
    export: template.manifest.controls.filter(
      (control) => control.scope === 'export',
    ),
  };
  const availableElements = (template.manifest.elements ?? []).filter(
    (element) =>
      !element.canvasIds?.length ||
      element.canvasIds.includes(activeCanvas.templateCanvasId),
  );
  const editable = continuous ? [] : (activeDefinition?.editable ?? []);

  return (
    <section className="editor-page">
      <div className="editor-toolbar">
        <button
          type="button"
          className="toolbar-back"
          onClick={() => navigate('/')}
        >
          <ArrowLeft /> Back
        </button>
        <div className="editor-title">
          <Input
            aria-label="Image title"
            value={image.title}
            onChange={(event) => update({ title: event.target.value })}
          />
        </div>
        <Button
          className="primary-action"
          onClick={() =>
            canvasSet
              ? setExportOpen(true)
              : void api.downloadImage(image.id, image.title)
          }
        >
          {canvasSet ? 'Export' : 'Download PNG'}
        </Button>
      </div>
      <div className={`editor-grid ${canvasSet ? 'is-multi-canvas' : ''}`}>
        <div
          className={`canvas-panel ${multi ? 'multi-canvas-panel' : continuous ? 'continuous-carousel-panel' : ''}`}
        >
          <input
            ref={canvasUpload}
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => {
              void handleCanvasUpload(event.target.files?.[0]);
              event.currentTarget.value = '';
            }}
          />
          {multi ? (
            <>
              <div className="multi-canvas-toolbar">
                <div className="multi-canvas-status">
                  <span
                    className={`save-state is-${status}`}
                    aria-live="polite"
                  >
                    {status === 'saving'
                      ? 'Saving…'
                      : status === 'error'
                        ? 'Save failed'
                        : 'Saved'}
                  </span>
                </div>
                {rules.allowAdd && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={canvases.length >= maxCanvases}
                    onClick={addCanvas}
                  >
                    <Plus /> Add canvas
                  </Button>
                )}
              </div>
              <div
                className="multi-canvas-strip"
                onPointerMove={continueCanvasDrag}
                onPointerUp={finishCanvasDrag}
                onPointerCancel={finishCanvasDrag}
              >
                {canvases.map((canvas, index) => {
                  const isActive = canvas.id === activeCanvas.id;
                  return (
                    <section
                      data-canvas-id={canvas.id}
                      className={`canvas-stage ${isActive ? 'is-active' : ''} ${draggedCanvasId === canvas.id ? 'is-dragging' : ''} ${droppingCanvasId === canvas.id ? 'is-dropping' : ''}`}
                      key={canvas.id}
                    >
                      <header className="canvas-stage-header">
                        <button
                          type="button"
                          className="canvas-stage-drag"
                          title="Drag to reorder"
                          onPointerDown={(event) =>
                            beginCanvasDrag(event, canvas.id)
                          }
                          onClick={(event) => {
                            if (suppressCanvasClick.current) {
                              event.preventDefault();
                              return;
                            }
                            setActiveCanvasId(canvas.id);
                            setSelectedElementId('');
                            setSelectedControlKeys([]);
                          }}
                        >
                          <GripVertical />
                          <span className="sr-only">Reorder {canvas.name}</span>
                        </button>
                        {rules.allowRename !== false ? (
                          <Input
                            className="canvas-stage-name-input"
                            aria-label="Canvas name"
                            value={canvas.name}
                            onFocus={() => {
                              setActiveCanvasId(canvas.id);
                              setSelectedElementId('');
                              setSelectedControlKeys([]);
                            }}
                            onChange={(event) =>
                              updateCanvases(
                                canvases.map((item) =>
                                  item.id === canvas.id
                                    ? { ...item, name: event.target.value }
                                    : item,
                                ),
                              )
                            }
                          />
                        ) : (
                          <button
                            type="button"
                            className="canvas-stage-name-button"
                            onClick={() => {
                              setActiveCanvasId(canvas.id);
                              setSelectedElementId('');
                              setSelectedControlKeys([]);
                            }}
                          >
                            <strong>{canvas.name}</strong>
                          </button>
                        )}
                        <span className="canvas-stage-position">
                          {index + 1} / {canvases.length}
                        </span>
                        <div className="canvas-stage-actions">
                          {rules.allowDuplicate !== false && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Duplicate canvas"
                              disabled={canvases.length >= maxCanvases}
                              onClick={() => duplicateCanvas(canvas.id)}
                            >
                              <Copy />
                              <span className="sr-only">Duplicate canvas</span>
                            </Button>
                          )}
                          {rules.allowDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Delete canvas"
                              disabled={canvases.length <= minCanvases}
                              onClick={() => deleteCanvas(canvas.id)}
                            >
                              <Trash2 />
                              <span className="sr-only">Delete canvas</span>
                            </Button>
                          )}
                        </div>
                      </header>
                      <div className="canvas-stage-frame">
                        <TemplateFrame
                          key={`${image.id}:${canvas.id}`}
                          template={template}
                          state={image.state}
                          canvas={canvas}
                          canvasIndex={index}
                          interactive
                          maxHeight={4000}
                          onFocusCanvas={() => {
                            setActiveCanvasId(canvas.id);
                            setSelectedElementId('');
                            setSelectedControlKeys([]);
                          }}
                          onRequestImage={(key) => requestImage(canvas.id, key)}
                          onSelectElement={(elementId, keys) =>
                            selectElement(canvas.id, elementId, keys)
                          }
                          onState={(_state, runtimePatch) =>
                            patchCanvasById(canvas.id, runtimePatch ?? _state)
                          }
                        />
                      </div>
                    </section>
                  );
                })}
              </div>
            </>
          ) : continuous ? (
            <>
              <div className="canvas-rail continuous-carousel-rail">
                <div className="canvas-status">
                  <span>
                    {canvases.length} segments · {template.manifest.width}×
                    {template.manifest.height} each
                  </span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={`save-state is-${status}`}
                    aria-live="polite"
                  >
                    {status === 'saving'
                      ? 'Saving…'
                      : status === 'error'
                        ? 'Save failed'
                        : 'Saved'}
                  </span>
                </div>
                <span>
                  Selected: {activeCanvas.name} · one continuous canvas
                </span>
              </div>
              <TemplateFrame
                key={image.id}
                template={template}
                state={image.state}
                canvas={activeCanvas}
                canvasIndex={activeIndex}
                interactive
                maxHeight={1080}
                onFocusCanvas={(point) => {
                  if (!point) return;
                  const coordinate =
                    template.manifest.carousel?.direction === 'vertical'
                      ? point.y
                      : point.x;
                  const segmentLength =
                    template.manifest.carousel?.direction === 'vertical'
                      ? template.manifest.height
                      : template.manifest.width;
                  const index = Math.min(
                    canvases.length - 1,
                    Math.max(0, Math.floor(coordinate / segmentLength)),
                  );
                  setActiveCanvasId(canvases[index].id);
                }}
                onRequestImage={(key) => requestImage(activeCanvas.id, key)}
                onSelectElement={(elementId, keys) => {
                  setSelectedElementId(elementId);
                  setSelectedControlKeys(keys);
                }}
                onState={(_state, runtimePatch) =>
                  patchCanvas(runtimePatch ?? _state)
                }
              />
              <nav className="carousel-navigation" aria-label="Carousel segments">
                <Button variant="ghost" size="icon" aria-label="Previous segment"
                  disabled={activeIndex === 0}
                  onClick={(event) => {
                    const viewport = event.currentTarget.closest('.canvas-panel')?.querySelector<HTMLElement>('.carousel-strip-host');
                    const strip = viewport?.querySelector<HTMLElement>('.frame-sizer');
                    if (!viewport || !strip) return;
                    const vertical = template.manifest.carousel?.direction === 'vertical';
                    const step = (vertical ? strip.offsetHeight : strip.offsetWidth) / canvases.length;
                    viewport.scrollBy({
                      left: vertical ? 0 : -1 * step,
                      top: vertical ? -1 * step : 0,
                      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
                    });
                  }}>
                  <ArrowLeft />
                </Button>
                <span aria-live="polite">{activeIndex + 1} / {canvases.length}</span>
                <Button variant="ghost" size="icon" aria-label="Next segment"
                  disabled={activeIndex === canvases.length - 1}
                  onClick={(event) => {
                    const viewport = event.currentTarget.closest('.canvas-panel')?.querySelector<HTMLElement>('.carousel-strip-host');
                    const strip = viewport?.querySelector<HTMLElement>('.frame-sizer');
                    if (!viewport || !strip) return;
                    const vertical = template.manifest.carousel?.direction === 'vertical';
                    const step = (vertical ? strip.offsetHeight : strip.offsetWidth) / canvases.length;
                    viewport.scrollBy({
                      left: vertical ? 0 : 1 * step,
                      top: vertical ? 1 * step : 0,
                      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
                    });
                  }}>
                  <ArrowRight />
                </Button>
              </nav>
            </>
          ) : (
            <>
              <div className="canvas-rail">
                <div className="canvas-status">
                  <span>
                    {size.width}×{size.height}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={`save-state is-${status}`}
                    aria-live="polite"
                  >
                    {status === 'saving'
                      ? 'Saving…'
                      : status === 'error'
                        ? 'Save failed'
                        : 'Saved'}
                  </span>
                </div>
                <span>
                  {activeState.image
                    ? 'Drag to position · Scroll to zoom'
                    : 'Click the canvas to upload an image'}
                </span>
              </div>
              <TemplateFrame
                key={image.id}
                template={template}
                state={image.state}
                canvas={activeCanvas}
                interactive
                maxHeight={650}
                onRequestImage={(key) => requestImage(activeCanvas.id, key)}
                onSelectElement={(elementId, keys) => {
                  setSelectedElementId(elementId);
                  setSelectedControlKeys(keys);
                }}
                onState={(_state, runtimePatch) =>
                  patchCanvas(runtimePatch ?? _state)
                }
              />
            </>
          )}
        </div>
        <aside ref={controlPanel} className="control-panel">
          <header className="panel-heading">
            <h2>Controls</h2>
          </header>
          <div
            className="template-context"
            aria-label={`Current template: ${template.name}`}
          >
            <span>Template</span>
            <strong>{template.name}</strong>
          </div>
          {controlGroups.template.length > 0 && (
            <section className="control-module controls-stack">
              <h3>Entire template</h3>
              {controlGroups.template.map((control) => (
                <div
                  key={control.key}
                  data-control-key={control.key}
                  className={`control-anchor ${selectedControlKeys.includes(control.key) ? 'is-targeted' : ''}`}
                >
                  <Control
                    control={control}
                    value={templateState(image.state)[control.key]}
                    onChange={(value) =>
                      replaceState(
                        withTemplateState(image.state, {
                          ...templateState(image.state),
                          [control.key]: value,
                        }),
                      )
                    }
                  />
                </div>
              ))}
            </section>
          )}
          {isFitFrame && (
            <section className="control-module size-module">
              <h3>Size</h3>
              <div className="preset-grid">
                {presets.map((preset) => (
                  <button
                    type="button"
                    key={preset.label}
                    className={
                      Number(image.state.canvasWidth) === preset.width &&
                      Number(image.state.canvasHeight) === preset.height
                        ? 'is-selected'
                        : ''
                    }
                    onClick={() =>
                      patchLegacy({
                        canvasWidth: preset.width,
                        canvasHeight: preset.height,
                        x: 0,
                        y: 0,
                      })
                    }
                  >
                    <strong>{preset.label}</strong>
                    <small>
                      {preset.width} × {preset.height}
                    </small>
                  </button>
                ))}
              </div>
              <div className="custom-size">
                <SizeInput
                  label="Width"
                  value={size.width}
                  onChange={(canvasWidth) => patchLegacy({ canvasWidth })}
                />
                <span aria-hidden="true">×</span>
                <SizeInput
                  label="Height"
                  value={size.height}
                  onChange={(canvasHeight) => patchLegacy({ canvasHeight })}
                />
              </div>
            </section>
          )}
          {(editable.length > 0 || controlGroups.canvas.length > 0) && (
            <section className="control-module controls-stack">
              <h3>{continuous ? 'Continuous canvas' : 'Current canvas'}</h3>
              {editable.includes('width') && (
                <div
                  data-control-key="width"
                  className={`control-anchor ${selectedControlKeys.includes('width') ? 'is-targeted' : ''}`}
                >
                  <SizeInput
                    label="Width"
                    value={size.width}
                    onChange={(value) => updateCanvasSize('width', value)}
                  />
                </div>
              )}
              {editable.includes('height') && (
                <div
                  data-control-key="height"
                  className={`control-anchor ${selectedControlKeys.includes('height') ? 'is-targeted' : ''}`}
                >
                  <SizeInput
                    label="Height"
                    value={size.height}
                    onChange={(value) => updateCanvasSize('height', value)}
                  />
                </div>
              )}
              {editable
                .filter(
                  (property) => property !== 'width' && property !== 'height',
                )
                .map(
                  (property) =>
                    canvasPropertyControls[property] && (
                      <div
                        key={property}
                        data-control-key={property}
                        className={`control-anchor ${selectedControlKeys.includes(property) ? 'is-targeted' : ''}`}
                      >
                        <Control
                          control={canvasPropertyControls[property]}
                          value={activeCanvas.state[property]}
                          onChange={(value) =>
                            patchCanvas({ [property]: value })
                          }
                        />
                      </div>
                    ),
                )}
              {controlGroups.canvas.map((control) => (
                <div
                  key={control.key}
                  data-control-key={control.key}
                  className={`control-anchor ${selectedControlKeys.includes(control.key) ? 'is-targeted' : ''}`}
                >
                  <Control
                    control={control}
                    value={activeCanvas.state[control.key]}
                    onChange={(value) => patchCanvas({ [control.key]: value })}
                  />
                </div>
              ))}
            </section>
          )}
          {availableElements.length > 0 && (
            <section
              ref={elementControls}
              className={`control-module controls-stack element-control-module ${selectedElementId ? 'is-selected' : ''}`}
            >
              <h3>Selected element</h3>
              <label className="field-control">
                <span>Element</span>
                <select
                  value={selectedElementId}
                  onChange={(event) => {
                    setSelectedElementId(event.target.value);
                    setSelectedControlKeys([]);
                  }}
                >
                  <option value="">Select an element</option>
                  {availableElements.map((element) => (
                    <option key={element.id} value={element.id}>
                      {element.label}
                    </option>
                  ))}
                </select>
              </label>
              {selectedElementId && (
                <div className="element-permissions">
                  {availableElements
                    .find((element) => element.id === selectedElementId)
                    ?.allow?.map((permission) => (
                      <span key={permission}>{permission}</span>
                    ))}
                </div>
              )}
              {controlGroups.element.map((control) => (
                <div
                  key={control.key}
                  data-control-key={control.key}
                  className={`control-anchor ${selectedControlKeys.includes(control.key) ? 'is-targeted' : ''}`}
                >
                  <Control
                    control={control}
                    value={activeCanvas.state[control.key]}
                    onChange={(value) => patchCanvas({ [control.key]: value })}
                  />
                </div>
              ))}
            </section>
          )}
          {controlGroups.export.length > 0 && (
            <section className="control-module controls-stack">
              <h3>Export settings</h3>
              {controlGroups.export.map((control) => (
                <div
                  key={control.key}
                  data-control-key={control.key}
                  className={`control-anchor ${selectedControlKeys.includes(control.key) ? 'is-targeted' : ''}`}
                >
                  <Control
                    control={control}
                    value={exportState(image.state)[control.key]}
                    onChange={(value) =>
                      replaceState(
                        withExportState(image.state, {
                          ...exportState(image.state),
                          [control.key]: value,
                        }),
                      )
                    }
                  />
                </div>
              ))}
            </section>
          )}
          {isFitFrame && (
            <Button
              className="reset-button"
              variant="outline"
              onClick={() => patchLegacy({ x: 0, y: 0, zoom: 1 })}
            >
              <RotateCcw /> Reset position
            </Button>
          )}
        </aside>
      </div>
      <ExportDialog
        open={exportOpen}
        image={image}
        template={template}
        activeCanvas={activeCanvas}
        onOpenChange={setExportOpen}
      />
    </section>
  );
}

export default function App() {
  const { route, navigate } = useRoute();
  const [templates, setTemplates] = useState<TemplateDocument[]>([]);
  const [images, setImages] = useState<ImageDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const [nextTemplates, nextImages] = await Promise.all([
        api.listTemplates(),
        api.listImages(),
      ]);
      setTemplates(nextTemplates);
      setImages(nextImages);
      setNeedsAuth(false);
      setError('');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) setNeedsAuth(true);
      else
        setError(
          cause instanceof Error
            ? cause.message
            : 'Could not load Image Builder.',
        );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const openCreated = useCallback(
    (imageId: string) => navigate(`/edit/${imageId}`),
    [navigate],
  );
  useImageBuilderWebMcp(openCreated);
  if (needsAuth) return <AuthGate onReady={() => void refresh()} />;
  return (
    <main className="app-shell">
      <TopBar route={route} navigate={navigate} />
      {error && <div className="global-error">{error}</div>}
      {loading ? (
        <Loading />
      ) : route.name === 'gallery' ? (
        <Gallery
          images={images}
          templates={templates}
          navigate={navigate}
          refresh={refresh}
          onNew={() => setNewOpen(true)}
        />
      ) : route.name === 'templates' ? (
        <Templates
          templates={templates}
          images={images}
          refresh={refresh}
          navigate={navigate}
        />
      ) : (
        <Editor
          id={route.id}
          templates={templates}
          navigate={navigate}
          onSaved={refresh}
        />
      )}
      <NewImageDialog
        open={newOpen}
        templates={templates}
        onOpenChange={setNewOpen}
        navigate={navigate}
      />
    </main>
  );
}
