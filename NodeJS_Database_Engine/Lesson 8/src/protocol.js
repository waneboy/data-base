export class Protocol {
  static encode(obj) {
    const jsonStr = JSON.stringify(obj);
    const bodyBuf = Buffer.from(jsonStr, 'utf8');
    const headerBuf = Buffer.alloc(4);
    headerBuf.writeUInt32BE(bodyBuf.length, 0);
    return Buffer.concat([headerBuf, bodyBuf]);
  }

  constructor(onMessage) {
    this.onMessage = onMessage;
    this.buffer = Buffer.alloc(0);
  }

  feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const msgLength = this.buffer.readUInt32BE(0);
      if (this.buffer.length >= 4 + msgLength) {
        const bodyBuf = this.buffer.subarray(4, 4 + msgLength);
        this.buffer = this.buffer.subarray(4 + msgLength);
        try {
          this.onMessage(JSON.parse(bodyBuf.toString('utf8')));
        } catch (err) {
          console.error('[Protocol] Ошибка парсинга пакета JSON:', err);
        }
      } else {
        break;
      }
    }
  }
}
