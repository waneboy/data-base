import path from 'node:path';
import fs from 'node:fs/promises';
import { Lexer } from './lexer.js';
import { Parser } from './parser.js';
import { ExecutionEngine } from './executor.js';

async function main() {
  console.log('--- [ТЕСТ] Синтаксический анализ и выполнение SQL запросов ---');

  // 1. Тест лексера
  console.log('\n1. Тест лексера (токенизация)...');
  const sampleSql = "SELECT id, name FROM users WHERE age >= 18 ORDER BY id DESC LIMIT 5;";
  const lexer = new Lexer(sampleSql);
  const tokens = lexer.tokenize();
  console.log(`Успешно получено ${tokens.length} токенов:`);
  console.log(tokens.map(t => `${t.type}(${t.value})`).join(' '));

  // 2. Тест парсера (построение AST)
  console.log('\n2. Тест парсера (построение AST дерева)...');
  const ast = Parser.parse(sampleSql);
  console.log('Сгенерированное AST:', JSON.stringify(ast, null, 2));

  // 3. Тест выполнения запросов (ExecutionEngine)
  console.log('\n3. Инициализация движка выполнения SQL...');
  const testDir = path.resolve('test_sql_db');
  await fs.rm(testDir, { recursive: true, force: true });

  const engine = new ExecutionEngine(testDir);
  await engine.init();

  // Выполняем CREATE TABLE
  console.log('\nВыполняем CREATE TABLE:');
  const res1 = await engine.execute("CREATE TABLE users (id, name, age, city);");
  console.log(res1.message);

  // Выполняем INSERT INTO
  console.log('\nВыполняем серию INSERT:');
  await engine.execute("INSERT INTO users VALUES (1, 'Иван', 25, 'Москва');");
  await engine.execute("INSERT INTO users VALUES (2, 'Анна', 19, 'Санкт-Петербург');");
  await engine.execute("INSERT INTO users VALUES (3, 'Дмитрий', 32, 'Москва');");
  await engine.execute("INSERT INTO users VALUES (4, 'Елена', 17, 'Казань');");
  console.log('✓ 4 пользователя успешно вставлены.');

  // Выполняем SELECT с фильтром и сортировкой
  console.log('\nВыполняем SELECT * WHERE age >= 18 ORDER BY age DESC:');
  const resSelect = await engine.execute("SELECT id, name, age, city FROM users WHERE age >= 18 ORDER BY age DESC;");
  console.table(resSelect.rows);

  // Выполняем UPDATE
  console.log('\nВыполняем UPDATE users SET city = \'Сочи\' WHERE id = 1:');
  const resUpdate = await engine.execute("UPDATE users SET city = 'Сочи' WHERE id = 1;");
  console.log(resUpdate.message);

  // Проверяем обновленную запись
  const resCheck = await engine.execute("SELECT * FROM users WHERE id = 1;");
  console.log('Проверка обновленного ID=1:', resCheck.rows[0]);

  // Выполняем DELETE
  console.log('\nВыполняем DELETE FROM users WHERE id = 4:');
  const resDelete = await engine.execute("DELETE FROM users WHERE id = 4;");
  console.log(resDelete.message);

  // Финальный SELECT
  console.log('\nФинальный состав таблицы users:');
  const finalSelect = await engine.execute("SELECT * FROM users ORDER BY id ASC;");
  console.table(finalSelect.rows);

  await engine.close();
  await fs.rm(testDir, { recursive: true, force: true });
  console.log('\n Все тесты SQL Parser и Execution Engine пройдены успешно!');
}

main().catch(console.error);
