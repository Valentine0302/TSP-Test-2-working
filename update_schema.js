// Скрипт для обновления схемы базы данных калькулятора ставок фрахта
// Добавляет недостающие столбцы в таблицу ports

import pg from 'pg';
import dotenv from 'dotenv';

// Загрузка переменных окружения
dotenv.config();

// Подключение к базе данных
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Функция для обновления схемы базы данных
async function updateDatabaseSchema() {
  try {
    console.log('Начало обновления схемы базы данных...');
    
    // Проверка существования таблицы ports
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'ports'
      );
    `);
    
    if (!tableExists.rows[0].exists) {
      console.log('Таблица ports не существует. Создаем таблицу...');
      await pool.query(`
        CREATE TABLE ports (
          id VARCHAR(10) PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          country VARCHAR(100) NOT NULL,
          region VARCHAR(100) NOT NULL,
          latitude NUMERIC,
          longitude NUMERIC,
          popularity NUMERIC DEFAULT 0.5
        );
      `);
      console.log('Таблица ports создана успешно');
    } else {
      console.log('Таблица ports уже существует. Проверяем наличие столбцов...');
      
      // Получение информации о столбцах таблицы ports
      const columnsInfo = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'ports';
      `);
      
      const existingColumns = columnsInfo.rows.map(row => row.column_name);
      console.log('Существующие столбцы:', existingColumns);
      
      // Проверка и добавление столбца latitude
      if (!existingColumns.includes('latitude')) {
        console.log('Добавление столбца latitude...');
        await pool.query('ALTER TABLE ports ADD COLUMN latitude NUMERIC;');
        console.log('Столбец latitude добавлен успешно');
      }
      
      // Проверка и добавление столбца longitude
      if (!existingColumns.includes('longitude')) {
        console.log('Добавление столбца longitude...');
        await pool.query('ALTER TABLE ports ADD COLUMN longitude NUMERIC;');
        console.log('Столбец longitude добавлен успешно');
      }
      
      // Проверка и добавление столбца popularity
      if (!existingColumns.includes('popularity')) {
        console.log('Добавление столбца popularity...');
        await pool.query('ALTER TABLE ports ADD COLUMN popularity NUMERIC DEFAULT 0.5;');
        console.log('Столбец popularity добавлен успешно');
      }
    }
    
    // Проверка существования таблицы port_requests
    const portRequestsExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'port_requests'
      );
    `);
    
    if (!portRequestsExists.rows[0].exists) {
      console.log('Таблица port_requests не существует. Создаем таблицу...');
      await pool.query(`
        CREATE TABLE port_requests (
          id SERIAL PRIMARY KEY,
          timestamp TIMESTAMP NOT NULL,
          port_name VARCHAR(100) NOT NULL,
          country VARCHAR(100) NOT NULL,
          region VARCHAR(100),
          request_reason TEXT,
          user_email VARCHAR(255) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'pending'
        );
      `);
      console.log('Таблица port_requests создана успешно');
    }
    
    // Проверка существования таблицы verified_emails
    const verifiedEmailsExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'verified_emails'
      );
    `);
    
    if (!verifiedEmailsExists.rows[0].exists) {
      console.log('Таблица verified_emails не существует. Создаем таблицу...');
      await pool.query(`
        CREATE TABLE verified_emails (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) NOT NULL UNIQUE,
          verified_at TIMESTAMP NOT NULL
        );
      `);
      console.log('Таблица verified_emails создана успешно');
    }
    
    console.log('Обновление схемы базы данных завершено успешно');
    return { success: true, message: 'Схема базы данных обновлена успешно' };
  } catch (error) {
    console.error('Ошибка при обновлении схемы базы данных:', error);
    return { success: false, error: error.message };
  } finally {
    // Закрытие соединения с базой данных
    await pool.end();
  }
}

// Запуск обновления схемы базы данных
updateDatabaseSchema()
  .then(result => {
    console.log(result);
    process.exit(0);
  })
  .catch(error => {
    console.error('Критическая ошибка:', error);
    process.exit(1);
  });
