import fs from 'node:fs/promises';
import path from 'node:path';
import { WAL, calcCRC32 } from './wal.js';

const HEADER_SIZE = 16;
const MAGIC_NUMBER = 0xD801;
const TYPE_RECORD = 1;
const TYPE_TOMBSTONE = 2;

export class StorageEngine {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.walPath = dbPath.replace(/\.db$/, '.wal');
    this.wal = new WAL(this.walPath);
    this.fileHandle = null;
    this.keydir = new Map(); // id -> { offset, length }
    this.currentFileSize = 0;
  }

  async init() {
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
    await this.wal.open();
    this.fileHandle = await fs.open(this.dbPath, 'a+');
    const stat = await this.fileHandle.stat();
    this.currentFileSize = stat.size;
    await this.buildIndexFromDisk();
  }

  async buildIndexFromDisk() {
    this.keydir.clear();
    let offset = 0;
    const headerBuf = Buffer.alloc(HEADER_SIZE);

    while (offset + HEADER_SIZE <= this.currentFileSize) {
      const { bytesRead } = await this.fileHandle.read(headerBuf, 0, HEADER_SIZE, offset);
      if (bytesRead < HEADER_SIZE) break;

      const magic = headerBuf.readUInt16BE(0);
      if (magic !== MAGIC_NUMBER) break;

      const type = headerBuf.readUInt16BE(2);
      const id = headerBuf.readUInt32BE(4);
      const dataLen = headerBuf.readUInt32BE(8);
      const checksum = headerBuf.readUInt32BE(12);

      const totalRecordSize = HEADER_SIZE + dataLen;
      if (offset + totalRecordSize > this.currentFileSize) break;

      if (dataLen > 0) {
        const dataBuf = Buffer.alloc(dataLen);
        await this.fileHandle.read(dataBuf, 0, dataLen, offset + HEADER_SIZE);
        if (calcCRC32(dataBuf) !== checksum) {
          offset += totalRecordSize;
          continue;
        }
      }

      if (type === TYPE_RECORD) {
        this.keydir.set(id, { offset, length: totalRecordSize });
      } else if (type === TYPE_TOMBSTONE) {
        this.keydir.delete(id);
      }

      offset += totalRecordSize;
    }
  }

  encodeRecord(type, id, dataObject) {
    const dataBuf = dataObject ? Buffer.from(JSON.stringify(dataObject), 'utf8') : Buffer.alloc(0);
    const dataLen = dataBuf.length;
    const checksum = dataLen > 0 ? calcCRC32(dataBuf) : 0;

    const recordBuf = Buffer.alloc(HEADER_SIZE + dataLen);
    recordBuf.writeUInt16BE(MAGIC_NUMBER, 0);
    recordBuf.writeUInt16BE(type, 2);
    recordBuf.writeUInt32BE(id, 4);
    recordBuf.writeUInt32BE(dataLen, 8);
    recordBuf.writeUInt32BE(checksum, 12);

    if (dataLen > 0) {
      dataBuf.copy(recordBuf, HEADER_SIZE);
    }
    return recordBuf;
  }

  async decodeRecordAt(offset) {
    const headerBuf = Buffer.alloc(HEADER_SIZE);
    await this.fileHandle.read(headerBuf, 0, HEADER_SIZE, offset);

    const magic = headerBuf.readUInt16BE(0);
    if (magic !== MAGIC_NUMBER) {
      throw new Error(`Поврежденная запись: неверный Magic Number на смещении ${offset}`);
    }

    const type = headerBuf.readUInt16BE(2);
    const id = headerBuf.readUInt32BE(4);
    const dataLen = headerBuf.readUInt32BE(8);
    const checksum = headerBuf.readUInt32BE(12);

    if (type === TYPE_TOMBSTONE) return null;

    const dataBuf = Buffer.alloc(dataLen);
    await this.fileHandle.read(dataBuf, 0, dataLen, offset + HEADER_SIZE);

    if (calcCRC32(dataBuf) !== checksum) {
      throw new Error(`Ошибка контрольной суммы CRC32 для записи ID=${id}`);
    }

    return JSON.parse(dataBuf.toString('utf8'));
  }

  async insert(id, data) {
    if (this.keydir.has(id)) {
      throw new Error(`Duplicate entry: запись с ID=${id} уже существует.`);
    }

    await this.wal.log('INSERT', id, data);
    const recordBuf = this.encodeRecord(TYPE_RECORD, id, data);
    const offset = this.currentFileSize;

    await this.fileHandle.write(recordBuf, 0, recordBuf.length, offset);
    await this.fileHandle.sync();

    this.keydir.set(id, { offset, length: recordBuf.length });
    this.currentFileSize += recordBuf.length;
    return { id, ...data };
  }

  async update(id, data) {
    if (!this.keydir.has(id)) {
      throw new Error(`RecordNotFound: запись с ID=${id} не найдена.`);
    }

    await this.wal.log('UPDATE', id, data);
    const recordBuf = this.encodeRecord(TYPE_RECORD, id, data);
    const offset = this.currentFileSize;

    await this.fileHandle.write(recordBuf, 0, recordBuf.length, offset);
    await this.fileHandle.sync();

    this.keydir.set(id, { offset, length: recordBuf.length });
    this.currentFileSize += recordBuf.length;
    return { id, ...data };
  }

  async delete(id) {
    if (!this.keydir.has(id)) return false;

    await this.wal.log('DELETE', id, null);
    const tombstoneBuf = this.encodeRecord(TYPE_TOMBSTONE, id, null);
    const offset = this.currentFileSize;

    await this.fileHandle.write(tombstoneBuf, 0, tombstoneBuf.length, offset);
    await this.fileHandle.sync();

    this.keydir.delete(id);
    this.currentFileSize += tombstoneBuf.length;
    return true;
  }

  async get(id) {
    const entry = this.keydir.get(id);
    if (!entry) return null;
    return await this.decodeRecordAt(entry.offset);
  }

  async scan(predicate = null) {
    const results = [];
    for (const [id, entry] of this.keydir.entries()) {
      const record = await this.decodeRecordAt(entry.offset);
      if (!predicate || predicate(record)) {
        results.push(record);
      }
    }
    return results;
  }

  async compact() {
    const tempDbPath = `${this.dbPath}.compact`;
    const tempHandle = await fs.open(tempDbPath, 'w+');

    let newOffset = 0;
    const newKeydir = new Map();

    for (const [id, entry] of this.keydir.entries()) {
      const record = await this.decodeRecordAt(entry.offset);
      const recordBuf = this.encodeRecord(TYPE_RECORD, id, record);

      await tempHandle.write(recordBuf, 0, recordBuf.length, newOffset);
      newKeydir.set(id, { offset: newOffset, length: recordBuf.length });
      newOffset += recordBuf.length;
    }

    await tempHandle.sync();
    await tempHandle.close();
    await this.fileHandle.close();

    await fs.rename(tempDbPath, this.dbPath);

    this.fileHandle = await fs.open(this.dbPath, 'a+');
    this.currentFileSize = newOffset;
    this.keydir = newKeydir;
    await this.wal.truncate();
  }

  async close() {
    if (this.fileHandle) {
      await this.fileHandle.sync();
      await this.fileHandle.close();
      this.fileHandle = null;
    }
    await this.wal.close();
  }
}
