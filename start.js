// Скрипт для запуска калькулятора ставок фрахта
// Сначала заполняет базу данных портами, затем запускает сервер

import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

async function startApplication() {
  try {
    console.log('Начало запуска приложения...');
    
    // Шаг 1: Заполнение базы данных портами
    console.log('Шаг 1: Заполнение базы данных портами...');
    try {
      const { stdout, stderr } = await execPromise('node populate_ports.js');
      console.log('Результат заполнения базы данных:');
      console.log(stdout);
      if (stderr) {
        console.error('Ошибки при заполнении базы данных:');
        console.error(stderr);
      }
    } catch (error) {
      console.error('Ошибка при заполнении базы данных:', error);
      // Продолжаем выполнение даже при ошибке
    }
    
    // Шаг 2: Запуск сервера
    console.log('Шаг 2: Запуск сервера...');
    console.log('Запуск server_updated.js...');
    
    // Импортируем и запускаем сервер
    import('./server_updated.js')
      .then(() => {
        console.log('Сервер успешно запущен');
      })
      .catch((error) => {
        console.error('Ошибка при запуске сервера:', error);
        process.exit(1);
      });
    
  } catch (error) {
    console.error('Критическая ошибка при запуске приложения:', error);
    process.exit(1);
  }
}

// Запуск приложения
startApplication();
