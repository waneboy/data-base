import path from 'node:path';
import fs from 'node:fs/promises';
import { TinyServer } from './server.js';
import { TinyClient } from './client.js';

async function main() {
  console.log('--- [ТЕСТ] Сетевой TCP сервер и транзакции (ACID: ROLLBACK / COMMIT) ---');

  const testDir = path.resolve('test_network_db');
  await fs.rm(testDir, { recursive: true, force: true });

  const PORT = 8899;
  const server = new TinyServer(PORT, testDir);
  await server.start();

  const client = new TinyClient({ port: PORT });
  await client.connect();
  console.log('✓ Клиент успешно подключился к TCP серверу TinyDB.');

  // 1. Создаем таблицу банковских счетов
  console.log('\n1. Создание таблицы банковских счетов...');
  const resCreate = await client.query('CREATE TABLE accounts (id, owner, balance);');
  console.log(resCreate.message);

  // 2. Вносим исходные балансы
  console.log('\n2. Вставка начальных данных...');
  await client.query("INSERT INTO accounts VALUES (1, 'Алиса', 1000);");
  await client.query("INSERT INTO accounts VALUES (2, 'Боб', 500);");

  let state = await client.query('SELECT * FROM accounts ORDER BY id ASC;');
  console.log('Начальное состояние счетов:');
  console.table(state.rows);

  // 3. Тест транзакции с ОТКАТОМ (ROLLBACK)
  console.log('\n3. НАЧАЛО ТРАНЗАКЦИИ С ОТКАТОМ (Симуляция сбоя перевода)...');
  await client.query('BEGIN;');
  console.log('Транзакция открыта. Снимаем $300 со счета Алисы...');
  await client.query('UPDATE accounts SET balance = 700 WHERE id = 1;');

  console.log('Начисляем $300 на счет Боба...');
  await client.query('UPDATE accounts SET balance = 800 WHERE id = 2;');

  const intermediate = await client.query('SELECT * FROM accounts ORDER BY id ASC;');
  console.log('Промежуточное состояние внутри транзакции:');
  console.table(intermediate.rows);

  console.log('! Произошел сбой сети или бизнес-ошибка. Отправляем ROLLBACK...');
  const rollbackRes = await client.query('ROLLBACK;');
  console.log(rollbackRes.message);

  const stateAfterRollback = await client.query('SELECT * FROM accounts ORDER BY id ASC;');
  console.log('Состояние счетов после ROLLBACK (балансы восстановлены!):');
  console.table(stateAfterRollback.rows);

  // 4. Тест успешной транзакции с ФИКСАЦИЕЙ (COMMIT)
  console.log('\n4. НАЧАЛО УСПЕШНОЙ ТРАНЗАКЦИИ (COMMIT)...');
  await client.query('BEGIN;');
  await client.query('UPDATE accounts SET balance = 850 WHERE id = 1;');
  await client.query('UPDATE accounts SET balance = 650 WHERE id = 2;');
  const commitRes = await client.query('COMMIT;');
  console.log(commitRes.message);

  const finalState = await client.query('SELECT * FROM accounts ORDER BY id ASC;');
  console.log('Финальное состояние счетов после COMMIT:');
  console.table(finalState.rows);

  client.disconnect();
  await server.stop();
  await fs.rm(testDir, { recursive: true, force: true });

  console.log('\n Все тесты TCP сервера и транзакций успешно завершены!');
}

main().catch(console.error);
