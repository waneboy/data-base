#!/usr/bin/env node

import readline from 'node:readline';
import { TinyClient } from './src/client.js';
import { ExecutionEngine } from './src/executor.js';

async function main() {
  console.clear();
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║        TinySQL Interactive Database Console (REPL Shell)           ║');
  console.log('║     Полноценная реляционная СУБД на чистом Node.js с нуля          ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log(' Введите SQL запрос (заканчивая точкой с запятой ;)');
  console.log(' Служебные команды: .tables | .schema | .help | .exit\n');

  let client = null;
  let embeddedEngine = null;

  // Пытаемся подключиться к работающему TCP серверу на порту 8765
  try {
    const tcpClient = new TinyClient({ port: 8765 });
    await tcpClient.connect();
    client = tcpClient;
    console.log('📡 Подключено к сетевому серверу TinySQL (TCP 127.0.0.1:8765)\n');
  } catch {
    // Если сервер не запущен — работаем в автономном встраиваемом режиме (Embedded)
    embeddedEngine = new ExecutionEngine('./db_storage');
    await embeddedEngine.init();
    console.log('💾 Запущен автономный встраиваемый режим (директория: ./db_storage)\n');
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'tinydb> '
  });

  let multilineQuery = '';

  rl.prompt();

  rl.on('line', async (line) => {
    const trimmed = line.trim();

    // Служебные команды
    if (trimmed.startsWith('.')) {
      await handleDotCommand(trimmed, client, embeddedEngine);
      rl.prompt();
      return;
    }

    if (!trimmed) {
      rl.prompt();
      return;
    }

    multilineQuery += (multilineQuery ? ' ' : '') + trimmed;

    // Если строка не заканчивается на точку с запятой, продолжаем многострочный ввод
    if (!multilineQuery.endsWith(';')) {
      rl.setPrompt('   ...> ');
      rl.prompt();
      return;
    }

    const sqlToExecute = multilineQuery;
    multilineQuery = '';
    rl.setPrompt('tinydb> ');

    const startTime = performance.now();
    try {
      let result;
      if (client) {
        result = await client.query(sqlToExecute);
      } else {
        result = await embeddedEngine.execute(sqlToExecute);
      }

      const duration = (performance.now() - startTime).toFixed(2);

      if (result.rows) {
        if (result.rows.length === 0) {
          console.log(`(Пустой результат: 0 строк) [${duration} ms]`);
        } else {
          console.table(result.rows);
          console.log(`Выбрано строк: ${result.rowCount} [${duration} ms]`);
        }
      } else if (result.message) {
        console.log(`✓ ${result.message} [${duration} ms]`);
      } else {
        console.log(`✓ Запрос успешно выполнен [${duration} ms]`);
      }
    } catch (err) {
      const duration = (performance.now() - startTime).toFixed(2);
      console.error(` Ошибка: ${err.message} [${duration} ms]`);
    }

    console.log('');
    rl.prompt();
  });

  rl.on('close', async () => {
    console.log('\nЗавершение сеанса TinySQL. До свидания!');
    if (client) client.disconnect();
    if (embeddedEngine) await embeddedEngine.close();
    process.exit(0);
  });
}

async function handleDotCommand(cmd, client, embedded) {
  const parts = cmd.split(' ');
  const action = parts[0].toLowerCase();

  switch (action) {
    case '.exit':
    case '.quit':
      process.exit(0);
      break;

    case '.clear':
      console.clear();
      break;

    case '.tables': {
      if (client) {
        console.log('Таблицы в сетевом режиме хранятся в метаданных сервера.');
      } else {
        const tableNames = Array.from(embedded.tables.keys());
        if (tableNames.length === 0) {
          console.log('В базе данных пока нет созданных таблиц.');
        } else {
          console.log('Существующие таблицы:');
          tableNames.forEach(t => console.log(`  - ${t}`));
        }
      }
      break;
    }

    case '.schema': {
      const tableName = parts[1];
      if (!tableName) {
        console.log('Использование: .schema <имя_таблицы>');
        break;
      }
      if (embedded) {
        const info = embedded.tables.get(tableName);
        if (!info) {
          console.log(`Таблица '${tableName}' не найдена.`);
        } else {
          console.log(`Схема таблицы '${tableName}': (${info.schema.join(', ')})`);
        }
      }
      break;
    }

    case '.help':
      console.log('╔════════════════════════════════════════════════════════════════╗');
      console.log('║                     СПРАВКА ПО КОМАНДАМ                        ║');
      console.log('╠════════════════════════════════════════════════════════════════╣');
      console.log('║ .tables               - Список всех таблиц                     ║');
      console.log('║ .schema <table>       - Показать список колонок таблицы        ║');
      console.log('║ .clear                - Очистить экран терминала               ║');
      console.log('║ .exit                 - Выход из программы                     ║');
      console.log('║                                                                ║');
      console.log('║ ПРИМЕРЫ SQL ЗАПРОСОВ:                                          ║');
      console.log('║ CREATE TABLE users (id, name, age, city);                      ║');
      console.log("║ INSERT INTO users VALUES (1, 'Иван', 20, 'Москва');           ║");
      console.log("║ SELECT * FROM users WHERE age >= 18 ORDER BY id DESC;          ║");
      console.log("║ UPDATE users SET city = 'СПб' WHERE id = 1;                    ║");
      console.log('║ DELETE FROM users WHERE id = 1;                                ║');
      console.log('║ BEGIN; ... COMMIT; / ROLLBACK;                                 ║');
      console.log('╚════════════════════════════════════════════════════════════════╝');
      break;

    default:
      console.log(`Неизвестная служебная команда '${cmd}'. Введите .help для справки.`);
  }
}

main().catch(console.error);
