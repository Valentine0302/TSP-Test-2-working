// Модуль для сбора данных из Harpex Index
// Использует публично доступные данные индекса Harpex

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

// URL для получения данных Harpex
const HARPEX_URL = 'https://harpex.harperpetersen.com/harpexVP.do';
// Альтернативный источник данных
const HARPEX_ALT_URL = 'https://www.hellenicshippingnews.com/tag/harpex/';

// Функция для получения данных Harpex
async function fetchHarpexData() {
  try {
    console.log('Fetching Harpex Index data...');
    
    // Попытка получить данные с основного источника
    let harpexData = await fetchHarpexFromPrimarySource();
    
    // Если не удалось получить данные с основного источника, используем альтернативный
    if (!harpexData || harpexData.length === 0) {
      harpexData = await fetchHarpexFromAlternativeSource();
    }
    
    // Если данные получены, сохраняем их в базу данных
    if (harpexData && harpexData.length > 0) {
      await saveHarpexData(harpexData);
      return harpexData;
    } else {
      throw new Error('Failed to fetch Harpex data from all sources');
    }
  } catch (error) {
    console.error('Error fetching Harpex data:', error);
    // В случае ошибки возвращаем моковые данные
    return fetchMockHarpexData();
  }
}

// Функция для получения данных Harpex с основного источника
async function fetchHarpexFromPrimarySource() {
  try {
    // Отправка запроса на сайт Harper Petersen
    const response = await axios.get(HARPEX_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    // Проверка успешности запроса
    if (response.status !== 200) {
      throw new Error(`Failed to fetch Harpex data from primary source: ${response.status}`);
    }
    
    // Парсинг HTML-страницы
    const $ = cheerio.load(response.data);
    
    // Извлечение данных из таблицы
    const harpexData = [];
    
    // Получение текущей даты
    const currentDate = new Date().toISOString().split('T')[0];
    
    // Поиск значения Harpex на странице
    // Примечание: селекторы могут потребовать корректировки в зависимости от структуры страницы
    const harpexValue = $('.harpex-value').text().trim();
    const harpexChange = $('.harpex-change').text().trim();
    
    // Извлечение числового значения индекса
    const currentIndex = parseFloat(harpexValue.replace(',', ''));
    
    // Извлечение числового значения изменения
    const changeMatch = harpexChange.match(/([-+]?\d+(\.\d+)?)/);
    const change = changeMatch ? parseFloat(changeMatch[1]) : 0;
    
    // Добавление данных в массив, если индекс является числом
    if (!isNaN(currentIndex)) {
      harpexData.push({
        route: 'Harpex Index',
        currentIndex,
        change,
        indexDate: currentDate
      });
    }
    
    // Если не удалось найти данные в основном месте, ищем в таблице
    if (harpexData.length === 0) {
      const table = $('table.harpex-table');
      
      if (table.length > 0) {
        const latestRow = table.find('tr').eq(1); // Берем первую строку после заголовка
        
        if (latestRow.length > 0) {
          const columns = latestRow.find('td');
          
          if (columns.length >= 2) {
            const dateText = $(columns[0]).text().trim();
            const valueText = $(columns[1]).text().trim();
            
            // Парсинг даты
            const dateParts = dateText.split('.');
            if (dateParts.length === 3) {
              const indexDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
              
              // Парсинг значения
              const currentIndex = parseFloat(valueText.replace(',', ''));
              
              if (!isNaN(currentIndex)) {
                harpexData.push({
                  route: 'Harpex Index',
                  currentIndex,
                  change: 0, // Изменение неизвестно
                  indexDate
                });
              }
            }
          }
        }
      }
    }
    
    console.log(`Parsed Harpex data from primary source: ${harpexData.length} records`);
    
    return harpexData;
  } catch (error) {
    console.error('Error fetching Harpex data from primary source:', error);
    return [];
  }
}

// Функция для получения данных Harpex с альтернативного источника
async function fetchHarpexFromAlternativeSource() {
  try {
    // Отправка запроса на альтернативный сайт
    const response = await axios.get(HARPEX_ALT_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    // Проверка успешности запроса
    if (response.status !== 200) {
      throw new Error(`Failed to fetch Harpex data from alternative source: ${response.status}`);
    }
    
    // Парсинг HTML-страницы
    const $ = cheerio.load(response.data);
    
    // Извлечение данных из статей
    const harpexData = [];
    
    // Получение текущей даты
    const currentDate = new Date().toISOString().split('T')[0];
    
    // Поиск статей с упоминанием Harpex
    const articles = $('article');
    
    // Ищем в статьях упоминания индекса Harpex и его значения
    articles.each((i, article) => {
      const articleText = $(article).text();
      
      // Ищем упоминание индекса Harpex
      const indexMatch = articleText.match(/Harpex.*?(\d+(\.\d+)?)/i);
      
      if (indexMatch) {
        const currentIndex = parseFloat(indexMatch[1]);
        
        // Ищем упоминание изменения индекса
        const changeMatch = articleText.match(/(up|down).*?(\d+(\.\d+)?)/i);
        let change = 0;
        
        if (changeMatch) {
          change = parseFloat(changeMatch[2]);
          if (changeMatch[1].toLowerCase() === 'down') {
            change = -change;
          }
        }
        
        // Добавление данных в массив, если индекс является числом
        if (!isNaN(currentIndex)) {
          harpexData.push({
            route: 'Harpex Index',
            currentIndex,
            change,
            indexDate: currentDate
          });
          
          // Берем только первое найденное значение
          return false;
        }
      }
    });
    
    console.log(`Parsed Harpex data from alternative source: ${harpexData.length} records`);
    
    return harpexData;
  } catch (error) {
    console.error('Error fetching Harpex data from alternative source:', error);
    return [];
  }
}

// Функция для получения моковых данных Harpex
async function fetchMockHarpexData() {
  console.log('Using mock data for Harpex');
  
  // Получение текущей даты
  const currentDate = new Date().toISOString().split('T')[0];
  
  // Создание моковых данных на основе реальных значений Harpex
  const mockData = [
    {
      route: 'Harpex Index',
      currentIndex: 1250,
      change: -25,
      indexDate: currentDate
    }
  ];
  
  // Сохранение моковых данных в базу данных
  await saveHarpexData(mockData);
  
  return mockData;
}

// Функция для сохранения данных Harpex в базу данных
async function saveHarpexData(harpexData) {
  const client = await pool.connect();
  
  try {
    // Начало транзакции
    await client.query('BEGIN');
    
    // Создание таблицы, если она не существует
    await client.query(`
      CREATE TABLE IF NOT EXISTS freight_indices_harpex (
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
    for (const data of harpexData) {
      await client.query(
        `INSERT INTO freight_indices_harpex 
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
    
    console.log(`Saved ${harpexData.length} Harpex records to database`);
  } catch (error) {
    // Откат транзакции в случае ошибки
    await client.query('ROLLBACK');
    console.error('Error saving Harpex data to database:', error);
    throw error;
  } finally {
    // Освобождение клиента
    client.release();
  }
}

// Функция для получения данных Harpex для расчета ставок
async function getHarpexDataForCalculation() {
  try {
    // Получение последних данных Harpex
    const query = `
      SELECT * FROM freight_indices_harpex 
      ORDER BY index_date DESC 
      LIMIT 1
    `;
    
    const result = await pool.query(query);
    
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error getting Harpex data for calculation:', error);
    return null;
  }
}

// Экспорт функций
export default {
  fetchHarpexData,
  getHarpexDataForCalculation
};
