import { deflateSync } from 'node:zlib';

function uint32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function chunk(type: string, payload: Buffer): Buffer {
  const data = Buffer.concat([Buffer.from(type), payload]);
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return Buffer.concat([uint32(payload.length), data, uint32((crc ^ 0xffffffff) >>> 0)]);
}

interface AnimationOptions {
  corruptLastFrame?: boolean;
  translucentFirstFrame?: boolean;
}

export function transparentAnimation({ corruptLastFrame = false, translucentFirstFrame = false }: AnimationOptions = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const frames = [
    // 首帧覆盖全画布，下一帧前必须清为透明背景。
    {
      left: 0, width: 2,
      pixels: translucentFirstFrame ? [0, 255, 0, 128, 0, 255, 0, 128] : [255, 0, 0, 255, 255, 0, 0, 255],
      dispose: 1, blend: 0
    },
    { left: 1, width: 1, pixels: [0, 0, 255, 255], dispose: 0, blend: 1 },
    // SOURCE 半透明帧不能与显示画布上的旧帧再次叠加。
    { left: 0, width: 2, pixels: [0, 255, 0, 128, 0, 255, 0, 128], dispose: 0, blend: 0 }
  ];
  const chunks = [
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('acTL', Buffer.concat([uint32(frames.length), uint32(0)]))
  ];
  let sequence = 0;
  frames.forEach((frame, index) => {
    const control = Buffer.alloc(26);
    control.writeUInt32BE(sequence++, 0);
    control.writeUInt32BE(frame.width, 4);
    control.writeUInt32BE(1, 8);
    control.writeUInt32BE(frame.left, 12);
    control.writeUInt16BE(1000, 20);
    control.writeUInt16BE(1000, 22);
    control[24] = frame.dispose;
    control[25] = frame.blend;
    chunks.push(chunk('fcTL', control));
    const pixels = corruptLastFrame && index === frames.length - 1
      ? Buffer.from([0xff])
      : deflateSync(Buffer.from([0, ...frame.pixels]));
    chunks.push(index === 0
      ? chunk('IDAT', pixels)
      : chunk('fdAT', Buffer.concat([uint32(sequence++), pixels])));
  });
  chunks.push(chunk('IEND', Buffer.alloc(0)));
  return { name: 'transparent.apng', mimeType: 'image/apng', buffer: Buffer.concat(chunks) };
}
