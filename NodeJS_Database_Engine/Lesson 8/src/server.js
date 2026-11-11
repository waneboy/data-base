import net from 'node:net';
import path from 'node:path';
import { Protocol } from './protocol.js';
import { Parser } from './parser.js';
import { ExecutionEngine } from './executor.js';

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

    const session = {
      clientId,
      inTransaction: false,
      undoLog: []
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
      this.connections.delete(socket);
      if (session.inTransaction) {
        await this.rollbackTransaction(session);
      }
    });

    socket.on('error', () => {
      this.connections.delete(socket);
    });
  }

  async executeSessionQuery(session, sql) {
    const ast = Parser.parse(sql);

    if (ast.type === 'BEGIN') {
      if (session.inTransaction) throw new Error('Транзакция уже начата.');
      session.inTransaction = true;
      session.undoLog = [];
      return { message: 'BEGIN TRANSACTION: транзакция открыта.' };
    }

    if (ast.type === 'COMMIT') {
      if (!session.inTransaction) throw new Error('Нет активной транзакции для фиксации.');
      session.inTransaction = false;
      const count = session.undoLog.length;
      session.undoLog = [];
      return { message: `COMMIT: транзакция зафиксирована (${count} действий).` };
    }

    if (ast.type === 'ROLLBACK') {
      if (!session.inTransaction) throw new Error('Нет активной транзакции для отката.');
      return await this.rollbackTransaction(session);
    }

    if (session.inTransaction) {
      if (ast.type === 'INSERT') {
        const res = await this.engine.executeAST(ast);
        session.undoLog.push({ type: 'UNDO_INSERT', table: ast.table, id: res.insertedId });
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

    return await this.engine.executeAST(ast);
  }

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
    return { message: `ROLLBACK: откат ${count} действий успешно выполнен.` };
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

// Запуск напрямую через node src/server.js
if (process.argv[1]?.endsWith('server.js')) {
  const port = process.env.PORT ? Number(process.env.PORT) : 8765;
  const dataDir = process.env.DATA_DIR || './db_storage';
  const server = new TinyServer(port, dataDir);
  await server.start();
  console.log(`=======================================================`);
  console.log(` TinySQL Server успешно запущен на порту: ${port}`);
  console.log(` Директория базы данных: ${server.dataDir}`);
  console.log(` Ожидание сетевых TCP подключений от TinyClient...`);
  console.log(`=======================================================`);
}
