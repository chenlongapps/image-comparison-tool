import { describe, expect, it, vi } from 'vitest';
import * as upng from 'upng-js';
import { parseGIF, decompressFrames } from 'gifuct-js';

import { advanceAnimation, frameIndexAtTime, linkedSeekTime, normalizeFrameDuration, renderSize, setPlaying, type AnimationMetadata } from '@/lib/animation';
import { makeGifFrameBuffer, makePngFrameBlob, makeWebpFrameBlob } from '@/lib/animation-decode';
import { indexAnimation, type IndexedAnimation, type WebpFrame } from '@/lib/animation-index';
import { AnimationRenderer } from '@/lib/animation-renderer';
import { AnimationSession } from '@/lib/animation-session';
import type { AnimationWorkerRequest, AnimationWorkerResponse } from '@/lib/animation.worker';

const textBytes = (value: string) => [...new TextEncoder().encode(value)];
const gifImage = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0];
const gifHeader = [...textBytes('GIF89a'), 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 0, 0];
const gifLoopOnce = [0x21, 0xff, 11, ...textBytes('NETSCAPE2.0'), 3, 1, 1, 0, 0];
const gce = (delay: number, disposal = 0) => [0x21, 0xf9, 4, disposal << 2, delay, 0, 0, 0];

function riffChunk(name: string, payload: number[]): number[] {
  return [...textBytes(name), payload.length, 0, 0, 0, ...payload, ...(payload.length % 2 ? [0] : [])];
}

function webp(animated: boolean): Blob {
  const image = riffChunk('VP8 ', [0, 0]);
  const frame = (duration: number, flags: number) => riffChunk('ANMF', [0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, duration, 0, 0, flags, ...image]);
  const chunks = [
    ...riffChunk('VP8X', [animated ? 2 : 0, 0, 0, 0, 1, 0, 0, 1, 0, 0]),
    ...(animated ? [...riffChunk('ANIM', [7, 6, 5, 255, 3, 0]), ...frame(120, 2), ...frame(230, 1)] : [])
  ];
  const size = chunks.length + 4;
  return new Blob([Uint8Array.from([...textBytes('RIFF'), size, 0, 0, 0, ...textBytes('WEBP'), ...chunks])]);
}

describe('chunked frame indexes', () => {
  it('indexes GIF positions, delays, disposal and repeat count, then extracts one frame', async() => {
    const file = new Blob([Uint8Array.from([
      ...gifHeader, ...gifLoopOnce, ...gce(12), ...gifImage, ...gce(23, 2), ...gifImage, 0x3b
    ])]);
    const result = await indexAnimation(file);
    expect(result?.format).toBe('gif');
    if (result?.format !== 'gif') { return; }
    expect(result.metadata).toMatchObject({ width: 1, height: 1, frameCount: 2, loopCount: 2, durations: [120, 230], duration: 0.35 });
    expect(result.frames.map((frame) => frame.dispose)).toEqual(['none', 'background']);
    expect(result.frames[1].image.offset).toBeGreaterThan(result.frames[0].image.offset);
    const extracted = await makeGifFrameBuffer(file, result, result.frames[1]);
    expect(decompressFrames(parseGIF(extracted), true)[0].patch).toHaveLength(4);
    expect(await indexAnimation(new Blob([Uint8Array.from([...gifHeader, ...gifImage, 0x3b])]))).toBeNull();
  });

  it('indexes APNG frame data and reconstructs a standalone PNG', async() => {
    const red = Uint8Array.from({ length: 256 }, (_, index) => index % 4 === 0 || index % 4 === 3 ? 255 : 0).buffer;
    const blue = Uint8Array.from({ length: 256 }, (_, index) => index % 4 === 2 || index % 4 === 3 ? 255 : 0).buffer;
    const file = new Blob([upng.encode([red, blue], 8, 8, 0, [120, 230])]);
    const result = await indexAnimation(file);
    expect(result?.format).toBe('apng');
    if (result?.format !== 'apng') { return; }
    expect(result.metadata).toMatchObject({ width: 8, height: 8, frameCount: 2, loopCount: 0, durations: [120, 230] });
    expect(result.frames.every((frame) => frame.data.length > 0)).toBe(true);
    const standalone = await makePngFrameBlob(file, result, result.frames[1]);
    const decoded = upng.decode(await standalone.arrayBuffer());
    expect([decoded.width, decoded.height]).toEqual([8, 8]);
    expect(new Uint8Array(upng.toRGBA8(decoded)[0]).slice(0, 4)).toEqual(Uint8Array.of(0, 0, 255, 255));
    expect(await indexAnimation(new Blob([upng.encode([red], 8, 8, 0)]))).toBeNull();
  });

  it('indexes animated WebP frame headers and extracts a single-frame RIFF', async() => {
    const file = webp(true);
    const result = await indexAnimation(file);
    expect(result?.format).toBe('webp');
    if (result?.format !== 'webp') { return; }
    expect(result.metadata).toMatchObject({ width: 2, height: 2, frameCount: 2, loopCount: 3, durations: [120, 230] });
    expect(result.background).toEqual([5, 6, 7, 255]);
    expect(result.frames.map((frame) => [frame.blend, frame.dispose])).toEqual([['source', 'none'], ['over', 'background']]);
    const bytes = new Uint8Array(await makeWebpFrameBlob(file, result.frames[0]).arrayBuffer());
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe('WEBP');
    expect(String.fromCharCode(...bytes.subarray(12, 16))).toBe('VP8X');
    expect(String.fromCharCode(...bytes.subarray(30, 34))).toBe('VP8 ');
    expect(await indexAnimation(webp(false))).toBeNull();
  });
});

describe('render budget and timeline', () => {
  it('limits the displayed surface without multiplying by frame count', () => {
    expect(renderSize(800, 600)).toEqual({ width: 800, height: 600 });
    const size = renderSize(12000, 8000);
    expect(size.width * size.height).toBeLessThanOrEqual(4_000_000);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(4096);
    expect(size.width / size.height).toBeCloseTo(1.5, 2);
    expect(renderSize(10000, 100)).toEqual({ width: 4096, height: 41 });
  });

  it('maps frame durations and linked controls', () => {
    expect(normalizeFrameDuration(0)).toBe(10);
    expect(frameIndexAtTime([100, 200], 0.1)).toBe(1);
    expect(frameIndexAtTime([100, 200], 0.3)).toBe(1);
    expect(linkedSeekTime(0.5, 1, 4, true)).toBe(2);
    expect(linkedSeekTime(0.5, 1, 4, false)).toBeNull();
    const ended = { isPlaying: false, currentTime: 1, duration: 1, completedLoops: 1 };
    expect(setPlaying(ended, true)).toMatchObject({ isPlaying: true, currentTime: 0, completedLoops: 0 });
    const playing = { isPlaying: true, currentTime: 0.25, duration: 0.3, completedLoops: 0 };
    expect(advanceAnimation(playing, 0.1, 2)).toMatchObject({ completedLoops: 1, currentTime: expect.closeTo(0.05) });
  });
});

interface PixelBitmap {
  color: [number, number, number, number];
  close: ReturnType<typeof vi.fn>;
}

class PixelCanvas {
  width = 1;
  height = 1;
  pixel: [number, number, number, number] = [0, 0, 0, 0];
  fillStyle = '';

  getContext() { return this; }
  clearRect() { this.pixel = [0, 0, 0, 0]; }
  fillRect() {
    const values = this.fillStyle.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
    this.pixel = [values[0], values[1], values[2], Math.round(values[3] * 255)];
  }
  drawImage(bitmap: ImageBitmap) {
    const source = (bitmap as unknown as PixelBitmap).color;
    const alpha = source[3] / 255;
    const oldAlpha = this.pixel[3] / 255;
    const outAlpha = alpha + oldAlpha * (1 - alpha);
    if (outAlpha === 0) { this.pixel = [0, 0, 0, 0]; return; }
    this.pixel = [
      ...[0, 1, 2].map((channel) => Math.round((source[channel] * alpha + this.pixel[channel] * oldAlpha * (1 - alpha)) / outAlpha)),
      Math.round(outAlpha * 255)
    ] as [number, number, number, number];
  }
}

describe('bounded compositor', () => {
  it('blends transparency, replays PREVIOUS and clears BACKGROUND without storing old frames', async() => {
    const frame = (blend: WebpFrame['blend'], dispose: WebpFrame['dispose']): WebpFrame => ({
      left: 0, top: 0, width: 1, height: 1, durationMs: 100, blend, dispose,
      data: { offset: 0, length: 0 }, hasAlpha: true
    });
    const frames = [frame('source', 'none'), frame('over', 'previous'), frame('over', 'none'), frame('source', 'background'), frame('over', 'none')];
    const metadata: AnimationMetadata = {
      format: 'webp', width: 1, height: 1, renderWidth: 1, renderHeight: 1,
      frameCount: 5, loopCount: 0, durations: Array(5).fill(100), duration: 0.5
    };
    const animation: IndexedAnimation = { format: 'webp', metadata, frames, background: [0, 255, 0, 255] };
    const colors: PixelBitmap['color'][] = [[255, 0, 0, 255], [0, 0, 255, 128], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    const patches: PixelBitmap[] = [];
    const canvas = new PixelCanvas();
    const decoder = vi.fn(async(_file: Blob, _animation: IndexedAnimation, index: number) => {
      const patch = { color: colors[index], close: vi.fn() };
      patches.push(patch);
      return patch as unknown as ImageBitmap;
    });
    const renderer = new AnimationRenderer(new Blob(), animation, canvas as unknown as OffscreenCanvas, decoder, async() => ({
      color: [...canvas.pixel], close: vi.fn()
    }) as unknown as ImageBitmap);
    const colorAt = async(index: number) => (await renderer.renderTo(index, () => false) as unknown as PixelBitmap).color;
    expect(await colorAt(0)).toEqual([255, 0, 0, 255]);
    expect(await colorAt(1)).toEqual([127, 0, 128, 255]);
    expect(await colorAt(2)).toEqual([255, 0, 0, 255]);
    expect(await colorAt(3)).toEqual([0, 0, 0, 0]);
    expect(await colorAt(4)).toEqual([0, 255, 0, 255]);
    expect(patches.every((patch) => patch.close.mock.calls.length === 1)).toBe(true);
    expect(decoder.mock.calls.length).toBeLessThan(12);
  });

  it('closes an obsolete decoded patch before it is drawn', async() => {
    const file = webp(true);
    const animation = await indexAnimation(file);
    if (animation?.format !== 'webp') { throw new Error('fixture failed'); }
    const patch = { color: [1, 2, 3, 255], close: vi.fn() };
    const canvas = new PixelCanvas();
    const renderer = new AnimationRenderer(file, animation, canvas as unknown as OffscreenCanvas, async() => patch as unknown as ImageBitmap, async() => patch as unknown as ImageBitmap);
    let called = 0;
    expect(await renderer.renderTo(0, () => ++called > 1)).toBeNull();
    expect(patch.close).toHaveBeenCalledOnce();
  });

  it('restores a consistent canvas after cancelling a request during disposal', async() => {
    const file = webp(true);
    const animation = await indexAnimation(file);
    if (animation?.format !== 'webp') { throw new Error('fixture failed'); }
    animation.frames[0].dispose = 'background';
    const canvas = new PixelCanvas();
    const renderer = new AnimationRenderer(file, animation, canvas as unknown as OffscreenCanvas,
      async(_file, _animation, index) => ({ color: index === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255], close: vi.fn() }) as unknown as ImageBitmap,
      async() => ({ color: [...canvas.pixel], close: vi.fn() }) as unknown as ImageBitmap);
    await renderer.renderTo(0, () => false);
    let checks = 0;
    expect(await renderer.renderTo(1, () => ++checks > 1)).toBeNull();
    const restored = await renderer.renderTo(0, () => false) as unknown as PixelBitmap;
    expect(restored.color).toEqual([255, 0, 0, 255]);
  });
});

class FakeWorker {
  onmessage: ((event: MessageEvent<AnimationWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  messages: AnimationWorkerRequest[] = [];
  terminate = vi.fn();
  postMessage(message: AnimationWorkerRequest) { this.messages.push(message); }
  emit(message: AnimationWorkerResponse) { this.onmessage?.({ data: message } as MessageEvent<AnimationWorkerResponse>); }
}

describe('session ownership', () => {
  it('discards stale frame responses and closes unused bitmaps on disposal', async() => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const pending = AnimationSession.create(new Blob() as File, controller.signal, () => worker);
    const metadata: AnimationMetadata = {
      format: 'gif', width: 1, height: 1, renderWidth: 1, renderHeight: 1,
      frameCount: 2, loopCount: 0, durations: [100, 100], duration: 0.2
    };
    const initial = { close: vi.fn() } as unknown as ImageBitmap;
    worker.emit({ type: 'ready', metadata, bitmap: initial });
    const session = await pending;
    expect(session?.metadata).toEqual(metadata);
    const onFrame = vi.fn((bitmap: ImageBitmap) => bitmap.close());
    session?.subscribe(onFrame, vi.fn());
    session?.requestFrame(0);
    session?.requestFrame(1);
    const old = { close: vi.fn() } as unknown as ImageBitmap;
    const latest = { close: vi.fn() } as unknown as ImageBitmap;
    worker.emit({ type: 'frame', id: 1, index: 0, bitmap: old });
    worker.emit({ type: 'frame', id: 2, index: 1, bitmap: latest });
    expect(old.close).toHaveBeenCalledOnce();
    expect(onFrame).toHaveBeenCalledOnce();
    expect(latest.close).toHaveBeenCalledOnce();
    session?.dispose();
    expect(initial.close).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('terminates an in-flight worker when an upload is aborted', async() => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const pending = AnimationSession.create(new Blob() as File, controller.signal, () => worker);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
