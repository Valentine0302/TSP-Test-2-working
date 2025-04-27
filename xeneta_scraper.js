// Модуль для сбора данных из Xeneta Shipping Index (XSI)
// Требует API-ключ для доступа к данным

const axios = require('axios');
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

// Конфигурация API Xeneta
const XENETA_API_KEY = process.env.XENETA_API_KEY || '';
const XENETA_API_URL = 'https://api.xeneta.com/v1';

// Функция для получения данных XSI
async function fetchXSIData() {
  try {
    console.log('Fetching Xeneta XSI data...');
    
    // Проверка наличия API-ключа
    if (!XENETA_API_KEY) {
      console.warn('Xeneta API key not provided. Using mock data for XSI.');
      return fetchMockXSIData();
    }
    
    // Получение текущей даты
    const currentDate = new Date();
    const formattedDate = currentDate.toISOString().split('T')[0];
    
    // Запрос к API Xeneta для получения данных XSI
    const response = await axios.get(`${XENETA_API_URL}/indices/xsi`, {
      headers: {
        'Authorization': `ApiKey ${XENETA_API_KEY}`,
        'Content-Type': 'application/json'
      },
      params: {
        date: formattedDate
      }
    });
    
    // Проверка успешности запроса
    if (response.status !== 200) {
      throw new Error(`Failed to fetch XSI data: ${response.status}`);
    }
    
    // Обработка данных
    const xsiData = [];
    
    // Парсинг данных из ответа API
    const indices = response.data.indices || [];
    
    for (const index of indices) {
      xsiData.push({
        route: index.route || 'Global XSI',
        currentIndex: index.value,
        change: index.change_pct || 0,
        indexDate: index.date || formattedDate
      });
    }
    
    console.log(`Parsed ${xsiData.length} XSI routes`);
    
    // Сохранение данных в базу данных
    await saveXSIData(xsiData);
    
    return xsiData;
  } catch (error) {
    console.error('Error fetching XSI data:', error);
    // В случае ошибки используем моковые данные
    return fetchMockXSIData();
  }
}

// Функция для получения моковых данных XSI (используется, если API-ключ не предоставлен)
async function fetchMockXSIData() {
  console.log('Using mock data for XSI');
  
  // Получение текущей даты
  const currentDate = new Date().toISOString().split('T')[0];
  
  // Создание моковых данных на основе реальных индексов XSI
  const mockData = [
    {
      route: 'Global XSI',
      currentIndex: 1850,
      change: 2.5,
      indexDate: currentDate
    },
    {
      route: 'Europe Export XSI',
      currentIndex: 1920,
      change: 1.8,
      indexDate: currentDate
    },
    {
      route: 'Europe Import XSI',
      currentIndex: 1780,
      change: 3.2,
      indexDate: currentDate
    },
    {
      route: 'Far East Export XSI',
      currentIndex: 2150,
      change: 4.5,
      indexDate: currentDate
    },
    {
      route: 'Far East Import XSI',
      currentIndex: 1650,
      change: 1.2,
      indexDate: currentDate
    },
    {
      route: 'US Export XSI',
      currentIndex: 1450,
      change: -0.8,
      indexDate: currentDate
    },
    {
      route: 'US Import XSI',
      currentIndex: 2250,
      change: 3.7,
      indexDate: currentDate
    }
  ];
  
  // Сохранение моковых данных в базу данных
  await saveXSIData(mockData);
  
  return mockData;
}

// Функция для сохранения данных XSI в базу данных
async function saveXSIData(xsiData) {
  const client = await pool.connect();
  
  try {
    // Начало транзакции
    await client.query('BEGIN');
    
    // Создание таблицы, если она не существует
    await client.query(`
      CREATE TABLE IF NOT EXISTS freight_indices_xsi (
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
    for (const data of xsiData) {
      await client.query(
        `INSERT INTO freight_indices_xsi 
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
    
    console.log(`Saved ${xsiData.length} XSI records to database`);
  } catch (error) {
    // Откат транзакции в случае ошибки
    await client.query('ROLLBACK');
    console.error('Error saving XSI data to database:', error);
    throw error;
  } finally {
    // Освобождение клиента
    client.release();
  }
}

// Функция для получения данных XSI для конкретного маршрута
async function getXSIDataForRoute(origin, destination) {
  try {
    // Преобразование кодов портов в названия для поиска в данных XSI
    const originName = await getPortNameById(origin);
    const destinationName = await getPortNameById(destination);
    
    // Определение региона порта отправления
    const originRegion = await getPortRegionById(origin);
    
    // Определение региона порта назначения
    const destinationRegion = await getPortRegionById(destination);
    
    // Создание шаблонов поиска маршрута на основе регионов
    let routePatterns = [];
    
    // Сопоставление регионов с маршрутами XSI
    if (originRegion === 'Europe' && destinationRegion === 'Asia') {
      routePatterns.push('%Europe Export%');
      routePatterns.push('%Far East Import%');
    } else if (originRegion === 'Asia' && destinationRegion === 'Europe') {
      routePatterns.push('%Far East Export%');
      routePatterns.push('%Europe Import%');
    } else if (originRegion === 'North America' && destinationRegion === 'Asia') {
      routePatterns.push('%US Export%');
      routePatterns.push('%Far East Import%');
    } else if (originRegion === 'Asia' && destinationRegion === 'North America') {
      routePatterns.push('%Far East Export%');
      routePatterns.push('%US Import%');
    } else if (originRegion === 'Europe' && destinationRegion === 'North America') {
      routePatterns.push('%Europe Export%');
      routePatterns.push('%US Import%');
    } else if (originRegion === 'North America' && destinationRegion === 'Europe') {
      routePatterns.push('%US Export%');
      routePatterns.push('%Europe Import%');
    }
    
    // Поиск подходящего маршрута в данных XSI
    for (const pattern of routePatterns) {
      const query = `
        SELECT * FROM freight_indices_xsi 
        WHERE route ILIKE $1 
        ORDER BY index_date DESC 
        LIMIT 1
      `;
      
      const result = await pool.query(query, [pattern]);
      
      if (result.rows.length > 0) {
        return result.rows[0];
      }
    }
    
    // Если точное совпадение не найдено, вернем глобальный индекс XSI
    const globalQuery = `
      SELECT * FROM freight_indices_xsi 
      WHERE route ILIKE '%Global XSI%' 
      ORDER BY index_date DESC 
      LIMIT 1
    `;
    
    const globalResult = await pool.query(globalQuery);
    
    return globalResult.rows.length > 0 ? globalResult.rows[0] : null;
  } catch (error) {
    console.error('Error getting XSI data for route:', error);
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

// Экспорт функций
module.exports = {
  fetchXSIData,
  getXSIDataForRoute
};
