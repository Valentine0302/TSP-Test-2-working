// Модуль для сбора данных из Freightos Baltic Index (FBX)
// Использует публично доступные данные индекса FBX

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

// URL для получения данных FBX
const FBX_URL = 'https://fbx.freightos.com/';

// Функция для получения данных FBX
async function fetchFBXData() {
  try {
    console.log('Fetching FBX data...');
    
    // Отправка запроса на сайт Freightos
    const response = await axios.get(FBX_URL);
    
    // Проверка успешности запроса
    if (response.status !== 200) {
      throw new Error(`Failed to fetch FBX data: ${response.status}`);
    }
    
    // Парсинг HTML-страницы
    const $ = cheerio.load(response.data);
    
    // Извлечение данных из таблицы
    const fbxData = [];
    
    // Получение текущей даты
    const currentDate = new Date().toISOString().split('T')[0];
    
    // Парсинг данных индекса
    // Примечание: селекторы могут потребовать корректировки в зависимости от структуры страницы
    $('.fbx-index-table tbody tr').each((i, row) => {
      const route = $(row).find('td:nth-child(1)').text().trim();
      const currentIndex = parseFloat($(row).find('td:nth-child(2)').text().replace('$', '').replace(',', '').trim());
      const weeklyChange = $(row).find('td:nth-child(3)').text().trim();
      
      // Извлечение числового значения изменения
      const changeMatch = weeklyChange.match(/([-+]?\d+(\.\d+)?)/);
      const change = changeMatch ? parseFloat(changeMatch[1]) : 0;
      
      // Добавление данных в массив, если маршрут не пустой и индекс является числом
      if (route && !isNaN(currentIndex)) {
        fbxData.push({
          route,
          currentIndex,
          change,
          indexDate: currentDate
        });
      }
    });
    
    // Если не удалось найти данные в таблице, попробуем другой подход
    if (fbxData.length === 0) {
      // Поиск данных в другом формате (например, в виде карточек или блоков)
      $('.fbx-index-card').each((i, card) => {
        const route = $(card).find('.route-name').text().trim();
        const currentIndexText = $(card).find('.index-value').text().trim();
        const currentIndex = parseFloat(currentIndexText.replace('$', '').replace(',', ''));
        const changeText = $(card).find('.change-value').text().trim();
        
        // Извлечение числового значения изменения
        const changeMatch = changeText.match(/([-+]?\d+(\.\d+)?)/);
        const change = changeMatch ? parseFloat(changeMatch[1]) : 0;
        
        // Добавление данных в массив, если маршрут не пустой и индекс является числом
        if (route && !isNaN(currentIndex)) {
          fbxData.push({
            route,
            currentIndex,
            change,
            indexDate: currentDate
          });
        }
      });
    }
    
    console.log(`Parsed ${fbxData.length} FBX routes`);
    
    // Сохранение данных в базу данных
    await saveFbxData(fbxData);
    
    return fbxData;
  } catch (error) {
    console.error('Error fetching FBX data:', error);
    throw error;
  }
}

// Функция для сохранения данных FBX в базу данных
async function saveFbxData(fbxData) {
  const client = await pool.connect();
  
  try {
    // Начало транзакции
    await client.query('BEGIN');
    
    // Создание таблицы, если она не существует
    await client.query(`
      CREATE TABLE IF NOT EXISTS freight_indices_fbx (
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
    for (const data of fbxData) {
      await client.query(
        `INSERT INTO freight_indices_fbx 
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
    
    console.log(`Saved ${fbxData.length} FBX records to database`);
  } catch (error) {
    // Откат транзакции в случае ошибки
    await client.query('ROLLBACK');
    console.error('Error saving FBX data to database:', error);
    throw error;
  } finally {
    // Освобождение клиента
    client.release();
  }
}

// Функция для получения данных FBX для конкретного маршрута
async function getFBXDataForRoute(origin, destination) {
  try {
    // Преобразование кодов портов в названия для поиска в данных FBX
    const originName = await getPortNameById(origin);
    const destinationName = await getPortNameById(destination);
    
    // Определение региона порта отправления
    const originRegion = await getPortRegionById(origin);
    
    // Определение региона порта назначения
    const destinationRegion = await getPortRegionById(destination);
    
    // Создание шаблонов поиска маршрута на основе регионов
    let routePatterns = [];
    
    // Сопоставление регионов с маршрутами FBX
    if (originRegion === 'Asia' && destinationRegion === 'North America') {
      routePatterns.push('%China/East Asia to North America West Coast%');
      routePatterns.push('%China/East Asia to North America East Coast%');
    } else if (originRegion === 'Asia' && destinationRegion === 'Europe') {
      routePatterns.push('%China/East Asia to North Europe%');
      routePatterns.push('%China/East Asia to Mediterranean%');
    } else if (originRegion === 'Europe' && destinationRegion === 'North America') {
      routePatterns.push('%North Europe to North America East Coast%');
    } else {
      // Общий шаблон на основе названий портов
      routePatterns.push(`%${originName}%${destinationName}%`);
      routePatterns.push(`%${originRegion}%${destinationRegion}%`);
    }
    
    // Поиск подходящего маршрута в данных FBX
    for (const pattern of routePatterns) {
      const query = `
        SELECT * FROM freight_indices_fbx 
        WHERE route ILIKE $1 
        ORDER BY index_date DESC 
        LIMIT 1
      `;
      
      const result = await pool.query(query, [pattern]);
      
      if (result.rows.length > 0) {
        return result.rows[0];
      }
    }
    
    // Если точное совпадение не найдено, вернем глобальный индекс FBX
    const globalQuery = `
      SELECT * FROM freight_indices_fbx 
      WHERE route ILIKE '%Global Container Index%' 
      ORDER BY index_date DESC 
      LIMIT 1
    `;
    
    const globalResult = await pool.query(globalQuery);
    
    return globalResult.rows.length > 0 ? globalResult.rows[0] : null;
  } catch (error) {
    console.error('Error getting FBX data for route:', error);
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

// Экспорт функций в формате CommonJS
module.exports = {
  fetchFBXData,
  getFBXDataForRoute
};
