/**
 * Сетевой протокол TinyDB Wire Protocol
 * Реализует фреймирование сообщений по длине (Length-prefixed framing):
 * [ 4 байта: uint32BE длина тела ][ N байт: полезная нагрузка UTF-8 JSON ]
 */

export class Protocol {
  /**
   * Упаковка объекта в бинарный пакет с заголовком длины
   */
  static encode(obj) {
    const jsonStr = JSON.stringify(obj);
    const bodyBuf = Buffer.from(jsonStr, 'utf8');
    const headerBuf = Buffer.alloc(4);
    headerBuf.writeUInt32BE(bodyBuf.length, 0);

    return Buffer.concat([headerBuf, bodyBuf]);
  }

  /**
   * Потоковый декодер сообщений из входящего TCP буфера
   */
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.buffer = Buffer.alloc(0);
  }

  feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 4) {
      const msgLength = this.buffer.readUInt32BE(0);

      // Проверяем: пришел ли пакет целиком?
      if (this.buffer.length >= 4 + msgLength) {
        const bodyBuf = this.buffer.subarray(4, 4 + msgLength);
        this.buffer = this.buffer.subarray(4 + msgLength);

        try {
          const parsed = JSON.parse(bodyBuf.toString('utf8'));
          this.onMessage(parsed);
        } catch (err) {
          console.error('[Protocol] Ошибка парсинга пакета JSON:', err);
        }
      } else {
        // Ждем прибытия оставшихся байтов из сокета
        break;
      }
    }
  }
}
