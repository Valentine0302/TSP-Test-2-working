// db_init.js - Скрипт для инициализации базы данных
// Создает необходимые таблицы и столбцы для системы расчета фрахтовых ставок

const { Pool } = require('pg');
require('dotenv').config();

// Подключение к базе данных
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
    sslmode: 'require'
  }
});

// Функция для выполнения SQL-запросов
async function executeQuery(query, params = []) {
  const client = await pool.connect();
  try {
    console.log(`Выполняется запрос: ${query.substring(0, 100)}...`);
    const result = await client.query(query, params);
    console.log(`Запрос выполнен успешно. Затронуто строк: ${result.rowCount}`);
    return result;
  } catch (error) {
    console.error(`Ошибка при выполнении запроса: ${error.message}`);
    console.error(`Полный текст запроса: ${query}`);
    throw error;
  } finally {
    client.release();
  }
}

// Функция для проверки существования таблицы
async function tableExists(tableName) {
  const query = `
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = $1
    );
  `;
  const result = await executeQuery(query, [tableName]);
  return result.rows[0].exists;
}

// Функция для проверки существования столбца в таблице
async function columnExists(tableName, columnName) {
  const query = `
    SELECT EXISTS (
      SELECT FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = $1 
      AND column_name = $2
    );
  `;
  const result = await executeQuery(query, [tableName, columnName]);
  return result.rows[0].exists;
}

// Основная функция инициализации базы данных
async function initializeDatabase() {
  console.log('Начало инициализации базы данных...');
  
  try {
    // 1. Создание таблицы freight_indices_scfi, если она не существует
    const scfiTableExists = await tableExists('freight_indices_scfi');
    if (!scfiTableExists) {
      console.log('Создание таблицы freight_indices_scfi...');
      await executeQuery(`
        CREATE TABLE freight_indices_scfi (
          id SERIAL PRIMARY KEY,
          origin_port VARCHAR(255) NOT NULL,
          destination_port VARCHAR(255) NOT NULL,
          container_type VARCHAR(50) NOT NULL,
          rate NUMERIC(10, 2) NOT NULL,
          record_date DATE NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log('Таблица freight_indices_scfi успешно создана.');
      
      // Создание индекса для быстрого поиска
      await executeQuery(`
        CREATE INDEX idx_scfi_route_date ON freight_indices_scfi (origin_port, destination_port, record_date);
      `);
      console.log('Индекс для таблицы freight_indices_scfi создан.');
    } else {
      console.log('Таблица freight_indices_scfi уже существует.');
    }
    
    // 2. Создание таблицы seasonality_factors, если она не существует
    const seasonalityTableExists = await tableExists('seasonality_factors');
    if (!seasonalityTableExists) {
      console.log('Создание таблицы seasonality_factors...');
      await executeQuery(`
        CREATE TABLE seasonality_factors (
          id SERIAL PRIMARY KEY,
          month_number INT NOT NULL CHECK (month_number >= 1 AND month_number <= 12),
          factor NUMERIC(5, 3) NOT NULL,
          year INT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (month_number, year)
        );
      `);
      console.log('Таблица seasonality_factors успешно создана.');
      
      // Создание индекса для быстрого поиска
      await executeQuery(`
        CREATE INDEX idx_seasonality_month_year ON seasonality_factors (month_number, year);
      `);
      console.log('Индекс для таблицы seasonality_factors создан.');
    } else {
      console.log('Таблица seasonality_factors уже существует.');
    }
    
    // 3. Проверка существования таблицы fuel_prices
    const fuelPricesTableExists = await tableExists('fuel_prices');
    if (fuelPricesTableExists) {
      // 3.1. Добавление столбца fuel_type, если он не существует
      const fuelTypeColumnExists = await columnExists('fuel_prices', 'fuel_type');
      if (!fuelTypeColumnExists) {
        console.log('Добавление столбца fuel_type в таблицу fuel_prices...');
        await executeQuery(`
          ALTER TABLE fuel_prices ADD COLUMN fuel_type VARCHAR(50);
        `);
        console.log('Столбец fuel_type успешно добавлен.');
      } else {
        console.log('Столбец fuel_type уже существует в таблице fuel_prices.');
      }
      
      // 3.2. Добавление столбца price_date, если он не существует
      const priceDateColumnExists = await columnExists('fuel_prices', 'price_date');
      if (!priceDateColumnExists) {
        console.log('Добавление столбца price_date в таблицу fuel_prices...');
        await executeQuery(`
          ALTER TABLE fuel_prices ADD COLUMN price_date DATE;
        `);
        console.log('Столбец price_date успешно добавлен.');
      } else {
        console.log('Столбец price_date уже существует в таблице fuel_prices.');
      }
      
      // 3.3. Создание индекса для быстрого поиска, если оба столбца существуют
      if (await columnExists('fuel_prices', 'fuel_type') && await columnExists('fuel_prices', 'price_date')) {
        console.log('Создание индекса для таблицы fuel_prices...');
        try {
          await executeQuery(`
            CREATE INDEX IF NOT EXISTS idx_fuel_type_date ON fuel_prices (fuel_type, price_date);
          `);
          console.log('Индекс для таблицы fuel_prices создан.');
        } catch (error) {
          console.log('Индекс для таблицы fuel_prices уже существует или не может быть создан.');
        }
      }
    } else {
      console.log('Таблица fuel_prices не существует. Создание таблицы...');
      await executeQuery(`
        CREATE TABLE fuel_prices (
          id SERIAL PRIMARY KEY,
          price NUMERIC(10, 2) NOT NULL,
          fuel_type VARCHAR(50),
          price_date DATE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log('Таблица fuel_prices успешно создана.');
      
      // Создание индекса для быстрого поиска
      await executeQuery(`
        CREATE INDEX idx_fuel_type_date ON fuel_prices (fuel_type, price_date);
      `);
      console.log('Индекс для таблицы fuel_prices создан.');
    }
    
    console.log('Инициализация базы данных успешно завершена!');
  } catch (error) {
    console.error('Ошибка при инициализации базы данных:', error);
  } finally {
    // Закрытие пула соединений
    await pool.end();
    console.log('Соединение с базой данных закрыто.');
  }
}

// Запуск инициализации
initializeDatabase();
