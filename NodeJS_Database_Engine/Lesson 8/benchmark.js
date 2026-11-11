import path from 'node:path';
import fs from 'node:fs/promises';
import { ExecutionEngine } from './src/executor.js';

async function runBenchmark() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║        TinySQL Database Performance Benchmark (Node.js)        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const benchDir = path.resolve('benchmark_data');
  await fs.rm(benchDir, { recursive: true, force: true });

  const engine = new ExecutionEngine(benchDir);
  await engine.init();

  // 1. Создаем таблицу
  await engine.execute('CREATE TABLE products (id, title, price, category);');

  // 2. Бенчмарк массовой вставки (INSERT)
  const INSERT_COUNT = 2000;
  console.log(`[1/3] Замер скорости вставки ${INSERT_COUNT} записей (Append-Only Log + WAL)...`);

  const insertStart = performance.now();
  for (let i = 1; i <= INSERT_COUNT; i++) {
    const category = i % 2 === 0 ? 'electronics' : 'books';
    await engine.execute(`INSERT INTO products VALUES (${i}, 'Product_${i}', ${100 + (i % 500)}, '${category}');`);
  }
  const insertDuration = performance.now() - insertStart;
  const insertRPS = ((INSERT_COUNT / insertDuration) * 1000).toFixed(0);

  console.log(`✓ Успешно вставлено: ${INSERT_COUNT} строк за ${insertDuration.toFixed(2)} ms`);
  console.log(`  Пропускная способность записи (RPS): ${insertRPS} операций/сек\n`);

  // 3. Бенчмарк точечной выборки по первичному ключу с хэш-индексом (O(1) Point Lookup)
  const LOOKUP_COUNT = 1000;
  console.log(`[2/3] Замер точечной выборки по ID с использованием индекса O(1) (${LOOKUP_COUNT} итераций)...`);

  const indexStart = performance.now();
  for (let i = 0; i < LOOKUP_COUNT; i++) {
    const targetId = Math.floor(Math.random() * INSERT_COUNT) + 1;
    await engine.execute(`SELECT * FROM products WHERE id = ${targetId};`);
  }
  const indexDuration = performance.now() - indexStart;
  const avgIndexTime = (indexDuration / LOOKUP_COUNT).toFixed(3);
  const indexQPS = ((LOOKUP_COUNT / indexDuration) * 1000).toFixed(0);

  console.log(`✓ Выполнено ${LOOKUP_COUNT} выборок за ${indexDuration.toFixed(2)} ms`);
  console.log(`  Среднее время 1 запроса по индексу: ${avgIndexTime} ms`);
  console.log(`  Производительность по индексу (QPS): ${indexQPS} запросов/сек\n`);

  // 4. Бенчмарк полного сканирования таблицы без индекса (Full Table Scan)
  const SCAN_COUNT = 100;
  console.log(`[3/3] Замер полного сканирования таблицы (Full Table Scan, ${SCAN_COUNT} итераций)...`);

  const scanStart = performance.now();
  for (let i = 0; i < SCAN_COUNT; i++) {
    await engine.execute(`SELECT * FROM products WHERE category = 'books';`);
  }
  const scanDuration = performance.now() - scanStart;
  const avgScanTime = (scanDuration / SCAN_COUNT).toFixed(3);
  const scanQPS = ((SCAN_COUNT / scanDuration) * 1000).toFixed(0);

  console.log(`✓ Выполнено ${SCAN_COUNT} сканирований всей таблицы за ${scanDuration.toFixed(2)} ms`);
  console.log(`  Среднее время 1 полного сканирования: ${avgScanTime} ms`);
  console.log(`  Производительность Full Scan (QPS): ${scanQPS} запросов/сек\n`);

  // 5. Итоговое сравнение эффективности индекса
  const speedup = (avgScanTime / avgIndexTime).toFixed(1);
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                     ИТОГОВЫЙ ОТЧЕТ БЕНЧМАРКА                   ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log(`║ Запись на диск (Append-Only):          ${insertRPS.padStart(7)} ops/sec         ║`);
  console.log(`║ Поиск по индексу O(1):                 ${avgIndexTime.padStart(7)} ms (${indexQPS} QPS)   ║`);
  console.log(`║ Полное сканирование (Full Scan):       ${avgScanTime.padStart(7)} ms (${scanQPS} QPS)   ║`);
  console.log(`║ Ускорение за счет хэш-индекса:         в ${speedup.padStart(4)} раз быстрее!        ║`);
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  await engine.close();
  await fs.rm(benchDir, { recursive: true, force: true });
}

runBenchmark().catch(console.error);
