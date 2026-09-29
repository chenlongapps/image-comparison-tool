import type { AnimationMetadata } from '@/lib/animation';
import type { AnimationWorkerRequest, AnimationWorkerResponse } from '@/lib/animation.worker';

interface WorkerPort {
  onmessage: ((event: MessageEvent<AnimationWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: AnimationWorkerRequest): void;
  terminate(): void;
}

function cancelledError(): DOMException {
  return new DOMException('Upload cancelled', 'AbortError');
}

export class AnimationSession {
  metadata: AnimationMetadata | null = null;
  private firstFrame: ImageBitmap | null = null;
  private disposed = false;
  private requestId = 0;
  private requestedIndex = -1;
  private onFrame: ((bitmap: ImageBitmap, index: number) => void) | null = null;
  private onError: ((error: Error) => void) | null = null;

  private constructor(private readonly worker: WorkerPort) {
    worker.onmessage = (event) => this.receive(event.data);
    worker.onerror = () => this.fail(new Error('animation-resource-error'));
  }

  static create(file: File, signal: AbortSignal, workerFactory: () => WorkerPort = () => new Worker(new URL('./animation.worker.ts', import.meta.url))): Promise<AnimationSession | null> {
    return new Promise((resolve, reject) => {
      const session = new AnimationSession(workerFactory());
      let settled = false;
      const timeout = globalThis.setTimeout(() => finish(new Error('animation-resource-error')), 120000);
      const onAbort = () => finish(cancelledError());
      const finish = (error?: Error, result?: AnimationSession | null) => {
        if (settled) { return; }
        settled = true;
        globalThis.clearTimeout(timeout);
        signal.removeEventListener('abort', onAbort);
        session.initFinished = null;
        if (error || result === null) { session.dispose(); }
        if (error) { reject(error); } else { resolve(result ?? null); }
      };
      session.initFinished = (response) => {
        if (response.type === 'static') { finish(undefined, null); }
        else if (response.type === 'ready') {
          session.metadata = response.metadata;
          session.firstFrame = response.bitmap;
          finish(undefined, session);
        } else if (response.type === 'error') { finish(new Error(response.error)); }
      };
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        session.worker.postMessage({ type: 'init', file });
      } catch {
        finish(new Error('animation-resource-error'));
      }
    });
  }

  private initFinished: ((response: AnimationWorkerResponse) => void) | null = null;

  private receive(response: AnimationWorkerResponse): void {
    if (this.disposed) {
      if ('bitmap' in response) { response.bitmap.close(); }
      return;
    }
    if (this.initFinished) {
      this.initFinished(response);
      return;
    }
    if (response.type === 'frame') {
      if (response.id !== this.requestId || response.index !== this.requestedIndex || !this.onFrame) {
        response.bitmap.close();
      } else {
        this.onFrame(response.bitmap, response.index);
      }
    } else if (response.type === 'error' && response.id === this.requestId) {
      this.requestedIndex = -1;
      this.onError?.(new Error(response.error));
    }
  }

  private fail(error: Error): void {
    if (this.initFinished) {
      this.initFinished({ type: 'error', error: 'animation-resource-error' });
    } else {
      this.onError?.(error);
    }
  }

  takeFirstFrame(): ImageBitmap | null {
    const bitmap = this.firstFrame;
    this.firstFrame = null;
    return bitmap;
  }

  subscribe(onFrame: (bitmap: ImageBitmap, index: number) => void, onError: (error: Error) => void): () => void {
    this.onFrame = onFrame;
    this.onError = onError;
    return () => {
      this.onFrame = null;
      this.onError = null;
    };
  }

  requestFrame(index: number): void {
    if (this.disposed || index === this.requestedIndex) { return; }
    this.requestedIndex = index;
    this.worker.postMessage({ type: 'frame', id: ++this.requestId, index });
  }

  dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true;
    this.firstFrame?.close();
    this.firstFrame = null;
    this.onFrame = null;
    this.onError = null;
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
  }
}
