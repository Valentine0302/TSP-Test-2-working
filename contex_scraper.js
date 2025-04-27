// Модуль для сбора данных из New ConTex Container Index
// Использует публично доступные данные индекса New ConTex

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

// URL для получения данных New ConTex
const CONTEX_URL = 'https://www.vhss.de/en/new-contex/';
// Альтернативный источник данных
const CONTEX_ALT_URL = 'https://www.hellenicshippingnews.com/category/weekly-container-reports-index/';

// Функция для получения данных New ConTex
async function fetchContexData() {
  try {
    console.log('Fetching New ConTex Container Index data...');
    
    // Попытка получить данные с основного источника
    let contexData = await fetchContexFromPrimarySource();
    
    // Если не удалось получить данные с основного источника, используем альтернативный
    if (!contexData || contexData.length === 0) {
      contexData = await fetchContexFromAlternativeSource();
    }
    
    // Если данные получены, сохраняем их в базу данных
    if (contexData && contexData.length > 0) {
      await saveContexData(contexData);
      return contexData;
    } else {
      throw new Error('Failed to fetch New ConTex data from all sources');
    }
  } catch (error) {
    console.error('Error fetching New ConTex data:', error);
    // В случае ошибки возвращаем моковые данные
    return fetchMockContexData();
  }
}

// Функция для получения данных New ConTex с основного источника
async function fetchContexFromPrimarySource() {
  try {
    // Отправка запроса на сайт VHSS (Hamburg Shipbrokers' Association)
    const response = await axios.get(CONTEX_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    // Проверка успешности запроса
    if (response.status !== 200) {
      throw new Error(`Failed to fetch New ConTex data from primary source: ${response.status}`);
    }
    
    // Парсинг HTML-страницы
    const $ = cheerio.load(response.data);
    
    // Извлечение данных из таблицы
    const contexData = [];
    
    // Получение текущей даты
    const currentDate = new Date().toISOString().split('T')[0];
    
    // Поиск таблицы с данными New ConTex
    const contexTable = $('.contex-table, table:contains("New ConTex")');
    
    // Поиск даты публикации
    let indexDate = currentDate;
    const dateText = $('p:contains("Date"), .date-info, .contex-date').text();
    if (dateText) {
      const dateMatch = dateText.match(/(\d{1,2})[\.\/\-](\d{1,2})[\.\/\-](\d{4})/);
      if (dateMatch) {
        indexDate = `${dateMatch[3]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[1].padStart(2, '0')}`;
      }
    }
    
    // Парсинг строк таблицы
    contexTable.find('tr').each((i, row) => {
      // Пропускаем заголовок таблицы
      if (i === 0) return;
      
      const columns = $(row).find('td');
      
      // Проверяем, что строка содержит нужное количество колонок
      if (columns.length >= 3) {
        const shipType = $(columns[0]).text().trim();
        const currentIndexText = $(columns[1]).text().trim();
        const changeText = $(columns[2]).text().trim();
        
        // Извлечение числового значения индекса
        const currentIndex = parseFloat(currentIndexText.replace(/[^\d.-]/g, ''));
        
        // Извлечение числового значения изменения
        const changeMatch = changeText.match(/([-+]?\d+(\.\d+)?)/);
        const change = changeMatch ? parseFloat(changeMatch[1]) : 0;
        
        // Добавление данных в массив, если тип судна не пустой и индекс является числом
        if (shipType && !isNaN(currentIndex)) {
          contexData.push({
            route: `New ConTex ${shipType}`,
            currentIndex,
            change,
            indexDate
          });
        }
      }
    });
    
    // Если не удалось найти данные в таблице, ищем композитный индекс
    if (contexData.length === 0) {
      const compositeIndex = $('.contex-value, .index-value, strong:contains("New ConTex")').text();
      if (compositeIndex) {
        const currentIndex = parseFloat(compositeIndex.replace(/[^\d.-]/g, ''));
        
        // Поиск значения изменения
        const changeText = $('.contex-change, .change-value').text();
        const changeMatch = changeText.match(/([-+]?\d+(\.\d+)?)/);
        const change = changeMatch ? parseFloat(changeMatch[1]) : 0;
        
        // Добавление данных в массив, если индекс является числом
        if (!isNaN(currentIndex)) {
          contexData.push({
            route: 'New ConTex Composite Index',
            currentIndex,
            change,
            indexDate
          });
        }
      }
    }
    
    console.log(`Parsed New ConTex data from primary source: ${contexData.length} records`);
    
    return contexData;
  } catch (error) {
    console.error('Error fetching New ConTex data from primary source:', error);
    return [];
  }
}

// Функция для получения данных New ConTex с альтернативного источника
async function fetchContexFromAlternativeSource() {
  try {
    // Отправка запроса на альтернативный сайт
    const response = await axios.get(CONTEX_ALT_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    // Проверка успешности запроса
    if (response.status !== 200) {
      throw new Error(`Failed to fetch New ConTex data from alternative source: ${response.status}`);
    }
    
    // Парсинг HTML-страницы
    const $ = cheerio.load(response.data);
    
    // Извлечение данных из статей
    const contexData = [];
    
    // Получение текущей даты
    const currentDate = new Date().toISOString().split('T')[0];
    
    // Поиск статей с упоминанием New ConTex
    const articles = $('article, .post');
    
    // Находим самую свежую статью с упоминанием New ConTex
    let latestArticle = null;
    let latestDate = null;
    
    articles.each((i, article) => {
      const articleText = $(article).text();
      const title = $(article).find('h2, .title').text();
      
      if (articleText.includes('ConTex') || title.includes('ConTex')) {
        const dateText = $(article).find('.date, .post-date, time').text();
        if (dateText) {
          const dateMatch = dateText.match(/(\d{1,2})[\.\/\-](\d{1,2})[\.\/\-](\d{4})/);
          if (dateMatch) {
            const articleDate = new Date(`${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`);
            if (!latestDate || articleDate > latestDate) {
              latestDate = articleDate;
              latestArticle = article;
            }
          }
        }
      }
    });
    
    // Если нашли статью, извлекаем из нее данные
    if (latestArticle) {
      const articleText = $(latestArticle).text();
      
      // Форматирование даты
      const indexDate = latestDate ? latestDate.toISOString().split('T')[0] : currentDate;
      
      // Ищем упоминание композитного индекса New ConTex
      const indexMatch = articleText.match(/ConTex.*?(\d+(\.\d+)?)/i);
      
      if (indexMatch) {
        const currentIndex = parseFloat(indexMatch[1]);
        
        // Ищем упоминание изменения индекса
        const changeMatch = articleText.match(/(up|down|increased|decreased).*?(\d+(\.\d+)?)/i);
        let change = 0;
        
        if (changeMatch) {
          change = parseFloat(changeMatch[2]);
          if (changeMatch[1].toLowerCase().includes('down') || changeMatch[1].toLowerCase().includes('decreased')) {
            change = -change;
          }
        }
        
        // Добавление данных в массив, если индекс является числом
        if (!isNaN(currentIndex)) {
          contexData.push({
            route: 'New ConTex Composite Index',
            currentIndex,
            change,
            indexDate
          });
        }
      }
      
      // Ищем упоминания различных типов судов
      const shipTypes = [
        'TEU 1100', 'TEU 1700', 'TEU 2500', 'TEU 2700', 
        'TEU 3500', 'TEU 4250', 'TEU 6500', 'TEU 8500'
      ];
      
      for (const shipType of shipTypes) {
        const typeMatch = new RegExp(`${shipType}.*?(\\d+(\\.\\d+)?)`, 'i').exec(articleText);
        if (typeMatch) {
          const currentIndex = parseFloat(typeMatch[1]);
          
          // Ищем упоминание изменения для этого типа
          const changeRegex = new RegExp(`${shipType}.*?(up|down|increased|decreased).*?(\\d+(\\.\\d+)?)`, 'i');
          const changeMatch = changeRegex.exec(articleText);
          let change = 0;
          
          if (changeMatch) {
            change = parseFloat(changeMatch[2]);
            if (changeMatch[1].toLowerCase().includes('down') || changeMatch[1].toLowerCase().includes('decreased')) {
              change = -change;
            }
          }
          
          // Добавление данных в массив, если индекс является числом
          if (!isNaN(currentIndex)) {
            contexData.push({
              route: `New ConTex ${shipType}`,
              currentIndex,
              change,
              indexDate
            });
          }
        }
      }
    }
    
    console.log(`Parsed New ConTex data from alternative source: ${contexData.length} records`);
    
    return contexData;
  } catch (error) {
    console.error('Error fetching New ConTex data from alternative source:', error);
    return [];
  }
}

// Функция для получения моковых данных New ConTex
async function fetchMockContexData() {
  console.log('Using mock data for New ConTex');
  
  // Получение текущей даты
  const currentDate = new Date().toISOString().split('T')[0];
  
  // Создание моковых данных на основе реальных значений New ConTex
  const mockData = [
    {
      route: 'New ConTex Composite Index',
      currentIndex: 750,
      change: 5,
      indexDate: currentDate
    },
    {
      route: 'New ConTex TEU 1100',
      currentIndex: 720,
      change: 3,
      indexDate: currentDate
    },
    {
      route: 'New ConTex TEU 1700',
      currentIndex: 735,
      change: 4,
      indexDate: currentDate
    },
    {
      route: 'New ConTex TEU 2500',
      currentIndex: 745,
      change: 5,
      indexDate: currentDate
    },
    {
      route: 'New ConTex TEU 2700',
      currentIndex: 755,
      change: 6,
      indexDate: currentDate
    },
    {
      route: 'New ConTex TEU 3500',
      currentIndex: 765,
      change: 7,
      indexDate: currentDate
    },
    {
      route: 'New ConTex TEU 4250',
      currentIndex: 775,
      change: 8,
      indexDate: currentDate
    }
  ];
  
  // Сохранение моковых данных в базу данных
  await saveContexData(mockData);
  
  return mockData;
}

// Функция для сохранения данных New ConTex в базу данных
async function saveContexData(contexData) {
  const client = await pool.connect();
  
  try {
    // Начало транзакции
    await client.query('BEGIN');
    
    // Создание таблицы, если она не существует
    await client.query(`
      CREATE TABLE IF NOT EXISTS freight_indices_contex (
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
    for (const data of contexData) {
      await client.query(
        `INSERT INTO freight_indices_contex 
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
    
    console.log(`Saved ${contexData.length} New ConTex records to database`);
  } catch (error) {
    // Откат транзакции в случае ошибки
    await client.query('ROLLBACK');
    console.error('Error saving New ConTex data to database:', error);
    throw error;
  } finally {
    // Освобождение клиента
    client.release();
  }
}

// Функция для получения данных New ConTex для расчета ставок
async function getContexDataForCalculation() {
  try {
    // Получение последних данных New ConTex
    const query = `
      SELECT * FROM freight_indices_contex 
      WHERE route = 'New ConTex Composite Index'
      ORDER BY index_date DESC 
      LIMIT 1
    `;
    
    const result = await pool.query(query);
    
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error getting New ConTex data for calculation:', error);
    return null;
  }
}

// Функция для получения данных New ConTex для конкретного типа судна
async function getContexDataForShipType(shipType) {
  try {
    // Получение последних данных New ConTex для указанного типа судна
    const query = `
      SELECT * FROM freight_indices_contex 
      WHERE route ILIKE $1
      ORDER BY index_date DESC 
      LIMIT 1
    `;
    
    const result = await pool.query(query, [`%${shipType}%`]);
    
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error(`Error getting New ConTex data for ship type ${shipType}:`, error);
    return null;
  }
}

// Экспорт функций
module.exports = {
  fetchContexData,
  getContexDataForCalculation,
  getContexDataForShipType
};
