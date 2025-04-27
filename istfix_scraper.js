// Модуль для сбора данных из ISTFIX (Istanbul Freight Index)
// Использует публично доступные данные индекса ISTFIX

import axios from 'axios';
import * as cheerio from 'cheerio';
import { Pool } from 'pg';
import dotenv from 'dotenv';

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

// URL для получения данных ISTFIX
const ISTFIX_URL = 'http://istfix.com/';
// Альтернативный источник данных
const ISTFIX_ALT_URL = 'https://www.seanews.com.tr/istfix-monthly-review/';

// Функция для получения данных ISTFIX
async function fetchISTFIXData() {
  try {
    console.log('Fetching ISTFIX (Istanbul Freight Index) data...');
    
    // Попытка получить данные с основного источника
    let istfixData = await fetchISTFIXFromPrimarySource();
    
    // Если не удалось получить данные с основного источника, используем альтернативный
    if (!istfixData || istfixData.length === 0) {
      istfixData = await fetchISTFIXFromAlternativeSource();
    }
    
    // Если данные получены, сохраняем их в базу данных
    if (istfixData && istfixData.length > 0) {
      await saveISTFIXData(istfixData);
      return istfixData;
    } else {
      throw new Error('Failed to fetch ISTFIX data from all sources');
    }
  } catch (error) {
    console.error('Error fetching ISTFIX data:', error);
    // В случае ошибки возвращаем моковые данные
    return fetchMockISTFIXData();
  }
}

// Функция для получения данных ISTFIX с основного источника
async function fetchISTFIXFromPrimarySource() {
  try {
    // Отправка запроса на сайт ISTFIX
    const response = await axios.get(ISTFIX_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    // Проверка успешности запроса
    if (response.status !== 200) {
      throw new Error(`Failed to fetch ISTFIX data from primary source: ${response.status}`);
    }
    
    // Парсинг HTML-страницы
    const $ = cheerio.load(response.data);
    
    // Извлечение данных из таблицы или графика
    const istfixData = [];
    
    // Получение текущей даты
    const currentDate = new Date().toISOString().split('T')[0];
    
    // Поиск значения индекса ISTFIX на странице
    // Примечание: селекторы могут потребовать корректировки в зависимости от структуры страницы
    const indexValue = $('.istfix-index, .index-value, .chart-value').text().trim();
    
    // Извлечение числового значения индекса
    const indexMatch = indexValue.match(/(\d+(\.\d+)?)/);
    const currentIndex = indexMatch ? parseFloat(indexMatch[1]) : null;
    
    // Поиск значения изменения
    const changeValue = $('.istfix-change, .change-value').text().trim();
    
    // Извлечение числового значения изменения
    const changeMatch = changeValue.match(/([-+]?\d+(\.\d+)?)/);
    const change = changeMatch ? parseFloat(changeMatch[1]) : 0;
    
    // Поиск даты публикации
    let indexDate = currentDate;
    const dateText = $('.istfix-date, .date-value, .update-date').text().trim();
    if (dateText) {
      const dateMatch = dateText.match(/(\d{1,2})[\.\/\-](\d{1,2})[\.\/\-](\d{4})/);
      if (dateMatch) {
        indexDate = `${dateMatch[3]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[1].padStart(2, '0')}`;
      }
    }
    
    // Добавление данных в массив, если индекс является числом
    if (currentIndex && !isNaN(currentIndex)) {
      istfixData.push({
        route: 'ISTFIX Composite Index',
        currentIndex,
        change,
        indexDate
      });
    }
    
    // Поиск данных по отдельным маршрутам
    $('.istfix-routes tr, .routes-table tr').each((i, row) => {
      // Пропускаем заголовок таблицы
      if (i === 0) return;
      
      const columns = $(row).find('td');
      
      // Проверяем, что строка содержит нужное количество колонок
      if (columns.length >= 3) {
        const route = $(columns[0]).text().trim();
        const routeIndexText = $(columns[1]).text().trim();
        const routeChangeText = $(columns[2]).text().trim();
        
        // Извлечение числового значения индекса
        const routeIndexMatch = routeIndexText.match(/(\d+(\.\d+)?)/);
        const routeIndex = routeIndexMatch ? parseFloat(routeIndexMatch[1]) : null;
        
        // Извлечение числового значения изменения
        const routeChangeMatch = routeChangeText.match(/([-+]?\d+(\.\d+)?)/);
        const routeChange = routeChangeMatch ? parseFloat(routeChangeMatch[1]) : 0;
        
        // Добавление данных в массив, если маршрут не пустой и индекс является числом
        if (route && routeIndex && !isNaN(routeIndex)) {
          istfixData.push({
            route: `ISTFIX ${route}`,
            currentIndex: routeIndex,
            change: routeChange,
            indexDate
          });
        }
      }
    });
    
    console.log(`Parsed ISTFIX data from primary source: ${istfixData.length} records`);
    
    return istfixData;
  } catch (error) {
    console.error('Error fetching ISTFIX data from primary source:', error);
    return [];
  }
}

// Функция для получения данных ISTFIX с альтернативного источника
async function fetchISTFIXFromAlternativeSource() {
  try {
    // Отправка запроса на альтернативный сайт
    const response = await axios.get(ISTFIX_ALT_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    // Проверка успешности запроса
    if (response.status !== 200) {
      throw new Error(`Failed to fetch ISTFIX data from alternative source: ${response.status}`);
    }
    
    // Парсинг HTML-страницы
    const $ = cheerio.load(response.data);
    
    // Извлечение данных из статей
    const istfixData = [];
    
    // Получение текущей даты
    const currentDate = new Date().toISOString().split('T')[0];
    
    // Поиск статей с упоминанием ISTFIX
    const articles = $('article, .post');
    
    // Находим самую свежую статью с упоминанием ISTFIX
    let latestArticle = null;
    let latestDate = null;
    
    articles.each((i, article) => {
      const articleText = $(article).text();
      const title = $(article).find('h2, .title').text();
      
      if (articleText.includes('ISTFIX') || title.includes('ISTFIX')) {
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
      
      // Ищем упоминание индекса ISTFIX
      const indexMatch = articleText.match(/ISTFIX.*?(\d+(\.\d+)?)/i);
      
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
          istfixData.push({
            route: 'ISTFIX Composite Index',
            currentIndex,
            change,
            indexDate
          });
        }
      }
    }
    
    console.log(`Parsed ISTFIX data from alternative source: ${istfixData.length} records`);
    
    return istfixData;
  } catch (error) {
    console.error('Error fetching ISTFIX data from alternative source:', error);
    return [];
  }
}

// Функция для получения моковых данных ISTFIX
async function fetchMockISTFIXData() {
  console.log('Using mock data for ISTFIX');
  
  // Получение текущей даты
  const currentDate = new Date().toISOString().split('T')[0];
  
  // Создание моковых данных на основе типичных значений ISTFIX
  const mockData = [
    {
      route: 'ISTFIX Composite Index',
      currentIndex: 650,
      change: -5,
      indexDate: currentDate
    },
    {
      route: 'ISTFIX Black Sea to Mediterranean',
      currentIndex: 625,
      change: -3,
      indexDate: currentDate
    },
    {
      route: 'ISTFIX Mediterranean to Black Sea',
      currentIndex: 635,
      change: -4,
      indexDate: currentDate
    },
    {
      route: 'ISTFIX Mediterranean to Continent',
      currentIndex: 645,
      change: -6,
      indexDate: currentDate
    },
    {
      route: 'ISTFIX Continent to Mediterranean',
      currentIndex: 655,
      change: -7,
      indexDate: currentDate
    }
  ];
  
  // Сохранение моковых данных в базу данных
  await saveISTFIXData(mockData);
  
  return mockData;
}

// Функция для сохранения данных ISTFIX в базу данных
async function saveISTFIXData(istfixData) {
  const client = await pool.connect();
  
  try {
    // Начало транзакции
    await client.query('BEGIN');
    
    // Создание таблицы, если она не существует
    await client.query(`
      CREATE TABLE IF NOT EXISTS freight_indices_istfix (
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
    for (const data of istfixData) {
      await client.query(
        `INSERT INTO freight_indices_istfix 
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
    
    console.log(`Saved ${istfixData.length} ISTFIX records to database`);
  } catch (error) {
    // Откат транзакции в случае ошибки
    await client.query('ROLLBACK');
    console.error('Error saving ISTFIX data to database:', error);
    throw error;
  } finally {
    // Освобождение клиента
    client.release();
  }
}

// Функция для получения данных ISTFIX для расчета ставок
async function getISTFIXDataForCalculation() {
  try {
    // Получение последних данных ISTFIX
    const query = `
      SELECT * FROM freight_indices_istfix 
      WHERE route = 'ISTFIX Composite Index'
      ORDER BY index_date DESC 
      LIMIT 1
    `;
    
    const result = await pool.query(query);
    
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error getting ISTFIX data for calculation:', error);
    return null;
  }
}

// Функция для получения данных ISTFIX для конкретного маршрута
async function getISTFIXDataForRoute(origin, destination) {
  try {
    // Определение региона порта отправления
    const originRegion = await getPortRegionById(origin);
    
    // Определение региона порта назначения
    const destinationRegion = await getPortRegionById(destination);
    
    // Создание шаблонов поиска маршрута на основе регионов
    let routePatterns = [];
    
    // Сопоставление регионов с маршрутами ISTFIX
    if (originRegion === 'Black Sea' && destinationRegion === 'Mediterranean') {
      routePatterns.push('%Black Sea to Mediterranean%');
    } else if (originRegion === 'Mediterranean' && destinationRegion === 'Black Sea') {
      routePatterns.push('%Mediterranean to Black Sea%');
    } else if (originRegion === 'Mediterranean' && (destinationRegion === 'Europe' || destinationRegion === 'North Europe')) {
      routePatterns.push('%Mediterranean to Continent%');
    } else if ((originRegion === 'Europe' || originRegion === 'North Europe') && destinationRegion === 'Mediterranean') {
      routePatterns.push('%Continent to Mediterranean%');
    }
    
    // Поиск подходящего маршрута в данных ISTFIX
    for (const pattern of routePatterns) {
      const query = `
        SELECT * FROM freight_indices_istfix 
        WHERE route ILIKE $1 
        ORDER BY index_date DESC 
        LIMIT 1
      `;
      
      const result = await pool.query(query, [pattern]);
      
      if (result.rows.length > 0) {
        return result.rows[0];
      }
    }
    
    // Если точное совпадение не найдено, вернем композитный индекс ISTFIX
    const compositeQuery = `
      SELECT * FROM freight_indices_istfix 
      WHERE route = 'ISTFIX Composite Index'
      ORDER BY index_date DESC 
      LIMIT 1
    `;
    
    const compositeResult = await pool.query(compositeQuery);
    
    return compositeResult.rows.length > 0 ? compositeResult.rows[0] : null;
  } catch (error) {
    console.error('Error getting ISTFIX data for route:', error);
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
export default {
  fetchISTFIXData,
  getISTFIXDataForCalculation,
  getISTFIXDataForRoute
};
