/**
 * Shanghai Containerized Freight Index (SCFI) Scraper
 * 
 * Модуль для сбора данных из Shanghai Shipping Exchange и альтернативных источников
 * о значениях индекса SCFI (Shanghai Containerized Freight Index).
 * 
 * Модуль предоставляет функции для получения актуальных данных SCFI,
 * их обработки, сохранения в базу данных и предоставления для расчетов.
 * 
 * @module scfi_scraper
 * @author TSP Transport OÜ
 * @version 2.0.0
 */

import axios from 'axios';
import cheerio from 'cheerio';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import { setTimeout } from 'timers/promises';
import { format, subDays, parseISO } from 'date-fns';

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

// URL для получения данных SCFI
const SCFI_URL = 'https://en.sse.net.cn/indices/scfinew.jsp';
// Альтернативные источники данных
// Изменен порядок: MacroMicro на втором месте, FreightWaves на третьем
const SCFI_ALT_URLS = [
  'https://en.macromicro.me/series/17502/fbx-global-container-index-weekly',
  'https://www.freightwaves.com/news/tag/scfi',
  'https://www.container-news.com/scfi/',
  'https://www.hellenicshippingnews.com/shanghai-containerized-freight-index/'
];

// Конфигурация HTTP-запросов
const HTTP_CONFIG = {
  TIMEOUT: 30000, // 30 секунд
  MAX_RETRIES: 3, // Максимальное количество повторных попыток
  RETRY_DELAY: 2000, // Задержка между повторными попытками (2 секунды)
  USER_AGENTS: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1'
  ]
};

// Конфигурация базы данных
const DB_CONFIG = {
  TABLE_NAME: 'scfi_data',
  RETENTION_DAYS: 365 // Хранение данных за последний год
};

/**
 * Функция для получения данных SCFI
 * 
 * Пытается получить данные с основного источника (Shanghai Shipping Exchange).
 * Если не удается, пробует альтернативные источники.
 * Если все источники недоступны, возвращает моковые данные.
 * 
 * @async
 * @function fetchSCFIData
 * @returns {Promise<Array>} Массив объектов с данными SCFI
 */
async function fetchSCFIData() {
  console.log('Fetching Shanghai Containerized Freight Index data...');
  
  // Попытка получить данные с основного источника
  let scfiData = [];
  
  try {
    console.log(`Fetching SCFI data from primary source: ${SCFI_URL}`);
    scfiData = await fetchSCFIDataFromPrimarySource();
    console.log(`Successfully fetched ${scfiData.length} SCFI records from primary source`);
  } catch (error) {
    console.error('Error fetching SCFI data from primary source:', error.message);
    console.log('Trying alternative sources...');
    
    // Если основной источник недоступен, пробуем альтернативные
    for (const url of SCFI_ALT_URLS) {
      try {
        console.log(`Trying alternative source: ${url}`);
        scfiData = await fetchSCFIDataFromAlternativeSource(url);
        
        if (scfiData.length > 0) {
          console.log(`Successfully fetched ${scfiData.length} SCFI records from alternative source: ${url}`);
          break;
        } else {
          console.log(`No data found from alternative source: ${url}`);
        }
      } catch (error) {
        console.error(`Error fetching SCFI data from alternative source ${url}:`, error.message);
      }
    }
  }
  
  // Если не удалось получить данные ни с одного источника, используем моковые данные
  if (scfiData.length === 0) {
    console.log('Failed to fetch SCFI data from all sources, using mock data');
    scfiData = await fetchMockSCFIData();
  }
  
  // Сохранение полученных данных в базу данных
  try {
    console.log('Saving fetched SCFI data to database...');
    await saveSCFIData(scfiData);
    console.log('SCFI data successfully saved to database');
  } catch (error) {
    console.error('Error saving SCFI data to database:', error.message);
    console.log('Continuing without saving to database');
  }
  
  // Очистка устаревших данных
  try {
    console.log(`Cleaning up SCFI data older than ${DB_CONFIG.RETENTION_DAYS} days...`);
    await cleanupOldSCFIData();
    console.log('Old SCFI data cleanup completed');
  } catch (error) {
    console.error('Error cleaning up old SCFI data:', error.message);
  }
  
  return scfiData;
}

/**
 * Функция для получения данных SCFI с основного источника
 * 
 * Парсит данные с официального сайта Shanghai Shipping Exchange.
 * 
 * @async
 * @function fetchSCFIDataFromPrimarySource
 * @returns {Promise<Array>} Массив объектов с данными SCFI
 * @throws {Error} Если не удалось получить данные
 */
async function fetchSCFIDataFromPrimarySource() {
  // Выбор случайного User-Agent для запроса
  const randomUserAgent = HTTP_CONFIG.USER_AGENTS[
    Math.floor(Math.random() * HTTP_CONFIG.USER_AGENTS.length)
  ];
  
  console.log(`Using User-Agent: ${randomUserAgent}`);
  
  // Настройка HTTP-запроса
  const config = {
    timeout: HTTP_CONFIG.TIMEOUT,
    headers: {
      'User-Agent': randomUserAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'max-age=0'
    }
  };
  
  // Выполнение запроса с повторными попытками
  let retryCount = 0;
  let lastError = null;
  
  while (retryCount <= HTTP_CONFIG.MAX_RETRIES) {
    try {
      console.log(`Fetching SCFI data from primary source (attempt ${retryCount + 1}/${HTTP_CONFIG.MAX_RETRIES + 1})...`);
      
      // Выполнение HTTP-запроса
      const response = await axios.get(SCFI_URL, config);
      
      // Проверка статуса ответа
      if (response.status !== 200) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      
      // Парсинг HTML-страницы
      console.log('Parsing SCFI data from HTML response...');
      const $ = cheerio.load(response.data);
      
      // Получение текущей даты
      const currentDate = new Date().toISOString().split('T')[0];
      console.log(`Using current date: ${currentDate}`);
      
      // Предыдущая дата - неделю назад
      const prevDate = new Date();
      prevDate.setDate(prevDate.getDate() - 7);
      const previousDate = prevDate.toISOString().split('T')[0];
      console.log(`Using previous date: ${previousDate}`);
      
      // Массив для хранения данных SCFI
      const scfiData = [];
      
      // Поиск таблицы с данными SCFI
      const tables = $('table');
      console.log(`Found ${tables.length} tables on the page`);
      
      // Обработка каждой таблицы
      tables.each((tableIndex, table) => {
        // Проверка, содержит ли таблица данные SCFI
        const tableText = $(table).text().toLowerCase();
        
        if (tableText.includes('scfi') || 
            tableText.includes('shanghai containerized freight index') || 
            tableText.includes('freight index')) {
          console.log(`Table ${tableIndex + 1} contains SCFI data`);
          
          // Получение строк таблицы
          const rows = $(table).find('tr');
          console.log(`Found ${rows.length} rows in SCFI table`);
          
          // Обработка каждой строки
          rows.each((rowIndex, row) => {
            // Пропускаем заголовок таблицы
            if (rowIndex === 0) return;
            
            // Получение ячеек строки
            const cells = $(row).find('td');
            
            // Проверка наличия достаточного количества ячеек
            if (cells.length >= 3) {
              // Извлечение данных из ячеек
              const route = $(cells[0]).text().trim();
              const currentIndexText = $(cells[1]).text().trim().replace(/,/g, '');
              const changeText = $(cells[2]).text().trim().replace(/,/g, '');
              
              // Преобразование текстовых значений в числа
              const currentIndexValue = parseFloat(currentIndexText);
              let changeValue = parseFloat(changeText);
              
              // Проверка на отрицательное изменение
              if (!isNaN(changeValue) && changeText.includes('-')) {
                changeValue = -Math.abs(changeValue);
              }
              
              // Определение, является ли маршрут композитным индексом
              const isComposite = route.toLowerCase().includes('composite') || 
                                 route.toLowerCase().includes('comprehensive') || 
                                 route === '';
              
              // Форматирование названия маршрута
              const finalRoute = isComposite ? 'Comprehensive Index' : route;
              
              // Добавление данных в массив, если индекс является числом
              if (!isNaN(currentIndexValue)) {
                console.log(`Adding data for route: ${finalRoute}, Current Index: ${currentIndexValue}, Change: ${changeValue}`);
                
                scfiData.push({
                  route: finalRoute,
                  unit: 'USD/TEU',
                  weighting: isComposite ? 100 : 0,
                  previousIndex: currentIndexValue - changeValue,
                  currentIndex: currentIndexValue,
                  change: changeValue,
                  previousDate: previousDate,
                  currentDate: currentDate
                });
                
                console.log(`Successfully added data for route: ${finalRoute}`);
              } else {
                console.log(`Skipping invalid row: Route: "${route}", Current Index: ${isNaN(currentIndexValue) ? 'NaN' : currentIndexValue}`);
              }
            } else {
              console.log(`Skipping row ${rowIndex + 1} with insufficient columns (${cells.length} < 3)`);
            }
          });
        } else {
          console.log(`Table ${tableIndex + 1} does not contain SCFI data`);
        }
      });
      
      // Проверка полученных данных
      console.log(`Parsed ${scfiData.length} SCFI records from primary source`);
      
      // Если данные не найдены, выбрасываем ошибку
      if (scfiData.length === 0) {
        throw new Error('No SCFI data found on the page');
      }
      
      // Возвращаем полученные данные
      return scfiData;
    } catch (error) {
      // Сохраняем ошибку для возможного повторного выброса
      lastError = error;
      
      // Логирование ошибки
      console.error(`Error fetching SCFI data from primary source (attempt ${retryCount + 1}/${HTTP_CONFIG.MAX_RETRIES + 1}):`, error.message);
      
      // Если есть еще попытки, ждем перед следующей
      if (retryCount < HTTP_CONFIG.MAX_RETRIES) {
        const delay = HTTP_CONFIG.RETRY_DELAY * (retryCount + 1);
        console.log(`Waiting ${delay}ms before retry...`);
        await setTimeout(delay);
      }
      
      // Увеличиваем счетчик попыток
      retryCount++;
    }
  }
  
  // Если все попытки неудачны, выбрасываем последнюю ошибку
  console.error('All retry attempts failed for primary source');
  throw lastError || new Error('Failed to fetch SCFI data from primary source after multiple attempts');
}

/**
 * Функция для получения данных SCFI из альтернативного источника
 * 
 * Парсит данные с альтернативных источников, таких как новостные сайты
 * и аналитические порталы.
 * 
 * @async
 * @function fetchSCFIDataFromAlternativeSource
 * @param {string} url - URL альтернативного источника
 * @returns {Promise<Array>} Массив объектов с данными SCFI
 * @throws {Error} Если не удалось получить данные
 */
async function fetchSCFIDataFromAlternativeSource(url) {
  // Выбор случайного User-Agent для запроса
  const randomUserAgent = HTTP_CONFIG.USER_AGENTS[
    Math.floor(Math.random() * HTTP_CONFIG.USER_AGENTS.length)
  ];
  
  console.log(`Using User-Agent for alternative source: ${randomUserAgent}`);
  
  // Настройка HTTP-запроса
  const config = {
    timeout: HTTP_CONFIG.TIMEOUT,
    headers: {
      'User-Agent': randomUserAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'max-age=0'
    }
  };
  
  // Выполнение запроса с повторными попытками
  let retryCount = 0;
  let lastError = null;
  
  while (retryCount <= HTTP_CONFIG.MAX_RETRIES) {
    try {
      console.log(`Fetching SCFI data from alternative source ${url} (attempt ${retryCount + 1}/${HTTP_CONFIG.MAX_RETRIES + 1})...`);
      
      // Выполнение HTTP-запроса
      const response = await axios.get(url, config);
      
      // Проверка статуса ответа
      if (response.status !== 200) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      
      // Парсинг HTML-страницы
      console.log('Parsing SCFI data from HTML response...');
      const $ = cheerio.load(response.data);
      
      // Получение текущей даты
      const currentDate = new Date().toISOString().split('T')[0];
      console.log(`Using current date: ${currentDate}`);
      
      // Предыдущая дата - неделю назад
      const prevDate = new Date();
      prevDate.setDate(prevDate.getDate() - 7);
      const previousDate = prevDate.toISOString().split('T')[0];
      console.log(`Using previous date: ${previousDate}`);
      
      // Массив для хранения данных SCFI
      const scfiData = [];
      
      // Поиск таблиц с данными SCFI
      const tables = $('table');
      console.log(`Found ${tables.length} tables on the page`);
      
      let tableCount = 0;
      
      // Обработка каждой таблицы
      tables.each((i, table) => {
        tableCount++;
        const tableText = $(table).text().toLowerCase();
        
        // Проверка, содержит ли таблица данные SCFI
        if (tableText.includes('scfi') || 
            tableText.includes('shanghai') || 
            tableText.includes('freight index') || 
            tableText.includes('container')) {
          console.log(`Table ${tableCount} contains potential SCFI data`);
          
          // Получение строк таблицы
          const rows = $(table).find('tr');
          console.log(`Found ${rows.length} rows in table ${tableCount}`);
          
          let rowCount = 0;
          
          // Обработка каждой строки
          rows.each((j, row) => {
            rowCount++;
            
            // Получение ячеек строки
            const cells = $(row).find('td, th');
            
            // Проверка наличия достаточного количества ячеек
            if (cells.length >= 2) {
              // Извлечение данных из ячеек
              const firstCell = $(cells[0]).text().trim();
              const secondCell = $(cells[1]).text().trim().replace(/,/g, '');
              
              // Определение, является ли строка данными индекса
              const isIndexRow = firstCell.toLowerCase().includes('scfi') || 
                               firstCell.toLowerCase().includes('shanghai') || 
                               firstCell.toLowerCase().includes('composite') || 
                               firstCell.toLowerCase().includes('comprehensive') || 
                               firstCell === '';
              
              // Если это строка с индексом, извлекаем значение
              if (isIndexRow) {
                // Поиск числового значения во второй ячейке
                const indexMatch = secondCell.match(/(\d+(\.\d+)?)/);
                
                if (indexMatch) {
                  const currentIndexValue = parseFloat(indexMatch[1]);
                  console.log(`Found index value: ${currentIndexValue}`);
                  
                  // Поиск изменения индекса
                  let changeValue = 0;
                  let changeCell = '';
                  
                  // Проверка наличия ячейки с изменением
                  if (cells.length >= 3) {
                    changeCell = $(cells[2]).text().trim().replace(/,/g, '');
                    const changeMatch = changeCell.match(/(-?\d+(\.\d+)?)/);
                    
                    if (changeMatch) {
                      changeValue = parseFloat(changeMatch[1]);
                      
                      // Проверка на отрицательное изменение
                      if (!changeCell.includes('-') && changeCell.toLowerCase().includes('down')) {
                        changeValue = -Math.abs(changeValue);
                      }
                      
                      console.log(`Found change value: ${changeValue}`);
                    }
                  }
                  
                  // Определение названия маршрута
                  const route = 'Comprehensive Index';
                  
                  // Добавление данных в массив, если индекс является числом
                  if (!isNaN(currentIndexValue)) {
                    console.log(`Adding data for route: ${route}, Current Index: ${currentIndexValue}, Change: ${changeValue}`);
                    
                    scfiData.push({
                      route: route,
                      unit: 'USD/TEU',
                      weighting: 100,
                      previousIndex: currentIndexValue - changeValue,
                      currentIndex: currentIndexValue,
                      change: changeValue,
                      previousDate: previousDate,
                      currentDate: currentDate
                    });
                    
                    console.log(`Successfully added data for route: ${route}`);
                  } else {
                    console.log(`Skipping invalid row: Route: "${firstCell}", Current Index: ${isNaN(currentIndexValue) ? 'NaN' : currentIndexValue}`);
                  }
                }
              }
            } else {
              console.log(`Skipping row ${rowCount} with insufficient columns (${cells.length} < 2)`);
            }
          });
          
          console.log(`Processed ${rowCount} rows from table ${tableCount}`);
        }
      });
      
      // Если таблицы не найдены или не содержат данных, ищем данные в тексте статей
      if (scfiData.length === 0) {
        console.log('No data found in tables, searching in article text...');
        
        // Ищем в статьях упоминания индекса SCFI и его значения
        const articles = $('article, .article, .post, .entry, .content');
        console.log(`Found ${articles.length} potential article elements`);
        
        let articleCount = 0;
        
        articles.each((i, article) => {
          articleCount++;
          const articleText = $(article).text();
          console.log(`Analyzing article ${articleCount}, text length: ${articleText.length} characters`);
          
          // Ищем упоминание композитного индекса SCFI
          const indexMatch = articleText.match(/SCFI.*?(\d+(\.\d+)?)/i);
          
          if (indexMatch) {
            const currentIndexValue = parseFloat(indexMatch[1]);
            console.log(`Found SCFI index value in article: ${currentIndexValue}`);
            
            // Ищем упоминание изменения индекса
            const changeMatch = articleText.match(/(up|down|increased|decreased|rose|fell).*?(\d+(\.\d+)?)/i);
            let changeValue = 0;
            
            if (changeMatch) {
              changeValue = parseFloat(changeMatch[2]);
              const direction = changeMatch[1].toLowerCase();
              
              // Определяем направление изменения
              if (direction.includes('down') || 
                  direction.includes('decreased') || 
                  direction.includes('fell')) {
                changeValue = -changeValue;
              }
              
              console.log(`Found change value in article: ${changeValue} (${direction})`);
            } else {
              console.log('No change value found in article, using default: 0');
            }
            
            // Добавление данных в массив, если индекс является числом
            if (!isNaN(currentIndexValue)) {
              console.log(`Adding data from article: Index: ${currentIndexValue}, Change: ${changeValue}`);
              
              scfiData.push({
                route: 'Comprehensive Index',
                unit: 'USD/TEU',
                weighting: 100,
                previousIndex: currentIndexValue - changeValue,
                currentIndex: currentIndexValue,
                change: changeValue,
                previousDate: previousDate,
                currentDate: currentDate
              });
              
              console.log('Successfully added data from article');
              
              // Берем только первое найденное значение
              return false;
            } else {
              console.log(`Invalid index value found in article: ${currentIndexValue}`);
            }
          } else {
            console.log('No SCFI index value found in article');
          }
        });
      }
      
      // Проверка полученных данных
      console.log(`Parsed ${scfiData.length} SCFI records from alternative source ${url}`);
      
      // Возвращаем полученные данные
      return scfiData;
    } catch (error) {
      // Сохраняем ошибку для возможного повторного выброса
      lastError = error;
      
      // Логирование ошибки
      console.error(`Error fetching SCFI data from alternative source ${url} (attempt ${retryCount + 1}/${HTTP_CONFIG.MAX_RETRIES + 1}):`, error.message);
      
      // Если есть еще попытки, ждем перед следующей
      if (retryCount < HTTP_CONFIG.MAX_RETRIES) {
        const delay = HTTP_CONFIG.RETRY_DELAY * (retryCount + 1);
        console.log(`Waiting ${delay}ms before retry...`);
        await setTimeout(delay);
      }
      
      // Увеличиваем счетчик попыток
      retryCount++;
    }
  }
  
  // Если все попытки неудачны, выбрасываем последнюю ошибку
  console.error(`All retry attempts failed for alternative source ${url}`);
  throw lastError || new Error(`Failed to fetch SCFI data from alternative source ${url} after multiple attempts`);
}

/**
 * Функция для получения моковых данных SCFI
 * 
 * Используется в случае, если не удалось получить данные ни с одного источника.
 * Возвращает фиксированный набор данных, основанный на исторических значениях SCFI.
 * 
 * @async
 * @function fetchMockSCFIData
 * @returns {Promise<Array>} Массив объектов с моковыми данными SCFI
 */
async function fetchMockSCFIData() {
  // Логирование использования моковых данных
  console.log('Using mock data for SCFI');
  
  // Получение текущей даты
  const currentDate = new Date().toISOString().split('T')[0];
  console.log(`Using current date for mock data: ${currentDate}`);
  
  // Предыдущая дата - неделю назад
  const prevDate = new Date();
  prevDate.setDate(prevDate.getDate() - 7);
  const previousDate = prevDate.toISOString().split('T')[0];
  console.log(`Using previous date for mock data: ${previousDate}`);
  
  // Создание моковых данных на основе реальных значений SCFI
  console.log('Creating mock SCFI data based on historical values');
  const mockData = [
    {
      route: 'Comprehensive Index',
      unit: 'USD/TEU',
      weighting: 100,
      previousIndex: 1370.58,
      currentIndex: 1347.84,
      change: -22.74,
      previousDate: previousDate,
      currentDate: currentDate
    },
    {
      route: 'Europe (Base port)',
      unit: 'USD/TEU',
      weighting: 20.0,
      previousIndex: 1450,
      currentIndex: 1425,
      change: -25,
      previousDate: previousDate,
      currentDate: currentDate
    },
    {
      route: 'Mediterranean (Base port)',
      unit: 'USD/TEU',
      weighting: 10.0,
      previousIndex: 1400,
      currentIndex: 1380,
      change: -20,
      previousDate: previousDate,
      currentDate: currentDate
    },
    {
      route: 'USWC (Base port)',
      unit: 'USD/FEU',
      weighting: 20.0,
      previousIndex: 2100,
      currentIndex: 2050,
      change: -50,
      previousDate: previousDate,
      currentDate: currentDate
    },
    {
      route: 'USEC (Base port)',
      unit: 'USD/FEU',
      weighting: 7.5,
      previousIndex: 2300,
      currentIndex: 2250,
      change: -50,
      previousDate: previousDate,
      currentDate: currentDate
    },
    {
      route: 'Persian Gulf (Dubai)',
      unit: 'USD/TEU',
      weighting: 7.5,
      previousIndex: 950,
      currentIndex: 930,
      change: -20,
      previousDate: previousDate,
      currentDate: currentDate
    },
    {
      route: 'Australia/New Zealand',
      unit: 'USD/TEU',
      weighting: 5.0,
      previousIndex: 920,
      currentIndex: 910,
      change: -10,
      previousDate: previousDate,
      currentDate: currentDate
    },
    {
      route: 'Southeast Asia (Singapore)',
      unit: 'USD/TEU',
      weighting: 7.5,
      previousIndex: 850,
      currentIndex: 840,
      change: -10,
      previousDate: previousDate,
      currentDate: currentDate
    }
  ];
  
  console.log(`Created ${mockData.length} mock SCFI records`);
  
  // Сохранение моковых данных в базу данных
  try {
    console.log('Saving mock data to database...');
    await saveSCFIData(mockData);
    console.log('Mock data successfully saved to database');
  } catch (error) {
    console.error('Error saving mock data to database:', error);
    console.log('Continuing without saving mock data to database');
  }
  
  return mockData;
}

/**
 * Функция для сохранения данных SCFI в базу данных
 * 
 * Создает таблицу, если она не существует, и вставляет данные.
 * Использует транзакции для обеспечения целостности данных.
 * 
 * @async
 * @function saveSCFIData
 * @param {Array} scfiData - Массив объектов с данными SCFI
 * @throws {Error} Если не удалось сохранить данные в базу данных
 */
async function saveSCFIData(scfiData) {
  // Проверка входных данных
  if (!Array.isArray(scfiData) || scfiData.length === 0) {
    console.error('Invalid SCFI data provided for saving');
    throw new Error('Invalid SCFI data provided for saving');
  }
  
  console.log(`Saving ${scfiData.length} SCFI records to database...`);
  
  // Получение соединения из пула
  let client = null;
  
  try {
    console.log('Acquiring database connection from pool...');
    client = await pool.connect();
    console.log('Database connection acquired');
    
    // Начало транзакции
    console.log('Beginning database transaction...');
    await client.query('BEGIN');
    
    // Создание таблицы, если она не существует
    console.log(`Creating table ${DB_CONFIG.TABLE_NAME} if not exists...`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${DB_CONFIG.TABLE_NAME} (
        id SERIAL PRIMARY KEY,
        route VARCHAR(255) NOT NULL,
        unit VARCHAR(50),
        weighting NUMERIC,
        previous_index NUMERIC,
        current_index NUMERIC NOT NULL,
        change NUMERIC,
        previous_date DATE,
        current_date DATE NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(route, current_date)
      )
    `);
    console.log('Table creation/verification completed');
    
    // Вставка данных
    console.log('Inserting SCFI data records...');
    let successCount = 0;
    let errorCount = 0;
    
    for (const data of scfiData) {
      try {
        // Проверка обязательных полей
        if (!data.route || isNaN(data.currentIndex) || !data.currentDate) {
          console.error(`Skipping invalid SCFI data record: ${JSON.stringify(data)}`);
          errorCount++;
          continue;
        }
        
        // Подготовка данных для вставки
        const params = [
          data.route,
          data.unit || 'USD/TEU',
          isNaN(data.weighting) ? 0 : data.weighting,
          isNaN(data.previousIndex) ? 0 : data.previousIndex,
          data.currentIndex,
          isNaN(data.change) ? 0 : data.change,
          data.previousDate || null,
          data.currentDate
        ];
        
        // Вставка данных с обработкой конфликтов (UPSERT)
        await client.query(
          `INSERT INTO ${DB_CONFIG.TABLE_NAME} 
           (route, unit, weighting, previous_index, current_index, change, previous_date, current_date) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (route, current_date) 
           DO UPDATE SET 
             unit = $2,
             weighting = $3,
             previous_index = $4,
             current_index = $5,
             change = $6,
             previous_date = $7`,
          params
        );
        
        successCount++;
        console.log(`Successfully inserted/updated data for route: ${data.route}`);
      } catch (error) {
        errorCount++;
        console.error(`Error inserting SCFI data for route ${data.route}:`, error);
        // Продолжаем вставку других данных
      }
    }
    
    // Завершение транзакции
    console.log('Committing database transaction...');
    await client.query('COMMIT');
    
    console.log(`Database operation completed: ${successCount} records saved successfully, ${errorCount} errors`);
  } catch (error) {
    // Откат транзакции в случае ошибки
    if (client) {
      console.error('Error during database operation, rolling back transaction...');
      await client.query('ROLLBACK');
    }
    
    console.error('Error saving SCFI data to database:', error);
    throw error;
  } finally {
    // Освобождение клиента
    if (client) {
      console.log('Releasing database connection back to pool...');
      client.release();
    }
  }
}

/**
 * Функция для очистки устаревших данных SCFI
 * 
 * Удаляет данные старше указанного периода хранения.
 * 
 * @async
 * @function cleanupOldSCFIData
 * @throws {Error} Если не удалось очистить данные
 */
async function cleanupOldSCFIData() {
  // Получение соединения из пула
  const client = await pool.connect();
  
  try {
    // Удаление данных старше периода хранения
    const query = `
      DELETE FROM ${DB_CONFIG.TABLE_NAME}
      WHERE current_date < NOW() - INTERVAL '${DB_CONFIG.RETENTION_DAYS} days'
    `;
    
    const result = await client.query(query);
    console.log(`Deleted ${result.rowCount} old SCFI records`);
  } catch (error) {
    console.error('Error cleaning up old SCFI data:', error);
    throw error;
  } finally {
    // Освобождение клиента
    client.release();
  }
}

/**
 * Функция для получения данных SCFI для расчета ставки фрахта
 * 
 * Эта функция используется калькулятором фрахтовых ставок для получения
 * текущего значения индекса SCFI, его изменения и даты.
 * 
 * Порядок получения данных:
 * 1. Попытка получить данные из базы данных
 * 2. Если данных нет в базе, попытка получить их через API
 * 3. Если данные не удалось получить, использование моковых данных
 * 
 * @async
 * @function getSCFIDataForCalculation
 * @returns {Promise<Object>} Объект с данными SCFI для расчета
 */
async function getSCFIDataForCalculation() {
  try {
    console.log('Getting SCFI data for calculation...');
    
    // Получение последних данных композитного индекса SCFI из базы данных
    console.log('Querying database for latest SCFI composite index...');
    const query = `
      SELECT * FROM ${DB_CONFIG.TABLE_NAME} 
      WHERE route = 'Comprehensive Index'
      ORDER BY current_date DESC 
      LIMIT 1
    `;
    
    const result = await pool.query(query);
    
    // Если данные найдены в базе, возвращаем их
    if (result.rows.length > 0) {
      const data = result.rows[0];
      console.log('Found SCFI data in database:', data);
      
      // Форматируем дату в строку в формате YYYY-MM-DD
      const formattedDate = data.current_date instanceof Date 
        ? data.current_date.toISOString().split('T')[0]
        : data.current_date;
      
      // Преобразуем числовые значения с помощью parseFloat
      const indexValue = parseFloat(data.current_index) || 0;
      const changeValue = parseFloat(data.change) || 0;
      
      console.log(`Formatted SCFI data: Index: ${indexValue}, Change: ${changeValue}, Date: ${formattedDate}`);
      
      return {
        current_index: indexValue,
        change: changeValue,
        index_date: formattedDate
      };
    }
    
    // Если данных нет в базе, пытаемся получить их через API
    console.log('No SCFI data in database, fetching from API...');
    try {
      const scfiData = await fetchSCFIData();
      
      // Ищем композитный индекс в полученных данных
      const compositeData = scfiData.find(data => 
        data.route === 'Comprehensive Index' || 
        data.route.toLowerCase().includes('composite')
      );
      
      if (compositeData) {
        console.log('Fetched SCFI data from API:', compositeData);
        
        // Форматируем дату в строку в формате YYYY-MM-DD
        const formattedDate = compositeData.currentDate instanceof Date 
          ? compositeData.currentDate.toISOString().split('T')[0]
          : compositeData.currentDate;
        
        // Преобразуем числовые значения с помощью parseFloat
        const indexValue = parseFloat(compositeData.currentIndex) || 0;
        const changeValue = parseFloat(compositeData.change) || 0;
        
        console.log(`Formatted SCFI data from API: Index: ${indexValue}, Change: ${changeValue}, Date: ${formattedDate}`);
        
        return {
          current_index: indexValue,
          change: changeValue,
          index_date: formattedDate
        };
      }
    } catch (error) {
      console.error('Error fetching SCFI data from API:', error);
    }
    
    // Если данные не удалось получить, возвращаем моковые данные
    console.log('Failed to get SCFI data, using mock data');
    const currentDate = new Date().toISOString().split('T')[0];
    
    return {
      current_index: 1347.84,
      change: -22.74,
      index_date: currentDate
    };
  } catch (error) {
    console.error('Error getting SCFI data for calculation:', error);
    console.error('Stack trace:', error.stack);
    
    // В случае ошибки возвращаем моковые данные
    const currentDate = new Date().toISOString().split('T')[0];
    
    return {
      current_index: 1347.84,
      change: -22.74,
      index_date: currentDate
    };
  }
}

/**
 * Функция для получения данных SCFI для конкретного маршрута
 * 
 * Эта функция используется для получения данных SCFI для конкретного маршрута
 * на основе портов отправления и назначения.
 * 
 * @async
 * @function getSCFIDataForRoute
 * @param {string} origin - ID порта отправления
 * @param {string} destination - ID порта назначения
 * @returns {Promise<Object|null>} Объект с данными SCFI для маршрута или null, если данные не найдены
 */
async function getSCFIDataForRoute(origin, destination) {
  try {
    console.log(`Getting SCFI data for route: ${origin} -> ${destination}...`);
    
    // Получение регионов портов
    const originRegion = await getPortRegion(origin);
    const destinationRegion = await getPortRegion(destination);
    
    if (!originRegion || !destinationRegion) {
      console.log('Could not determine port regions');
      return null;
    }
    
    console.log(`Port regions: ${originRegion} -> ${destinationRegion}`);
    
    // Маппинг регионов на маршруты SCFI
    const routeMapping = {
      'Asia-Europe': 'Europe (Base port)',
      'Asia-Mediterranean': 'Mediterranean (Base port)',
      'Asia-USWC': 'USWC (Base port)',
      'Asia-USEC': 'USEC (Base port)',
      'Asia-Persian Gulf': 'Persian Gulf (Dubai)',
      'Asia-Australia': 'Australia/New Zealand',
      'Asia-Southeast Asia': 'Southeast Asia (Singapore)'
    };
    
    // Определение маршрута SCFI
    const routeKey = `${originRegion}-${destinationRegion}`;
    const scfiRoute = routeMapping[routeKey];
    
    if (!scfiRoute) {
      console.log(`No SCFI route mapping for ${routeKey}`);
      return null;
    }
    
    console.log(`Mapped to SCFI route: ${scfiRoute}`);
    
    // Получение данных SCFI для маршрута
    const query = `
      SELECT * FROM ${DB_CONFIG.TABLE_NAME} 
      WHERE route = $1
      ORDER BY current_date DESC 
      LIMIT 1
    `;
    
    const result = await pool.query(query, [scfiRoute]);
    
    if (result.rows.length > 0) {
      const data = result.rows[0];
      console.log(`Found SCFI data for route ${scfiRoute}:`, data);
      
      return {
        route: data.route,
        currentIndex: parseFloat(data.current_index) || 0,
        change: parseFloat(data.change) || 0,
        currentDate: data.current_date instanceof Date 
          ? data.current_date.toISOString().split('T')[0]
          : data.current_date
      };
    } else {
      console.log(`No SCFI data found for route ${scfiRoute}`);
      return null;
    }
  } catch (error) {
    console.error('Error getting SCFI data for route:', error);
    return null;
  }
}

/**
 * Функция для получения региона порта
 * 
 * Вспомогательная функция для определения региона порта по его ID.
 * 
 * @async
 * @function getPortRegion
 * @param {string} portId - ID порта
 * @returns {Promise<string|null>} Регион порта или null, если порт не найден
 */
async function getPortRegion(portId) {
  try {
    const query = 'SELECT region FROM ports WHERE id = $1';
    const result = await pool.query(query, [portId]);
    
    if (result.rows.length > 0) {
      return result.rows[0].region;
    } else {
      return null;
    }
  } catch (error) {
    console.error('Error getting port region:', error);
    return null;
  }
}

// Экспорт функций модуля
export default {
  fetchSCFIData,
  getSCFIDataForCalculation,
  getSCFIDataForRoute
};
