import fs from 'node:fs/promises';
import path from 'node:path';

// Предвычисленная таблица для канонического алгоритма CRC32 (IEEE 802.3)
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c >>> 0;
}

/**
 * Подсчет контрольной суммы CRC32 (IEEE 802.3)
 * @param {Buffer|string} input 
 * @returns {number} 32-битное беззнаковое целое число
 */
export function calcCRC32(input) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Класс Write-Ahead Log (WAL)
 * Реализует журнал предзаписи для гарантии надежности (Durability в ACID).
 * Все мутации сначала пишутся в этот последовательный журнал с принудительным fsync,
 * и лишь затем применяются к основной таблице.
 */
export class WAL {
  constructor(filePath) {
    this.filePath = filePath;
    this.fileHandle = null;
  }

  async open() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    this.fileHandle = await fs.open(this.filePath, 'a+');
  }

  /**
   * Запись операции в журнал предзаписи
   * @param {string} op - Тип операции ('INSERT', 'UPDATE', 'DELETE')
   * @param {number|string} id - Идентификатор записи
   * @param {object|null} data - Полезная нагрузка
   */
  async log(op, id, data = null) {
    if (!this.fileHandle) {
      await this.open();
    }

    const payload = JSON.stringify({
      timestamp: Date.now(),
      op,
      id,
      data
    });

    const crc = calcCRC32(payload).toString(16);
    const entry = `${crc}:${payload}\n`;

    // Пишем в конец журнала
    await this.fileHandle.write(entry);
    // Принудительно заставляем ОС сбросить буфер на физический накопитель
    await this.fileHandle.sync();
  }

  /**
   * Восстановление состояния при старте / аварийном сбое:
   * Вычитывает все валидные записи из журнала.
   */
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

        // Проверяем контрольную сумму: если запись оборвалась при внезапном выключении,
        // CRC не совпадет, и битый хвост будет проигнорирован
        if (calcCRC32(payloadStr).toString(16) === crc) {
          validEntries.push(JSON.parse(payloadStr));
        } else {
          console.warn(`[WAL Recovery] Обнаружена поврежденная запись, пропуск: ${line}`);
        }
      }

      return validEntries;
    } catch (err) {
      if (err.code === 'ENOENT') {
        return []; // Файла журнала еще нет
      }
      throw err;
    }
  }

  /**
   * Очистка журнала после успешного сброса / компактификации
   */
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
