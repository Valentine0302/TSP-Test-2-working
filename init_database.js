// Скрипт для инициализации базы данных калькулятора ставок фрахта
// Создает необходимые таблицы и заполняет их начальными данными

import pg from 'pg';
import dotenv from 'dotenv';
import EXPANDED_PORTS from './data/expanded_ports.js';

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

// Функция для инициализации базы данных
async function initializeDatabase() {
  try {
    console.log('Начало инициализации базы данных...');
    
    // Создание таблиц, если они не существуют
    await pool.query(`
      CREATE TABLE IF NOT EXISTS calculation_history (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP NOT NULL,
        email VARCHAR(255) NOT NULL,
        origin VARCHAR(50) NOT NULL,
        destination VARCHAR(50) NOT NULL,
        container_type VARCHAR(50) NOT NULL,
        rate NUMERIC NOT NULL,
        min_rate NUMERIC NOT NULL,
        max_rate NUMERIC NOT NULL,
        reliability NUMERIC NOT NULL,
        source_count INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ports (
        id VARCHAR(10) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        country VARCHAR(100) NOT NULL,
        region VARCHAR(100) NOT NULL,
        latitude NUMERIC,
        longitude NUMERIC,
        popularity NUMERIC DEFAULT 0.5
      );

      CREATE TABLE IF NOT EXISTS container_types (
        id VARCHAR(10) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description VARCHAR(255) NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS port_requests (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP NOT NULL,
        port_name VARCHAR(100) NOT NULL,
        country VARCHAR(100) NOT NULL,
        region VARCHAR(100),
        request_reason TEXT,
        user_email VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending'
      );
      
      CREATE TABLE IF NOT EXISTS verified_emails (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        verified_at TIMESTAMP NOT NULL
      );
    `);
    console.log('Таблицы созданы успешно');

    // Проверка, есть ли типы контейнеров в базе данных
    const containerTypesResult = await pool.query('SELECT COUNT(*) FROM container_types');
    if (parseInt(containerTypesResult.rows[0].count) === 0) {
      // Вставка начальных типов контейнеров
      await pool.query(`
        INSERT INTO container_types (id, name, description) VALUES
        ('20DV', '20'' Dry Van', 'Standard 20-foot dry container'),
        ('40DV', '40'' Dry Van', 'Standard 40-foot dry container'),
        ('40HQ', '40'' High Cube', '40-foot high cube container with extra height')
      `);
      console.log('Типы контейнеров добавлены успешно');
    } else {
      console.log('Типы контейнеров уже существуют в базе данных');
    }

    // Проверка, есть ли порты в базе данных
    const portsResult = await pool.query('SELECT COUNT(*) FROM ports');
    console.log(`Количество портов в базе данных: ${portsResult.rows[0].count}`);
    
    // Очистка таблицы портов и добавление расширенного списка
    await pool.query('TRUNCATE TABLE ports');
    console.log('Таблица портов очищена');
    
    // Вставка расширенного списка портов
    let insertedCount = 0;
    for (const port of EXPANDED_PORTS) {
      try {
        await pool.query(
          `INSERT INTO ports (id, name, country, region, latitude, longitude, popularity) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE 
           SET name = $2, country = $3, region = $4, latitude = $5, longitude = $6, popularity = $7`,
          [
            port.id,
            port.name,
            port.country,
            port.region,
            port.latitude,
            port.longitude,
            port.popularity
          ]
        );
        insertedCount++;
      } catch (error) {
        console.error(`Ошибка при добавлении порта ${port.name}:`, error);
      }
    }
    console.log(`Добавлено ${insertedCount} портов в базу данных`);
    
    // Проверка, что порты действительно добавлены
    const finalPortsResult = await pool.query('SELECT COUNT(*) FROM ports');
    console.log(`Итоговое количество портов в базе данных: ${finalPortsResult.rows[0].count}`);
    
    // Вывод первых 5 портов для проверки
    const samplePorts = await pool.query('SELECT * FROM ports LIMIT 5');
    console.log('Примеры портов в базе данных:');
    console.log(samplePorts.rows);

    console.log('Инициализация базы данных завершена успешно');
    return { success: true, message: 'База данных инициализирована успешно' };
  } catch (error) {
    console.error('Ошибка при инициализации базы данных:', error);
    return { success: false, error: error.message };
  } finally {
    // Закрытие соединения с базой данных
    await pool.end();
  }
}

// Запуск инициализации базы данных
initializeDatabase()
  .then(result => {
    console.log(result);
    process.exit(0);
  })
  .catch(error => {
    console.error('Критическая ошибка:', error);
    process.exit(1);
  });
