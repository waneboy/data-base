import net from 'node:net';
import { Protocol } from './protocol.js';

/**
 * TinyClient - клиентский SDK для подключения к серверу нашей СУБД по TCP
 */
export class TinyClient {
  constructor(options = {}) {
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 8765;
    this.socket = null;
    this.protocol = null;
    this.pendingRequests = [];
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.connect({ host: this.host, port: this.port }, () => {
        resolve();
      });

      this.protocol = new Protocol((response) => {
        const pending = this.pendingRequests.shift();
        if (pending) {
          if (response.status === 'OK') {
            pending.resolve(response.data);
          } else {
            pending.reject(new Error(response.error || 'Неизвестная ошибка сервера'));
          }
        }
      });

      this.socket.on('data', (chunk) => {
        this.protocol.feed(chunk);
      });

      this.socket.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Отправка SQL-запроса на сервер
   * @param {string} sql 
   * @returns {Promise<any>}
   */
  async query(sql) {
    if (!this.socket) {
      throw new Error('Клиент не подключен к серверу базы данных. Сначала вызовите client.connect()');
    }

    return new Promise((resolve, reject) => {
      this.pendingRequests.push({ resolve, reject });
      const packet = Protocol.encode({ query: sql });
      this.socket.write(packet);
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
  }
}
