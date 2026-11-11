import fs from 'node:fs/promises';
import path from 'node:path';

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c >>> 0;
}

export function calcCRC32(input) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

export class WAL {
  constructor(filePath) {
    this.filePath = filePath;
    this.fileHandle = null;
  }

  async open() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    this.fileHandle = await fs.open(this.filePath, 'a+');
  }

  async log(op, id, data = null) {
    if (!this.fileHandle) await this.open();
    const payload = JSON.stringify({ timestamp: Date.now(), op, id, data });
    const crc = calcCRC32(payload).toString(16);
    const entry = `${crc}:${payload}\n`;
    await this.fileHandle.write(entry);
    await this.fileHandle.sync();
  }

  async recover() {
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim().length > 0);
      const validEntries = [];

      for (const line of lines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const crc = line.slice(0, colonIdx);
        const payloadStr = line.slice(colonIdx + 1);
        if (calcCRC32(payloadStr).toString(16) === crc) {
          validEntries.push(JSON.parse(payloadStr));
        }
      }
      return validEntries;
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async truncate() {
    if (this.fileHandle) {
      await this.fileHandle.close();
      this.fileHandle = null;
    }
    await fs.writeFile(this.filePath, '');
    await this.open();
  }

  async close() {
    if (this.fileHandle) {
      await this.fileHandle.close();
      this.fileHandle = null;
    }
  }
}
