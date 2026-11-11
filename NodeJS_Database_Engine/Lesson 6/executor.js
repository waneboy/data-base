import path from 'node:path';
import fs from 'node:fs/promises';
import { StorageEngine } from '../Lesson 5/storage_engine.js';
import { Parser } from './parser.js';

/**
 * ExecutionEngine (Исполнитель SQL-запросов)
 * Связывает абстрактное синтаксическое дерево (AST) с физическим движком хранения.
 */
export class ExecutionEngine {
  constructor(dataDir = './data') {
    this.dataDir = dataDir;
    this.tables = new Map(); // tableName -> { storage, schema: ['id', 'col1', ...] }
    this.schemaFile = path.join(this.dataDir, '_schemas.json');
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    try {
      const data = await fs.readFile(this.schemaFile, 'utf8');
      const savedSchemas = JSON.parse(data);
      for (const [table, columns] of Object.entries(savedSchemas)) {
        const storage = new StorageEngine(path.join(this.dataDir, `${table}.db`));
        await storage.init();
        this.tables.set(table, { storage, schema: columns });
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async saveSchemas() {
    const schemasObj = {};
    for (const [table, info] of this.tables.entries()) {
      schemasObj[table] = info.schema;
    }
    await fs.writeFile(this.schemaFile, JSON.stringify(schemasObj, null, 2));
  }

  /**
   * Выполнение текстового SQL-запроса
   */
  async execute(sql) {
    const ast = Parser.parse(sql);
    return await this.executeAST(ast);
  }

  async executeAST(ast) {
    switch (ast.type) {
      case 'CREATE_TABLE':
        return await this.handleCreateTable(ast);
      case 'INSERT':
        return await this.handleInsert(ast);
      case 'SELECT':
        return await this.handleSelect(ast);
      case 'UPDATE':
        return await this.handleUpdate(ast);
      case 'DELETE':
        return await this.handleDelete(ast);
      default:
        throw new Error(`Неподдерживаемая инструкция AST: ${ast.type}`);
    }
  }

  async handleCreateTable(ast) {
    const tableName = ast.table;
    if (this.tables.has(tableName)) {
      throw new Error(`Таблица '${tableName}' уже существует.`);
    }

    const storage = new StorageEngine(path.join(this.dataDir, `${tableName}.db`));
    await storage.init();

    this.tables.set(tableName, { storage, schema: ast.columns });
    await this.saveSchemas();

    return {
      command: 'CREATE_TABLE',
      message: `Таблица '${tableName}' успешно создана (поля: ${ast.columns.join(', ')})`
    };
  }

  async handleInsert(ast) {
    const tableInfo = this.tables.get(ast.table);
    if (!tableInfo) {
      throw new Error(`Таблица '${ast.table}' не найдена.`);
    }

    const { storage, schema } = tableInfo;
    const record = {};

    if (ast.columns) {
      if (ast.columns.length !== ast.values.length) {
        throw new Error(`Количество колонок (${ast.columns.length}) не совпадает со значениями (${ast.values.length})`);
      }
      for (let i = 0; i < ast.columns.length; i++) {
        record[ast.columns[i]] = ast.values[i];
      }
    } else {
      if (ast.values.length !== schema.length) {
        throw new Error(`Ожидалось ${schema.length} значений по схеме, получено ${ast.values.length}`);
      }
      for (let i = 0; i < schema.length; i++) {
        record[schema[i]] = ast.values[i];
      }
    }

    const id = Number(record.id !== undefined ? record.id : record[schema[0]]);
    if (isNaN(id)) {
      throw new Error(`Первичный ключ 'id' должен быть числом! Получено: ${record.id}`);
    }

    await storage.insert(id, record);

    return {
      command: 'INSERT',
      insertedId: id,
      rowCount: 1,
      message: `1 запись успешно добавлена (ID=${id})`
    };
  }

  async handleSelect(ast) {
    const tableInfo = this.tables.get(ast.table);
    if (!tableInfo) {
      throw new Error(`Таблица '${ast.table}' не найдена.`);
    }

    const { storage, schema } = tableInfo;
    let rows = [];

    // ОПТИМИЗАЦИЯ: Если в WHERE есть условие id = X, делаем O(1) чтение по индексу!
    const idCondition = ast.where?.find(cond => cond.field.toLowerCase() === 'id' && cond.op === '=');

    if (idCondition) {
      const record = await storage.get(Number(idCondition.value));
      if (record && this.evaluateConditions(record, ast.where)) {
        rows.push(record);
      }
    } else {
      // Иначе полное сканирование с предикатом
      rows = await storage.scan(record => this.evaluateConditions(record, ast.where));
    }

    // Сортировка ORDER BY
    if (ast.orderBy) {
      const { field, direction } = ast.orderBy;
      rows.sort((a, b) => {
        if (a[field] < b[field]) return direction === 'ASC' ? -1 : 1;
        if (a[field] > b[field]) return direction === 'ASC' ? 1 : -1;
        return 0;
      });
    }

    // Лимит строк LIMIT
    if (ast.limit !== null && ast.limit !== undefined) {
      rows = rows.slice(0, ast.limit);
    }

    // Проекция колонок (SELECT col1, col2)
    const selectAll = ast.columns.includes('*');
    const displayColumns = selectAll ? schema : ast.columns;

    const projectedRows = rows.map(r => {
      const projected = {};
      for (const col of displayColumns) {
        projected[col] = r[col] !== undefined ? r[col] : null;
      }
      return projected;
    });

    return {
      command: 'SELECT',
      columns: displayColumns,
      rows: projectedRows,
      rowCount: projectedRows.length
    };
  }

  async handleUpdate(ast) {
    const tableInfo = this.tables.get(ast.table);
    if (!tableInfo) {
      throw new Error(`Таблица '${ast.table}' не найдена.`);
    }

    const { storage } = tableInfo;
    const matchingRecords = await storage.scan(record => this.evaluateConditions(record, ast.where));

    let updatedCount = 0;
    for (const rec of matchingRecords) {
      const updatedRec = { ...rec, ...ast.set };
      await storage.update(rec.id, updatedRec);
      updatedCount++;
    }

    return {
      command: 'UPDATE',
      rowCount: updatedCount,
      message: `Обновлено записей: ${updatedCount}`
    };
  }

  async handleDelete(ast) {
    const tableInfo = this.tables.get(ast.table);
    if (!tableInfo) {
      throw new Error(`Таблица '${ast.table}' не найдена.`);
    }

    const { storage } = tableInfo;
    const matchingRecords = await storage.scan(record => this.evaluateConditions(record, ast.where));

    let deletedCount = 0;
    for (const rec of matchingRecords) {
      await storage.delete(rec.id);
      deletedCount++;
    }

    return {
      command: 'DELETE',
      rowCount: deletedCount,
      message: `Удалено записей: ${deletedCount}`
    };
  }

  evaluateConditions(record, conditions) {
    if (!conditions || conditions.length === 0) return true;

    for (const cond of conditions) {
      const recVal = record[cond.field];
      const targetVal = cond.value;

      switch (cond.op) {
        case '=':
          if (recVal != targetVal) return false;
          break;
        case '!=':
          if (recVal == targetVal) return false;
          break;
        case '>':
          if (!(recVal > targetVal)) return false;
          break;
        case '<':
          if (!(recVal < targetVal)) return false;
          break;
        case '>=':
          if (!(recVal >= targetVal)) return false;
          break;
        case '<=':
          if (!(recVal <= targetVal)) return false;
          break;
        default:
          return false;
      }
    }
    return true;
  }

  async close() {
    for (const info of this.tables.values()) {
      await info.storage.close();
    }
  }
}
