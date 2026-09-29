import type { IndexedAnimation, GifFrame, PngFrame, WebpFrame } from '@/lib/animation-index';

const pngSignature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const encoder = new TextEncoder();
const blobBytes = (bytes: Uint8Array): ArrayBuffer => Uint8Array.from(bytes).buffer;

function be32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function le32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function crcUpdate(crc: number, bytes: Uint8Array): number {
  let next = crc;
  for (const byte of bytes) {
    next ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      next = next & 1 ? (next >>> 1) ^ 0xedb88320 : next >>> 1;
    }
  }
  return next;
}

function pngChunk(type: string, payload: Uint8Array): Uint8Array {
  const name = encoder.encode(type);
  const bytes = new Uint8Array(payload.length + 12);
  bytes.set(be32(payload.length), 0);
  bytes.set(name, 4);
  bytes.set(payload, 8);
  bytes.set(be32((crcUpdate(crcUpdate(0xffffffff, name), payload) ^ 0xffffffff) >>> 0), payload.length + 8);
  return bytes;
}

export async function makeGifFrameBuffer(file: Blob, animation: Extract<IndexedAnimation, { format: 'gif' }>, frame: GifFrame): Promise<ArrayBuffer> {
  // gifuct-js 只看到当前帧；不会解压整份动图。
  return new Blob([blobBytes(animation.header), blobBytes(frame.gce), file.slice(frame.image.offset, frame.image.offset + frame.image.length), blobBytes(Uint8Array.of(0x3b))]).arrayBuffer();
}

export async function makePngFrameBlob(file: Blob, animation: Extract<IndexedAnimation, { format: 'apng' }>, frame: PngFrame): Promise<Blob> {
  const ihdr = animation.ihdr.slice();
  ihdr.set(be32(frame.width), 0);
  ihdr.set(be32(frame.height), 4);
  const parts: BlobPart[] = [blobBytes(pngSignature), blobBytes(pngChunk('IHDR', ihdr))];
  for (const chunk of animation.globalChunks) {
    parts.push(file.slice(chunk.offset, chunk.offset + chunk.length));
  }
  for (const span of frame.data) {
    if (span.type === 'IDAT') {
      parts.push(file.slice(span.offset - 8, span.offset + span.length + 4));
    } else {
      // fdAT 的序号不属于 IDAT；逐块计算 CRC，避免复制整个压缩帧。
      let crc = crcUpdate(0xffffffff, encoder.encode('IDAT'));
      for (let offset = span.offset; offset < span.offset + span.length; offset += 65536) {
        const bytes = new Uint8Array(await file.slice(offset, Math.min(span.offset + span.length, offset + 65536)).arrayBuffer());
        crc = crcUpdate(crc, bytes);
      }
      parts.push(blobBytes(be32(span.length)), blobBytes(encoder.encode('IDAT')), file.slice(span.offset, span.offset + span.length), blobBytes(be32((crc ^ 0xffffffff) >>> 0)));
    }
  }
  parts.push(blobBytes(pngChunk('IEND', new Uint8Array(0))));
  return new Blob(parts, { type: 'image/png' });
}

export function makeWebpFrameBlob(file: Blob, frame: WebpFrame): Blob {
  const vp8x = new Uint8Array(18);
  vp8x.set(encoder.encode('VP8X'), 0);
  vp8x.set(le32(10), 4);
  vp8x[8] = frame.hasAlpha ? 0x10 : 0;
  const width = frame.width - 1;
  const height = frame.height - 1;
  vp8x.set([width & 255, width >>> 8 & 255, width >>> 16 & 255], 12);
  vp8x.set([height & 255, height >>> 8 & 255, height >>> 16 & 255], 15);
  const padding = frame.data.length & 1 ? Uint8Array.of(0) : new Uint8Array(0);
  const size = 4 + vp8x.length + frame.data.length + padding.length;
  return new Blob([
    blobBytes(encoder.encode('RIFF')), blobBytes(le32(size)), blobBytes(encoder.encode('WEBP')), blobBytes(vp8x),
    file.slice(frame.data.offset, frame.data.offset + frame.data.length), blobBytes(padding)
  ], { type: 'image/webp' });
}

let webpDecoder: Promise<ReturnType<typeof import('webpxmux/dist/webpxmux').default>> | null = null;

async function decodeWebpFallback(blob: Blob, width: number, height: number, resizeWidth: number, resizeHeight: number): Promise<ImageBitmap> {
  if (!webpDecoder) {
    // 旧 Emscripten 构建在 Worker 中读取 document.currentScript。
    Object.defineProperty(self, 'document', { value: { currentScript: null, title: '' }, configurable: true });
    webpDecoder = import('webpxmux/dist/webpxmux').then(async({ default: WebPXMux }) => {
      const mux = WebPXMux(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/webpxmux.wasm`);
      await mux.waitRuntime();
      return mux;
    });
  }
  const decoded = await (await webpDecoder).decodeWebP(new Uint8Array(await blob.arrayBuffer()));
  if (decoded.width !== width || decoded.height !== height) { throw new Error('animation-decode-failed'); }
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < decoded.rgba.length; index += 1) {
    const color = decoded.rgba[index];
    const byte = index * 4;
    pixels[byte] = color >>> 24 & 255;
    pixels[byte + 1] = color >>> 16 & 255;
    pixels[byte + 2] = color >>> 8 & 255;
    pixels[byte + 3] = color & 255;
  }
  return createImageBitmap(new ImageData(new Uint8ClampedArray(pixels), width, height), { resizeWidth, resizeHeight, resizeQuality: 'high' });
}

export async function decodePatch(file: Blob, animation: IndexedAnimation, index: number): Promise<ImageBitmap> {
  const frame = animation.frames[index];
  const resizeWidth = Math.max(1, Math.round(frame.width * animation.metadata.renderWidth / animation.metadata.width));
  const resizeHeight = Math.max(1, Math.round(frame.height * animation.metadata.renderHeight / animation.metadata.height));
  if (animation.format === 'gif') {
    const { parseGIF, decompressFrames } = await import('gifuct-js');
    const parsed = parseGIF(await makeGifFrameBuffer(file, animation, animation.frames[index]));
    const patch = decompressFrames(parsed, true)[0]?.patch;
    if (!patch || patch.length !== frame.width * frame.height * 4) { throw new Error('animation-decode-failed'); }
    return createImageBitmap(new ImageData(new Uint8ClampedArray(patch), frame.width, frame.height), { resizeWidth, resizeHeight, resizeQuality: 'high' });
  }
  if (animation.format === 'apng') {
    return createImageBitmap(await makePngFrameBlob(file, animation, animation.frames[index]), { resizeWidth, resizeHeight, resizeQuality: 'high' });
  }
  const blob = makeWebpFrameBlob(file, animation.frames[index]);
  try {
    return await createImageBitmap(blob, { resizeWidth, resizeHeight, resizeQuality: 'high' });
  } catch {
    return decodeWebpFallback(blob, frame.width, frame.height, resizeWidth, resizeHeight);
  }
}
