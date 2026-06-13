import zlib from "node:zlib";

// CRC32 (used by PNG chunks)
const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** Generate a filled black circle PNG (RGBA) of the given size, anti-aliased. */
export function makePng(size = 22): Buffer {
  const stride = size * 4 + 1; // 1 filter byte + RGBA pixels per row
  const raw = Buffer.alloc(stride * size);
  const center = (size - 1) / 2;
  const radius = size / 2 - 1;
  for (let y = 0; y < size; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x - center, y - center);
      let alpha = 0;
      if (dist <= radius) alpha = 255;
      else if (dist <= radius + 1) alpha = Math.round(255 * (radius + 1 - dist));
      const off = rowStart + 1 + x * 4;
      raw[off] = 0; // R
      raw[off + 1] = 0; // G
      raw[off + 2] = 0; // B
      raw[off + 3] = alpha;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Wrap a PNG in a minimal ICO container (Windows Vista+ supports PNG payloads). */
export function makeIco(png: Buffer, size = 22): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count

  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size; // width
  entry[1] = size >= 256 ? 0 : size; // height
  entry[2] = 0; // colors
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bit count
  entry.writeUInt32LE(png.length, 8); // bytes in resource
  entry.writeUInt32LE(22, 12); // offset (6 + 16)

  return Buffer.concat([header, entry, png]);
}

/** Platform-appropriate tray icon as a base64 string, plus whether it's a macOS template. */
export function trayIcon(): { base64: string; isTemplate: boolean } {
  const png = makePng(22);
  if (process.platform === "win32") {
    return { base64: makeIco(png).toString("base64"), isTemplate: false };
  }
  return {
    base64: png.toString("base64"),
    isTemplate: process.platform === "darwin",
  };
}
