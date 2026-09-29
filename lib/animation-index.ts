import { normalizeFrameDuration, renderSize, type AnimationMetadata } from '@/lib/animation';

export interface FrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
  durationMs: number;
  blend: 'source' | 'over';
  dispose: 'none' | 'background' | 'previous';
}

export interface ByteSpan {
  offset: number;
  length: number;
}

export interface GifFrame extends FrameRect {
  image: ByteSpan;
  gce: Uint8Array;
}

export interface PngFrame extends FrameRect {
  data: (ByteSpan & { type: 'IDAT' | 'fdAT' })[];
}

export interface WebpFrame extends FrameRect {
  data: ByteSpan;
  hasAlpha: boolean;
}

export type IndexedAnimation =
  | { format: 'gif'; metadata: AnimationMetadata; frames: GifFrame[]; header: Uint8Array; background: readonly [number, number, number, number] }
  | { format: 'apng'; metadata: AnimationMetadata; frames: PngFrame[]; ihdr: Uint8Array; globalChunks: ByteSpan[]; background: readonly [number, number, number, number] }
  | { format: 'webp'; metadata: AnimationMetadata; frames: WebpFrame[]; background: readonly [number, number, number, number] };

const ascii = (bytes: Uint8Array, offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
const le16 = (bytes: Uint8Array, offset: number) => bytes[offset] | (bytes[offset + 1] << 8);
const le24 = (bytes: Uint8Array, offset: number) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
const le32 = (bytes: Uint8Array, offset: number) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
const be16 = (bytes: Uint8Array, offset: number) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, false);
const be32 = (bytes: Uint8Array, offset: number) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);

export class ChunkReader {
  private start = -1;
  private cache = new Uint8Array(0);

  constructor(private readonly file: Blob) {}

  get size(): number { return this.file.size; }

  async read(offset: number, length: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > this.file.size) {
      throw new Error('animation-decode-failed');
    }
    if (offset >= this.start && offset + length <= this.start + this.cache.length) {
      return this.cache.subarray(offset - this.start, offset - this.start + length);
    }
    // 索引阶段只读取有限窗口；帧内容另用 Blob.slice 按需提取。
    this.start = offset;
    this.cache = new Uint8Array(await this.file.slice(offset, Math.min(this.file.size, offset + Math.max(65536, length))).arrayBuffer());
    return this.cache.subarray(0, length);
  }
}

function metadata(format: AnimationMetadata['format'], width: number, height: number, frames: readonly FrameRect[], loopCount: number): AnimationMetadata {
  const render = renderSize(width, height);
  const durations = frames.map((frame) => frame.durationMs);
  return { format, width, height, renderWidth: render.width, renderHeight: render.height, frameCount: frames.length, loopCount, durations, duration: durations.reduce((sum, value) => sum + value, 0) / 1000 };
}

async function skipSubBlocks(reader: ChunkReader, start: number): Promise<number> {
  let offset = start;
  while (offset < reader.size) {
    const length = (await reader.read(offset, 1))[0];
    offset += 1 + length;
    if (offset > reader.size) { break; }
    if (length === 0) { return offset; }
  }
  throw new Error('animation-decode-failed');
}

async function indexGif(reader: ChunkReader): Promise<IndexedAnimation | null> {
  const header = await reader.read(0, 13);
  if (ascii(header, 0, 6) !== 'GIF87a' && ascii(header, 0, 6) !== 'GIF89a') { return null; }
  const width = le16(header, 6);
  const height = le16(header, 8);
  const colorTableSize = header[10] & 0x80 ? 3 * (1 << ((header[10] & 7) + 1)) : 0;
  const headerEnd = 13 + colorTableSize;
  const prefix = (await reader.read(0, headerEnd)).slice();
  const frames: GifFrame[] = [];
  let offset = headerEnd;
  let gce = Uint8Array.of(0x21, 0xf9, 4, 0, 1, 0, 0, 0);
  let rawLoop: number | null = null;
  let transparentBackground = false;

  while (offset < reader.size) {
    const marker = (await reader.read(offset, 1))[0];
    if (marker === 0x3b) { break; }
    if (marker === 0x21) {
      const label = (await reader.read(offset + 1, 1))[0];
      if (label === 0xf9) {
        const control = await reader.read(offset, 8);
        if (control[2] !== 4 || control[7] !== 0) { throw new Error('animation-decode-failed'); }
        gce = control.slice();
        offset += 8;
      } else if (label === 0xff) {
        const appSize = (await reader.read(offset + 2, 1))[0];
        const app = ascii(await reader.read(offset + 3, appSize), 0, appSize);
        const first = offset + 3 + appSize;
        const blockSize = (await reader.read(first, 1))[0];
        if ((app === 'NETSCAPE2.0' || app === 'ANIMEXTS1.0') && blockSize >= 3) {
          const block = await reader.read(first + 1, blockSize);
          if (block[0] === 1) { rawLoop = le16(block, 1); }
        }
        offset = await skipSubBlocks(reader, first);
      } else {
        offset = await skipSubBlocks(reader, offset + 2);
      }
      continue;
    }
    if (marker !== 0x2c) { throw new Error('animation-decode-failed'); }
    const descriptor = await reader.read(offset, 10);
    const left = le16(descriptor, 1);
    const top = le16(descriptor, 3);
    const frameWidth = le16(descriptor, 5);
    const frameHeight = le16(descriptor, 7);
    if (!frameWidth || !frameHeight || left + frameWidth > width || top + frameHeight > height) { throw new Error('animation-decode-failed'); }
    const localTable = descriptor[9] & 0x80 ? 3 * (1 << ((descriptor[9] & 7) + 1)) : 0;
    const end = await skipSubBlocks(reader, offset + 10 + localTable + 1);
    const packed = gce[3];
    const transparentIndex = packed & 1 ? gce[6] : -1;
    transparentBackground ||= transparentIndex === header[11];
    frames.push({
      left, top, width: frameWidth, height: frameHeight,
      durationMs: normalizeFrameDuration(le16(gce, 4) * 10),
      blend: 'over', dispose: (packed >> 2 & 7) === 2 ? 'background' : (packed >> 2 & 7) === 3 ? 'previous' : 'none',
      image: { offset, length: end - offset }, gce
    });
    gce = Uint8Array.of(0x21, 0xf9, 4, 0, 1, 0, 0, 0);
    offset = end;
  }
  if (frames.length < 2) { return null; }
  const color = prefix.subarray(13 + header[11] * 3, 16 + header[11] * 3);
  const background: readonly [number, number, number, number] = colorTableSize && color.length === 3 && !transparentBackground
    ? [color[0], color[1], color[2], 255] : [0, 0, 0, 0];
  return { format: 'gif', metadata: metadata('gif', width, height, frames, rawLoop === 0 ? 0 : (rawLoop ?? 0) + 1), frames, header: prefix, background };
}

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

async function indexPng(reader: ChunkReader): Promise<IndexedAnimation | null> {
  const signature = await reader.read(0, 8);
  if (!PNG_SIGNATURE.every((value, index) => signature[index] === value)) { return null; }
  const first = await reader.read(8, 25);
  if (ascii(first, 4, 4) !== 'IHDR' || be32(first, 0) !== 13) { throw new Error('animation-decode-failed'); }
  const width = be32(first, 8);
  const height = be32(first, 12);
  const ihdr = first.subarray(8, 21).slice();
  const frames: PngFrame[] = [];
  const globalChunks: ByteSpan[] = [];
  let declared = 0;
  let loopCount = 1;
  let seenImageData = false;
  let offset = 8;
  while (offset + 12 <= reader.size) {
    const chunk = await reader.read(offset, 8);
    const length = be32(chunk, 0);
    const type = ascii(chunk, 4, 4);
    const end = offset + 12 + length;
    if (end > reader.size) { throw new Error('animation-decode-failed'); }
    if (type === 'acTL' && length === 8) {
      const data = await reader.read(offset + 8, 8);
      declared = be32(data, 0);
      loopCount = be32(data, 4);
    } else if (type === 'fcTL' && length === 26) {
      const data = await reader.read(offset + 8, 26);
      const frameWidth = be32(data, 4);
      const frameHeight = be32(data, 8);
      const left = be32(data, 12);
      const top = be32(data, 16);
      if (!frameWidth || !frameHeight || left + frameWidth > width || top + frameHeight > height) { throw new Error('animation-decode-failed'); }
      const delay = 1000 * be16(data, 20) / (be16(data, 22) || 100);
      frames.push({
        left, top, width: frameWidth, height: frameHeight, durationMs: normalizeFrameDuration(delay),
        dispose: data[24] === 1 ? 'background' : data[24] === 2 ? 'previous' : 'none',
        blend: data[25] === 0 ? 'source' : 'over', data: []
      });
    } else if (type === 'IDAT' || type === 'fdAT') {
      seenImageData = true;
      if (frames.length) {
        if (type === 'fdAT' && length < 4) { throw new Error('animation-decode-failed'); }
        frames[frames.length - 1].data.push({
          type, offset: offset + 8 + (type === 'fdAT' ? 4 : 0), length: length - (type === 'fdAT' ? 4 : 0)
        });
      }
    } else if (!seenImageData && ['PLTE', 'tRNS', 'cHRM', 'gAMA', 'iCCP', 'sRGB', 'sBIT', 'cICP'].includes(type)) {
      globalChunks.push({ offset, length: length + 12 });
    }
    offset = end;
    if (type === 'IEND') { break; }
  }
  if (declared < 2 || frames.length < 2) { return null; }
  if (declared !== frames.length || frames.some((frame) => frame.data.length === 0)) { throw new Error('animation-decode-failed'); }
  return { format: 'apng', metadata: metadata('apng', width, height, frames, loopCount), frames, ihdr, globalChunks, background: [0, 0, 0, 0] };
}

async function indexWebp(reader: ChunkReader): Promise<IndexedAnimation | null> {
  const riff = await reader.read(0, 12);
  if (ascii(riff, 0, 4) !== 'RIFF' || ascii(riff, 8, 4) !== 'WEBP') { return null; }
  const limit = Math.min(reader.size, le32(riff, 4) + 8);
  const frames: WebpFrame[] = [];
  let width = 0;
  let height = 0;
  let loopCount = 1;
  let background: readonly [number, number, number, number] = [0, 0, 0, 0];
  let offset = 12;
  while (offset + 8 <= limit) {
    const header = await reader.read(offset, 8);
    const type = ascii(header, 0, 4);
    const length = le32(header, 4);
    const end = offset + 8 + length;
    if (end > limit) { throw new Error('animation-decode-failed'); }
    if (type === 'VP8X' && length >= 10) {
      const data = await reader.read(offset + 8, 10);
      width = le24(data, 4) + 1;
      height = le24(data, 7) + 1;
    } else if (type === 'ANIM' && length >= 6) {
      const data = await reader.read(offset + 8, 6);
      background = [data[2], data[1], data[0], data[3]];
      loopCount = le16(data, 4);
    } else if (type === 'ANMF' && length >= 16) {
      const data = await reader.read(offset + 8, 16);
      const left = le24(data, 0) * 2;
      const top = le24(data, 3) * 2;
      const frameWidth = le24(data, 6) + 1;
      const frameHeight = le24(data, 9) + 1;
      if (!frameWidth || !frameHeight || left + frameWidth > width || top + frameHeight > height) { throw new Error('animation-decode-failed'); }
      const firstSubchunk = length >= 24 ? await reader.read(offset + 24, 4) : new Uint8Array(0);
      frames.push({
        left, top, width: frameWidth, height: frameHeight,
        durationMs: normalizeFrameDuration(le24(data, 12)),
        blend: data[15] & 2 ? 'source' : 'over',
        dispose: data[15] & 1 ? 'background' : 'none',
        data: { offset: offset + 24, length: length - 16 },
        hasAlpha: ascii(firstSubchunk, 0, 4) === 'ALPH' || ascii(firstSubchunk, 0, 4) === 'VP8L'
      });
    }
    offset = end + (length & 1);
  }
  if (frames.length < 2) { return null; }
  return { format: 'webp', metadata: metadata('webp', width, height, frames, loopCount), frames, background };
}

export async function indexAnimation(file: Blob): Promise<IndexedAnimation | null> {
  if (file.size < 12) { return null; }
  const reader = new ChunkReader(file);
  const signature = await reader.read(0, 12);
  if (ascii(signature, 0, 3) === 'GIF') { return indexGif(reader); }
  if (PNG_SIGNATURE.every((value, index) => signature[index] === value)) { return indexPng(reader); }
  if (ascii(signature, 0, 4) === 'RIFF' && ascii(signature, 8, 4) === 'WEBP') { return indexWebp(reader); }
  return null;
}
