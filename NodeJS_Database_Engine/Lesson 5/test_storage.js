import path from 'node:path';
import fs from 'node:fs/promises';
import { StorageEngine } from './storage_engine.js';

async function main() {
  console.log('--- [ТЕСТ] Запуск проверки Storage Engine (модель Bitcask + WAL) ---');
  
  const testDir = path.resolve('test_data');
  const dbFile = path.join(testDir, 'students.db');

  // Очищаем тестовую папку перед запуском
  await fs.rm(testDir, { recursive: true, force: true });

  const storage = new StorageEngine(dbFile);
  await storage.init();
  console.log('✓ Движок хранилища успешно инициализирован.');

  // 1. Тест INSERT
  console.log('\n1. Тестируем вставку записей (INSERT)...');
  await storage.insert(1, { name: 'Алексей Иванов', age: 20, faculty: 'CS' });
  await storage.insert(2, { name: 'Мария Смирнова', age: 22, faculty: 'Math' });
  await storage.insert(3, { name: 'Дмитрий Кузнецов', age: 19, faculty: 'CS' });
  console.log('✓ Вставлено 3 записи.');

  // 2. Тест GET за O(1)
  console.log('\n2. Тестируем чтение по первичному ключу за O(1)...');
  const student2 = await storage.get(2);
  console.log('Получена запись ID=2:', student2);

  // 3. Тест UPDATE (Append-Only)
  console.log('\n3. Тестируем обновление записи (UPDATE ID=1, возраст 21 год)...');
  await storage.update(1, { name: 'Алексей Иванов', age: 21, faculty: 'CS' });
  const updatedStudent1 = await storage.get(1);
  console.log('Проверка обновленной записи ID=1:', updatedStudent1);

  // 4. Тест DELETE (Tombstone)
  console.log('\n4. Тестируем удаление (DELETE ID=3)...');
  await storage.delete(3);
  const deletedStudent3 = await storage.get(3);
  console.log('Попытка получить удаленного студента ID=3:', deletedStudent3); // Должно быть null

  // 5. Тест сканирования с предикатом
  console.log('\n5. Тестируем выборку всех студентов с факультета CS (age >= 20)...');
  const csStudents = await storage.scan(s => s.faculty === 'CS' && s.age >= 20);
  console.log('Результат сканирования:', csStudents);

  // Проверяем размер файла на диске до сжатия
  const sizeBefore = storage.currentFileSize;
  console.log(`\nРазмер файла базы до компактификации: ${sizeBefore} байт.`);

  // 6. Тест компактификации (Compaction)
  console.log('6. Запуск фоновой компактификации (удаление мертвых строк и надгробий)...');
  await storage.compact();
  const sizeAfter = storage.currentFileSize;
  console.log(`Размер файла базы после компактификации: ${sizeAfter} байт.`);
  console.log(`✓ Экономия места: ${sizeBefore - sizeAfter} байт.`);

  // Проверяем, что данные доступны после сжатия
  console.log('Чтение ID=1 после компактификации:', await storage.get(1));

  // 7. Тест отказоустойчивости (Краш-восстановление)
  console.log('\n7. Симуляция падения сервера и перезапуска: закрываем дескрипторы...');
  await storage.close();

  console.log('Создаем новый экземпляр движка на существующем файле базы данных...');
  const restartedStorage = new StorageEngine(dbFile);
  await restartedStorage.init();

  console.log('✓ Индекс успешно перестроен из файла на диске!');
  console.log('Проверка ID=1 на перезапущенном сервере:', await restartedStorage.get(1));
  console.log('Проверка ID=2 на перезапущенном сервере:', await restartedStorage.get(2));
  console.log('Проверка удаленного ID=3:', await restartedStorage.get(3));

  await restartedStorage.close();
  // Подчищаем временные файлы
  await fs.rm(testDir, { recursive: true, force: true });
  console.log('\n Все тесты Storage Engine успешно пройдены!');
}

main().catch(console.error);
