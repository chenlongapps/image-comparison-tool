import { indexAnimation } from '@/lib/animation-index';
import { AnimationRenderer } from '@/lib/animation-renderer';
import type { AnimationMetadata } from '@/lib/animation';

export type AnimationWorkerRequest =
  | { type: 'init'; file: File }
  | { type: 'frame'; id: number; index: number };

export type AnimationWorkerResponse =
  | { type: 'static' }
  | { type: 'ready'; metadata: AnimationMetadata; bitmap: ImageBitmap }
  | { type: 'frame'; id: number; index: number; bitmap: ImageBitmap }
  | { type: 'error'; id?: number; error: 'animation-decode-failed' | 'animation-resource-error' };

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<AnimationWorkerRequest>) => void) | null;
  postMessage: (message: AnimationWorkerResponse, transfer?: Transferable[]) => void;
};

let renderer: AnimationRenderer | null = null;
let wanted: { id: number; index: number } | null = null;
let processing = false;

function errorCode(error: unknown): 'animation-decode-failed' | 'animation-resource-error' {
  if (error instanceof RangeError || error instanceof Error && error.message === 'animation-resource-error'
    || error instanceof DOMException && ['QuotaExceededError', 'OutOfMemoryError'].includes(error.name)) {
    return 'animation-resource-error';
  }
  return 'animation-decode-failed';
}

async function processFrames(): Promise<void> {
  if (processing) { return; }
  processing = true;
  try {
    while (wanted) {
      const request = wanted;
      wanted = null;
      try {
        if (!renderer) { throw new Error('animation-decode-failed'); }
        const bitmap = await renderer.renderTo(request.index, () => wanted !== null && wanted.id > request.id);
        if (bitmap) {
          const newer = wanted as { id: number; index: number } | null;
          if (newer && newer.id > request.id) { bitmap.close(); }
          else { workerScope.postMessage({ type: 'frame', id: request.id, index: request.index, bitmap }, [bitmap]); }
        }
      } catch (error) {
        workerScope.postMessage({ type: 'error', id: request.id, error: errorCode(error) });
      }
    }
  } finally {
    processing = false;
  }
}

async function initialize(file: File): Promise<void> {
  try {
    const indexed = await indexAnimation(file);
    if (!indexed) {
      workerScope.postMessage({ type: 'static' });
      return;
    }
    renderer = new AnimationRenderer(file, indexed, new OffscreenCanvas(indexed.metadata.renderWidth, indexed.metadata.renderHeight));
    const bitmap = await renderer.renderTo(0, () => false);
    if (!bitmap) { throw new Error('animation-decode-failed'); }
    workerScope.postMessage({ type: 'ready', metadata: indexed.metadata, bitmap }, [bitmap]);
  } catch (error) {
    workerScope.postMessage({ type: 'error', error: errorCode(error) });
  }
}

workerScope.onmessage = (event) => {
  const request = event.data;
  if (request.type === 'init') {
    void initialize(request.file);
  } else {
    wanted = { id: request.id, index: request.index };
    void processFrames();
  }
};
