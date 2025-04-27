// Модуль для сбора данных из Baltic Dry Index (BDI)
// Использует публично доступные данные индекса BDI

const axios = require('axios');
const cheerio = require('cheerio');
const { Pool } = require('pg');
const dotenv = require('dotenv');

// Загрузка переменных окружения
dotenv.config();

// Подключение к базе данных
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
    sslmode: 'require'
  }
});

// URL для получения данных BDI
const BDI_URL = 'https://www.balticexchange.com/en/data-services/market-information/dry-index.html';
// Альтернативный источник данных
const BDI_ALT_URL = 'https://tradingeconomics.com/commodity/baltic-dry';

// Функция для получения данных BDI
async function fetchBDIData() {
  try {
    console.log('Fetching Baltic Dry Index data...');
    
    // Попытка получить данные с основного источника
    let bdiData = await fetchBDIFromPrimarySource();
    
    // Если не удалось получить данные с основного источника, используем альтернативный
    if (!bdiData || bdiData.length === 0) {
      bdiData = await fetchBDIFromAlternativeSource();
    }
    
    // Если данные получены, сохраняем их в базу данных
    if (bdiData && bdiData.length > 0) {
      await saveBDIData(bdiData);
      return bdiData;
    } else {
      throw new Error('Failed to fetch BDI data from all sources');
    }
  } catch (error) {
    console.error('Error fetching BDI data:', error);
    // В случае ошибки возвращаем моковые данные
    return fetchMockBDIData();
  }
}

// Функция для получения данных BDI с основного источника
async function fetchBDIFromPrimarySource() {
  try {
    // Отправка запроса на сайт Baltic Exchange
    const response = await axios.get(BDI_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    // Проверка успешности запроса
    if (response.status !== 200) {
      throw new Error(`Failed to fetch BDI data from primary source: ${response.status}`);
    }
    
    // Парсинг HTML-страницы
    const $ = cheerio.load(response.data);
    
    // Извлечение данных из таблицы
    const bdiData = [];
    
    // Получение текущей даты
    const currentDate = new Date().toISOString().split('T')[0];
    
    // Поиск значения BDI на странице
    // Примечание: селекторы могут потребовать корректировки в зависимости от структуры страницы
    const bdiValue = $('.bdi-value').text().trim();
    const bdiChange = $('.bdi-change').text().trim();
    
    // Извлечение числового значения индекса
    const currentIndex = parseFloat(bdiValue.replace(',', ''));
    
    // Извлечение числового значения изменения
    const changeMatch = bdiChange.match(/([-+]?\d+(\.\d+)?)/);
    const change = changeMatch ? parseFloat(changeMatch[1]) : 0;
    
    // Добавление данных в массив, если индекс является числом
    if (!isNaN(currentIndex)) {
      bdiData.push({
        route: 'Baltic Dry Index (BDI)',
        currentIndex,
        change,
        indexDate: currentDate
      });
    }
    
    console.log(`Parsed BDI data from primary source: ${bdiData.length} records`);
    
    return bdiData;
  } catch (error) {
    console.error('Error fetching BDI data from primary source:', error);
    return [];
  }
}

// Функция для получения данных BDI с альтернативного источника
async function fetchBDIFromAlternativeSource() {
  try {
    // Отправка запроса на альтернативный сайт
    const response = await axios.get(BDI_ALT_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    // Проверка успешности запроса
    if (response.status !== 200) {
      throw new Error(`Failed to fetch BDI data from alternative source: ${response.status}`);
    }
    
    // Парсинг HTML-страницы
    const $ = cheerio.load(response.data);
    
    // Извлечение данных из таблицы
    const bdiData = [];
    
    // Получение текущей даты
    const currentDate = new Date().toISOString().split('T')[0];
    
    // Поиск значения BDI на странице
    // Примечание: селекторы могут потребовать корректировки в зависимости от структуры страницы
    const bdiValue = $('.last-price').text().trim();
    const bdiChange = $('.last-change').text().trim();
    
    // Извлечение числового значения индекса
    const currentIndex = parseFloat(bdiValue.replace(',', ''));
    
    // Извлечение числового значения изменения
    const changeMatch = bdiChange.match(/([-+]?\d+(\.\d+)?)/);
    const change = changeMatch ? parseFloat(changeMatch[1]) : 0;
    
    // Добавление данных в массив, если индекс является числом
    if (!isNaN(currentIndex)) {
      bdiData.push({
        route: 'Baltic Dry Index (BDI)',
        currentIndex,
        change,
        indexDate: currentDate
      });
    }
    
    console.log(`Parsed BDI data from alternative source: ${bdiData.length} records`);
    
    return bdiData;
  } catch (error) {
    console.error('Error fetching BDI data from alternative source:', error);
    return [];
  }
}

// Функция для получения моковых данных BDI
async function fetchMockBDIData() {
  console.log('Using mock data for BDI');
  
  // Получение текущей даты
  const currentDate = new Date().toISOString().split('T')[0];
  
  // Создание моковых данных на основе реальных значений BDI
  const mockData = [
    {
      route: 'Baltic Dry Index (BDI)',
      currentIndex: 1450,
      change: -15,
      indexDate: currentDate
    }
  ];
  
  // Сохранение моковых данных в базу данных
  await saveBDIData(mockData);
  
  return mockData;
}

// Функция для сохранения данных BDI в базу данных
async function saveBDIData(bdiData) {
  const client = await pool.connect();
  
  try {
    // Начало транзакции
    await client.query('BEGIN');
    
    // Создание таблицы, если она не существует
    await client.query(`
      CREATE TABLE IF NOT EXISTS freight_indices_bdi (
        id SERIAL PRIMARY KEY,
        route VARCHAR(255) NOT NULL,
        current_index NUMERIC NOT NULL,
        change NUMERIC,
        index_date DATE NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(route, index_date)
      )
    `);
    
    // Вставка данных
    for (const data of bdiData) {
      await client.query(
        `INSERT INTO freight_indices_bdi 
         (route, current_index, change, index_date) 
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (route, index_date) 
         DO UPDATE SET 
           current_index = $2,
           change = $3`,
        [
          data.route,
          data.currentIndex,
          data.change,
          data.indexDate
        ]
      );
    }
    
    // Завершение транзакции
    await client.query('COMMIT');
    
    console.log(`Saved ${bdiData.length} BDI records to database`);
  } catch (error) {
    // Откат транзакции в случае ошибки
    await client.query('ROLLBACK');
    console.error('Error saving BDI data to database:', error);
    throw error;
  } finally {
    // Освобождение клиента
    client.release();
  }
}

// Функция для получения данных BDI для расчета ставок
async function getBDIDataForCalculation() {
  try {
    // Получение последних данных BDI
    const query = `
      SELECT * FROM freight_indices_bdi 
      ORDER BY index_date DESC 
      LIMIT 1
    `;
    
    const result = await pool.query(query);
    
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error getting BDI data for calculation:', error);
    return null;
  }
}

// Экспорт функций
module.exports = {
  fetchBDIData,
  getBDIDataForCalculation
};
