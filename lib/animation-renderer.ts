import { decodePatch } from '@/lib/animation-decode';
import type { IndexedAnimation } from '@/lib/animation-index';

type PatchDecoder = (file: Blob, animation: IndexedAnimation, index: number) => Promise<ImageBitmap>;
type Snapshot = (canvas: OffscreenCanvas) => Promise<ImageBitmap>;

export class AnimationRenderer {
  private readonly context: OffscreenCanvasRenderingContext2D;
  private currentIndex = -1;

  constructor(
    private readonly file: Blob,
    private readonly animation: IndexedAnimation,
    private readonly canvas: OffscreenCanvas,
    private readonly decoder: PatchDecoder = decodePatch,
    private readonly snapshot: Snapshot = (surface) => createImageBitmap(surface)
  ) {
    const context = canvas.getContext('2d');
    if (!context) { throw new Error('animation-resource-error'); }
    this.context = context;
    this.reset();
  }

  private fillBackground(left: number, top: number, width: number, height: number): void {
    this.context.clearRect(left, top, width, height);
    const [red, green, blue, alpha] = this.animation.background;
    if (alpha) {
      this.context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`;
      this.context.fillRect(left, top, width, height);
    }
  }

  private reset(): void {
    this.fillBackground(0, 0, this.canvas.width, this.canvas.height);
    this.currentIndex = -1;
  }

  private scaledRect(index: number): { left: number; top: number; width: number; height: number } {
    const frame = this.animation.frames[index];
    const scaleX = this.animation.metadata.renderWidth / this.animation.metadata.width;
    const scaleY = this.animation.metadata.renderHeight / this.animation.metadata.height;
    return { left: frame.left * scaleX, top: frame.top * scaleY, width: frame.width * scaleX, height: frame.height * scaleY };
  }

  private replayStart(target: number): number {
    // 覆盖整张画面的 SOURCE 帧可以作为拖动时的重放起点。
    for (let index = target; index > 0; index -= 1) {
      const frame = this.animation.frames[index];
      if (frame.left === 0 && frame.top === 0 && frame.width === this.animation.metadata.width
        && frame.height === this.animation.metadata.height && frame.blend === 'source'
        && (index === target || frame.dispose !== 'previous')) {
        return index;
      }
    }
    return 0;
  }

  async renderTo(target: number, stale: () => boolean): Promise<ImageBitmap | null> {
    if (target < 0 || target >= this.animation.frames.length) { throw new Error('animation-decode-failed'); }
    let start = this.currentIndex + 1;
    if (target < this.currentIndex || this.currentIndex >= 0 && this.animation.frames[this.currentIndex].dispose === 'previous') {
      this.reset();
      start = this.replayStart(target);
    }
    try {
      for (let index = start; index <= target; index += 1) {
        if (stale()) { return null; }
        if (index > start || start > 0 && this.currentIndex >= 0) {
          const previous = this.animation.frames[index - 1];
          if (previous.dispose === 'background') {
            const rect = this.scaledRect(index - 1);
            this.fillBackground(rect.left, rect.top, rect.width, rect.height);
          }
        }
        const frame = this.animation.frames[index];
        // PREVIOUS 帧在下一帧前恢复旧画面；重放时跳过它，无需额外保存整张画面。
        if (index < target && frame.dispose === 'previous') {
          this.currentIndex = index;
          continue;
        }
        const patch = await this.decoder(this.file, this.animation, index);
        try {
          if (stale()) {
            // 上一帧的 BACKGROUND 可能已清除；重置后再处理新请求。
            this.reset();
            return null;
          }
          const rect = this.scaledRect(index);
          if (frame.blend === 'source') { this.context.clearRect(rect.left, rect.top, rect.width, rect.height); }
          this.context.drawImage(patch, rect.left, rect.top, rect.width, rect.height);
          this.currentIndex = index;
        } finally {
          patch.close();
        }
      }
      return this.snapshot(this.canvas);
    } catch (error) {
      this.reset();
      throw error;
    }
  }
}
