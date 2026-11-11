import net from 'node:net';
import path from 'node:path';
import { Protocol } from './protocol.js';
import { Parser } from '../Lesson 6/parser.js';
import { ExecutionEngine } from '../Lesson 6/executor.js';

export class TinyServer {
  constructor(port = 8765, dataDir = './db_storage') {
    this.port = port;
    this.dataDir = path.resolve(dataDir);
    this.engine = new ExecutionEngine(this.dataDir);
    this.server = null;
    this.connections = new Set();
  }

  async start() {
    await this.engine.init();

    this.server = net.createServer((socket) => {
      this.handleConnection(socket);
    });

    return new Promise((resolve, reject) => {
      this.server.listen(this.port, () => {
        console.log(`[TinyDB Server] Сервер базы данных успешно запущен на порту ${this.port}`);
        console.log(`[TinyDB Server] Хранилище данных: ${this.dataDir}`);
        resolve();
      });

      this.server.on('error', (err) => {
        reject(err);
      });
    });
  }

  handleConnection(socket) {
    const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
    this.connections.add(socket);
    // console.log(`[+] Новое подключение клиента: ${clientId}`);

    // Сессионный контекст для поддержки транзакций (ACID)
    const session = {
      clientId,
      inTransaction: false,
      undoLog: [] // Список обратных операций для отката (ROLLBACK)
    };

    const protocol = new Protocol(async (message) => {
      const startTime = performance.now();
      try {
        const sql = message.query;
        if (!sql) throw new Error('Запрос не содержит поля "query"');

        const result = await this.executeSessionQuery(session, sql);
        const execTime = (performance.now() - startTime).toFixed(2);

        socket.write(Protocol.encode({
          status: 'OK',
          data: result,
          executionTimeMs: `${execTime}ms`
        }));
      } catch (err) {
        const execTime = (performance.now() - startTime).toFixed(2);
        socket.write(Protocol.encode({
          status: 'ERROR',
          error: err.message,
          executionTimeMs: `${execTime}ms`
        }));
      }
    });

    socket.on('data', (chunk) => {
      protocol.feed(chunk);
    });

    socket.on('close', async () => {
      // console.log(`[-] Клиент отключился: ${clientId}`);
      this.connections.delete(socket);

      // Если соединение оборвалось посреди транзакции — автоматически откатываем!
      if (session.inTransaction) {
        console.warn(`[TinyDB Transaction] Аварийный обрыв клиента ${clientId}. Выполняется автоматический ROLLBACK...`);
        await this.rollbackTransaction(session);
      }
    });

    socket.on('error', (err) => {
      console.error(`[TinyDB Socket Error] ${clientId}:`, err.message);
    });
  }

  async executeSessionQuery(session, sql) {
    const ast = Parser.parse(sql);

    // Управление транзакциями
    if (ast.type === 'BEGIN') {
      if (session.inTransaction) {
        throw new Error('Транзакция уже начата в этой сессии.');
      }
      session.inTransaction = true;
      session.undoLog = [];
      return { message: 'BEGIN TRANSACTION: транзакция открыта.' };
    }

    if (ast.type === 'COMMIT') {
      if (!session.inTransaction) {
        throw new Error('Нет активной транзакции для фиксации (COMMIT).');
      }
      session.inTransaction = false;
      const count = session.undoLog.length;
      session.undoLog = [];
      return { message: `COMMIT: транзакция успешно зафиксирована (мутаций: ${count}).` };
    }

    if (ast.type === 'ROLLBACK') {
      if (!session.inTransaction) {
        throw new Error('Нет активной транзакции для отката (ROLLBACK).');
      }
      return await this.rollbackTransaction(session);
    }

    // Если транзакция активна, перехватываем мутации для формирования Undo Log
    if (session.inTransaction) {
      if (ast.type === 'INSERT') {
        const res = await this.engine.executeAST(ast);
        session.undoLog.push({
          type: 'UNDO_INSERT',
          table: ast.table,
          id: res.insertedId
        });
        return res;
      }

      if (ast.type === 'UPDATE') {
        const tableInfo = this.engine.tables.get(ast.table);
        if (!tableInfo) throw new Error(`Таблица '${ast.table}' не найдена.`);
        const matchingRecords = await tableInfo.storage.scan(rec => this.engine.evaluateConditions(rec, ast.where));

        for (const oldRec of matchingRecords) {
          session.undoLog.push({
            type: 'UNDO_UPDATE',
            table: ast.table,
            id: oldRec.id,
            previousState: { ...oldRec }
          });
        }
        return await this.engine.executeAST(ast);
      }

      if (ast.type === 'DELETE') {
        const tableInfo = this.engine.tables.get(ast.table);
        if (!tableInfo) throw new Error(`Таблица '${ast.table}' не найдена.`);
        const matchingRecords = await tableInfo.storage.scan(rec => this.engine.evaluateConditions(rec, ast.where));

        for (const oldRec of matchingRecords) {
          session.undoLog.push({
            type: 'UNDO_DELETE',
            table: ast.table,
            id: oldRec.id,
            previousState: { ...oldRec }
          });
        }
        return await this.engine.executeAST(ast);
      }
    }

    // Обычное выполнение запроса вне транзакции
    return await this.engine.executeAST(ast);
  }

  /**
   * Выполнение отката транзакции (ROLLBACK) в обратном порядке (LIFO)
   */
  async rollbackTransaction(session) {
    const count = session.undoLog.length;
    while (session.undoLog.length > 0) {
      const action = session.undoLog.pop();
      const tableInfo = this.engine.tables.get(action.table);
      if (!tableInfo) continue;

      if (action.type === 'UNDO_INSERT') {
        await tableInfo.storage.delete(action.id);
      } else if (action.type === 'UNDO_UPDATE') {
        await tableInfo.storage.update(action.id, action.previousState);
      } else if (action.type === 'UNDO_DELETE') {
        await tableInfo.storage.insert(action.id, action.previousState);
      }
    }

    session.inTransaction = false;
    return { message: `ROLLBACK: транзакция отменена, откат ${count} действий завершен.` };
  }

  async stop() {
    for (const socket of this.connections) {
      socket.destroy();
    }
    await this.engine.close();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
