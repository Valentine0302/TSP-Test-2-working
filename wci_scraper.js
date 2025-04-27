// Модуль для сбора данных из Drewry World Container Index (WCI)
// Использует публично доступные данные индекса WCI

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

// URL для получения данных WCI
const WCI_URL = 'https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/world-container-index-assessed-by-drewry';

// Функция для получения данных WCI
async function fetchWCIData() {
  try {
    console.log('Fetching WCI data...');
    
    // Отправка запроса на сайт Drewry
    const response = await axios.get(WCI_URL);
    
    // Проверка успешности запроса
    if (response.status !== 200) {
      throw new Error(`Failed to fetch WCI data: ${response.status}`);
    }
    
    // Парсинг HTML-страницы
    const $ = cheerio.load(response.data);
    
    // Извлечение данных из таблицы
    const wciData = [];
    
    // Получение даты публикации
    let indexDate = new Date().toISOString().split('T')[0]; // По умолчанию текущая дата
    
    // Попытка найти дату публикации на странице
    const dateText = $('.wci-date').text().trim();
    if (dateText) {
      const dateMatch = dateText.match(/(\d{1,2})[thsrdn]{0,2}\s+([A-Za-z]+)\s+(\d{4})/);
      if (dateMatch) {
        const day = dateMatch[1].padStart(2, '0');
        const month = getMonthNumber(dateMatch[2]);
        const year = dateMatch[3];
        indexDate = `${year}-${month}-${day}`;
      }
    }
    
    // Парсинг таблицы с данными WCI
    $('.wci-table tbody tr').each((i, row) => {
      const columns = $(row).find('td');
      
      if (columns.length >= 3) {
        const route = $(columns[0]).text().trim();
        const currentIndexText = $(columns[1]).text().trim();
        const changeText = $(columns[2]).text().trim();
        
        // Извлечение числового значения индекса
        const currentIndex = parseFloat(currentIndexText.replace('$', '').replace(',', ''));
        
        // Извлечение числового значения изменения
        const changeMatch = changeText.match(/([-+]?\d+(\.\d+)?)/);
        const change = changeMatch ? parseFloat(changeMatch[1]) : 0;
        
        // Добавление данных в массив, если маршрут не пустой и индекс является числом
        if (route && !isNaN(currentIndex)) {
          wciData.push({
            route,
            currentIndex,
            change,
            indexDate
          });
        }
      }
    });
    
    // Если не удалось найти данные в таблице, попробуем другой подход
    if (wciData.length === 0) {
      // Поиск данных в другом формате (например, в виде графика или текста)
      $('.wci-data-point').each((i, point) => {
        const route = $(point).find('.route-name').text().trim();
        const currentIndexText = $(point).find('.index-value').text().trim();
        const currentIndex = parseFloat(currentIndexText.replace('$', '').replace(',', ''));
        const changeText = $(point).find('.change-value').text().trim();
        
        // Извлечение числового значения изменения
        const changeMatch = changeText.match(/([-+]?\d+(\.\d+)?)/);
        const change = changeMatch ? parseFloat(changeMatch[1]) : 0;
        
        // Добавление данных в массив, если маршрут не пустой и индекс является числом
        if (route && !isNaN(currentIndex)) {
          wciData.push({
            route,
            currentIndex,
            change,
            indexDate
          });
        }
      });
    }
    
    console.log(`Parsed ${wciData.length} WCI routes`);
    
    // Сохранение данных в базу данных
    await saveWciData(wciData);
    
    return wciData;
  } catch (error) {
    console.error('Error fetching WCI data:', error);
    throw error;
  }
}

// Функция для сохранения данных WCI в базу данных
async function saveWciData(wciData) {
  const client = await pool.connect();
  
  try {
    // Начало транзакции
    await client.query('BEGIN');
    
    // Создание таблицы, если она не существует
    await client.query(`
      CREATE TABLE IF NOT EXISTS freight_indices_wci (
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
    for (const data of wciData) {
      await client.query(
        `INSERT INTO freight_indices_wci 
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
    
    console.log(`Saved ${wciData.length} WCI records to database`);
  } catch (error) {
    // Откат транзакции в случае ошибки
    await client.query('ROLLBACK');
    console.error('Error saving WCI data to database:', error);
    throw error;
  } finally {
    // Освобождение клиента
    client.release();
  }
}

// Функция для получения данных WCI для конкретного маршрута
async function getWCIDataForRoute(origin, destination) {
  try {
    // Преобразование кодов портов в названия для поиска в данных WCI
    const originName = await getPortNameById(origin);
    const destinationName = await getPortNameById(destination);
    
    // Определение региона порта отправления
    const originRegion = await getPortRegionById(origin);
    
    // Определение региона порта назначения
    const destinationRegion = await getPortRegionById(destination);
    
    // Создание шаблонов поиска маршрута на основе регионов и названий портов
    let routePatterns = [];
    
    // Сопоставление регионов с маршрутами WCI
    // WCI обычно использует названия конкретных портов в своих маршрутах
    routePatterns.push(`%${originName}%${destinationName}%`);
    routePatterns.push(`%${originName} to ${destinationName}%`);
    
    // Добавление шаблонов на основе регионов
    if (originRegion === 'Asia' && destinationRegion === 'Europe') {
      routePatterns.push('%Shanghai to Rotterdam%');
      routePatterns.push('%Shanghai to Genoa%');
    } else if (originRegion === 'Asia' && destinationRegion === 'North America') {
      routePatterns.push('%Shanghai to Los Angeles%');
      routePatterns.push('%Shanghai to New York%');
    } else if (originRegion === 'Europe' && destinationRegion === 'Asia') {
      routePatterns.push('%Rotterdam to Shanghai%');
    } else if (originRegion === 'North America' && destinationRegion === 'Asia') {
      routePatterns.push('%Los Angeles to Shanghai%');
    }
    
    // Поиск подходящего маршрута в данных WCI
    for (const pattern of routePatterns) {
      const query = `
        SELECT * FROM freight_indices_wci 
        WHERE route ILIKE $1 
        ORDER BY index_date DESC 
        LIMIT 1
      `;
      
      const result = await pool.query(query, [pattern]);
      
      if (result.rows.length > 0) {
        return result.rows[0];
      }
    }
    
    // Если точное совпадение не найдено, вернем композитный индекс WCI
    const compositeQuery = `
      SELECT * FROM freight_indices_wci 
      WHERE route ILIKE '%Composite Index%' 
      ORDER BY index_date DESC 
      LIMIT 1
    `;
    
    const compositeResult = await pool.query(compositeQuery);
    
    return compositeResult.rows.length > 0 ? compositeResult.rows[0] : null;
  } catch (error) {
    console.error('Error getting WCI data for route:', error);
    return null;
  }
}

// Вспомогательная функция для получения названия порта по его ID
async function getPortNameById(portId) {
  try {
    const result = await pool.query('SELECT name FROM ports WHERE id = $1', [portId]);
    return result.rows.length > 0 ? result.rows[0].name : portId;
  } catch (error) {
    console.error('Error getting port name:', error);
    return portId;
  }
}

// Вспомогательная функция для получения региона порта по его ID
async function getPortRegionById(portId) {
  try {
    const result = await pool.query('SELECT region FROM ports WHERE id = $1', [portId]);
    return result.rows.length > 0 ? result.rows[0].region : 'Unknown';
  } catch (error) {
    console.error('Error getting port region:', error);
    return 'Unknown';
  }
}

// Вспомогательная функция для преобразования названия месяца в номер
function getMonthNumber(monthName) {
  const months = {
    'january': '01', 'february': '02', 'march': '03', 'april': '04',
    'may': '05', 'june': '06', 'july': '07', 'august': '08',
    'september': '09', 'october': '10', 'november': '11', 'december': '12',
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
    'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
    'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
  };
  
  return months[monthName.toLowerCase()] || '01';
}

// Экспорт функций в формате CommonJS
module.exports = {
  fetchWCIData,
  getWCIDataForRoute
};
