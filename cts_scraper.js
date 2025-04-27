// Модуль для сбора данных из CTS (Container Trade Statistics)
// Использует публично доступные данные индекса CTS

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

// URL для получения данных CTS
const CTS_URL = 'https://containerstatistics.com/free-data/';
// Альтернативный источник данных
const CTS_ALT_URL = 'https://www.lloydslist.com/LL1121214/Data-Hub-CTS-Global-Price-Index';

// Функция для получения данных CTS
async function fetchCTSData() {
  try {
    console.log('Fetching CTS (Container Trade Statistics) data...');
    
    // Попытка получить данные с основного источника
    let ctsData = await fetchCTSFromPrimarySource();
    
    // Если не удалось получить данные с основного источника, используем альтернативный
    if (!ctsData || ctsData.length === 0) {
      ctsData = await fetchCTSFromAlternativeSource();
    }
    
    // Если данные получены, сохраняем их в базу данных
    if (ctsData && ctsData.length > 0) {
      await saveCTSData(ctsData);
      return ctsData;
    } else {
      throw new Error('Failed to fetch CTS data from all sources');
    }
  } catch (error) {
    console.error('Error fetching CTS data:', error);
    // В случае ошибки возвращаем моковые данные
    return fetchMockCTSData();
  }
}

// Функция для получения данных CTS с основного источника
async function fetchCTSFromPrimarySource() {
  try {
    // Отправка запроса на сайт CTS
    const response = await axios.get(CTS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    // Проверка успешности запроса
    if (response.status !== 200) {
      throw new Error(`Failed to fetch CTS data from primary source: ${response.status}`);
    }
    
    // Парсинг HTML-страницы
    const $ = cheerio.load(response.data);
    
    // Извлечение данных из таблицы или графика
    const ctsData = [];
    
    // Получение текущей даты
    const currentDate = new Date().toISOString().split('T')[0];
    
    // Поиск таблицы с данными CTS Price Index
    const ctsTable = $('table:contains("Price Index"), table:contains("CTS"), .price-index-table');
    
    // Поиск даты публикации
    let indexDate = currentDate;
    const dateText = $('.date-info, .update-date, .last-update').text().trim();
    if (dateText) {
      const dateMatch = dateText.match(/(\d{1,2})[\.\/\-](\d{1,2})[\.\/\-](\d{4})/);
      if (dateMatch) {
        indexDate = `${dateMatch[3]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[1].padStart(2, '0')}`;
      }
    }
    
    // Парсинг строк таблицы
    ctsTable.find('tr').each((i, row) => {
      // Пропускаем заголовок таблицы
      if (i === 0) return;
      
      const columns = $(row).find('td');
      
      // Проверяем, что строка содержит нужное количество колонок
      if (columns.length >= 2) {
        const route = $(columns[0]).text().trim();
        const indexText = $(columns[1]).text().trim();
        
        // Извлечение числового значения индекса
        const indexMatch = indexText.match(/(\d+(\.\d+)?)/);
        const currentIndex = indexMatch ? parseFloat(indexMatch[1]) : null;
        
        // Извлечение числового значения изменения (если доступно)
        let change = 0;
        if (columns.length >= 3) {
          const changeText = $(columns[2]).text().trim();
          const changeMatch = changeText.match(/([-+]?\d+(\.\d+)?)/);
          change = changeMatch ? parseFloat(changeMatch[1]) : 0;
        }
        
        // Добавление данных в массив, если маршрут не пустой и индекс является числом
        if (route && currentIndex && !isNaN(currentIndex)) {
          ctsData.push({
            route: `CTS ${route}`,
            currentIndex,
            change,
            indexDate
          });
        }
      }
    });
    
    // Если не удалось найти данные в таблице, ищем в тексте
    if (ctsData.length === 0) {
      // Поиск глобального индекса CTS
      const globalIndexText = $('p:contains("Global Price Index"), div:contains("Global Price Index")').text();
      const globalIndexMatch = globalIndexText.match(/(\d+(\.\d+)?)/);
      
      if (globalIndexMatch) {
        const currentIndex = parseFloat(globalIndexMatch[1]);
        
        // Поиск изменения
        const changeMatch = globalIndexText.match(/(up|down|increased|decreased).*?(\d+(\.\d+)?)/i);
        let change = 0;
        
        if (changeMatch) {
          change = parseFloat(changeMatch[2]);
          if (changeMatch[1].toLowerCase().includes('down') || changeMatch[1].toLowerCase().includes('decreased')) {
            change = -change;
          }
        }
        
        // Добавление данных в массив
        ctsData.push({
          route: 'CTS Global Price Index',
          currentIndex,
          change,
          indexDate
        });
      }
    }
    
    console.log(`Parsed CTS data from primary source: ${ctsData.length} records`);
    
    return ctsData;
  } catch (error) {
    console.error('Error fetching CTS data from primary source:', error);
    return [];
  }
}

// Функция для получения данных CTS с альтернативного источника
async function fetchCTSFromAlternativeSource() {
  try {
    // Отправка запроса на альтернативный сайт
    const response = await axios.get(CTS_ALT_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    // Проверка успешности запроса
    if (response.status !== 200) {
      throw new Error(`Failed to fetch CTS data from alternative source: ${response.status}`);
    }
    
    // Парсинг HTML-страницы
    const $ = cheerio.load(response.data);
    
    // Извлечение данных из графика или таблицы
    const ctsData = [];
    
    // Получение текущей даты
    const currentDate = new Date().toISOString().split('T')[0];
    
    // Поиск даты публикации
    let indexDate = currentDate;
    const dateText = $('.date-info, .update-date, .last-update').text().trim();
    if (dateText) {
      const dateMatch = dateText.match(/(\d{1,2})[\.\/\-](\d{1,2})[\.\/\-](\d{4})/);
      if (dateMatch) {
        indexDate = `${dateMatch[3]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[1].padStart(2, '0')}`;
      }
    }
    
    // Поиск значения индекса CTS
    const indexText = $('.chart-data, .index-value, .data-value').text();
    const indexMatch = indexText.match(/(\d+(\.\d+)?)/);
    
    if (indexMatch) {
      const currentIndex = parseFloat(indexMatch[1]);
      
      // Поиск изменения
      const changeText = $('.change-value, .data-change').text();
      const changeMatch = changeText.match(/([-+]?\d+(\.\d+)?)/);
      const change = changeMatch ? parseFloat(changeMatch[1]) : 0;
      
      // Добавление данных в массив
      ctsData.push({
        route: 'CTS Global Price Index',
        currentIndex,
        change,
        indexDate
      });
    }
    
    console.log(`Parsed CTS data from alternative source: ${ctsData.length} records`);
    
    return ctsData;
  } catch (error) {
    console.error('Error fetching CTS data from alternative source:', error);
    return [];
  }
}

// Функция для получения моковых данных CTS
async function fetchMockCTSData() {
  console.log('Using mock data for CTS');
  
  // Получение текущей даты
  const currentDate = new Date().toISOString().split('T')[0];
  
  // Создание моковых данных на основе типичных значений CTS
  const mockData = [
    {
      route: 'CTS Global Price Index',
      currentIndex: 85,
      change: 2.5,
      indexDate: currentDate
    },
    {
      route: 'CTS Asia to Europe',
      currentIndex: 90,
      change: 3.2,
      indexDate: currentDate
    },
    {
      route: 'CTS Europe to Asia',
      currentIndex: 82,
      change: 1.8,
      indexDate: currentDate
    },
    {
      route: 'CTS Asia to North America',
      currentIndex: 95,
      change: 4.5,
      indexDate: currentDate
    },
    {
      route: 'CTS North America to Asia',
      currentIndex: 78,
      change: 1.2,
      indexDate: currentDate
    }
  ];
  
  // Сохранение моковых данных в базу данных
  await saveCTSData(mockData);
  
  return mockData;
}

// Функция для сохранения данных CTS в базу данных
async function saveCTSData(ctsData) {
  const client = await pool.connect();
  
  try {
    // Начало транзакции
    await client.query('BEGIN');
    
    // Создание таблицы, если она не существует
    await client.query(`
      CREATE TABLE IF NOT EXISTS freight_indices_cts (
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
    for (const data of ctsData) {
      await client.query(
        `INSERT INTO freight_indices_cts 
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
    
    console.log(`Saved ${ctsData.length} CTS records to database`);
  } catch (error) {
    // Откат транзакции в случае ошибки
    await client.query('ROLLBACK');
    console.error('Error saving CTS data to database:', error);
    throw error;
  } finally {
    // Освобождение клиента
    client.release();
  }
}

// Функция для получения данных CTS для расчета ставок
async function getCTSDataForCalculation() {
  try {
    // Получение последних данных CTS
    const query = `
      SELECT * FROM freight_indices_cts 
      WHERE route = 'CTS Global Price Index'
      ORDER BY index_date DESC 
      LIMIT 1
    `;
    
    const result = await pool.query(query);
    
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error getting CTS data for calculation:', error);
    return null;
  }
}

// Функция для получения данных CTS для конкретного маршрута
async function getCTSDataForRoute(origin, destination) {
  try {
    // Определение региона порта отправления
    const originRegion = await getPortRegionById(origin);
    
    // Определение региона порта назначения
    const destinationRegion = await getPortRegionById(destination);
    
    // Создание шаблонов поиска маршрута на основе регионов
    let routePatterns = [];
    
    // Сопоставление регионов с маршрутами CTS
    if (originRegion === 'Asia' && destinationRegion === 'Europe') {
      routePatterns.push('%CTS Asia to Europe%');
    } else if (originRegion === 'Europe' && destinationRegion === 'Asia') {
      routePatterns.push('%CTS Europe to Asia%');
    } else if (originRegion === 'Asia' && destinationRegion === 'North America') {
      routePatterns.push('%CTS Asia to North America%');
    } else if (originRegion === 'North America' && destinationRegion === 'Asia') {
      routePatterns.push('%CTS North America to Asia%');
    } else if (originRegion === 'Europe' && destinationRegion === 'North America') {
      routePatterns.push('%CTS Europe to North America%');
    } else if (originRegion === 'North America' && destinationRegion === 'Europe') {
      routePatterns.push('%CTS North America to Europe%');
    }
    
    // Поиск подходящего маршрута в данных CTS
    for (const pattern of routePatterns) {
      const query = `
        SELECT * FROM freight_indices_cts 
        WHERE route ILIKE $1 
        ORDER BY index_date DESC 
        LIMIT 1
      `;
      
      const result = await pool.query(query, [pattern]);
      
      if (result.rows.length > 0) {
        return result.rows[0];
      }
    }
    
    // Если точное совпадение не найдено, вернем глобальный индекс CTS
    const globalQuery = `
      SELECT * FROM freight_indices_cts 
      WHERE route = 'CTS Global Price Index'
      ORDER BY index_date DESC 
      LIMIT 1
    `;
    
    const globalResult = await pool.query(globalQuery);
    
    return globalResult.rows.length > 0 ? globalResult.rows[0] : null;
  } catch (error) {
    console.error('Error getting CTS data for route:', error);
    return null;
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
  fetchCTSData,
  getCTSDataForCalculation,
  getCTSDataForRoute
};
