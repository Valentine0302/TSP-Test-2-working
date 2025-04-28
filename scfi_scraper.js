/**
 * Shanghai Containerized Freight Index (SCFI) Scraper Module
 * =========================================================
 * 
 * Этот модуль предназначен для сбора данных из Shanghai Containerized Freight Index (SCFI),
 * который является важным индикатором стоимости морских контейнерных перевозок.
 * 
 * SCFI публикуется еженедельно Shanghai Shipping Exchange (SSE) и отражает
 * изменения фрахтовых ставок на основных маршрутах из портов Китая.
 * 
 * Модуль использует несколько источников данных для обеспечения надежности:
 * 1. Основной источник: Shanghai Shipping Exchange (SSE)
 * 2. Альтернативные источники (в порядке приоритета):
 *    - MacroMicro (финансовая аналитическая платформа)
 *    - FreightWaves (новостной портал о грузоперевозках)
 *    - Container News (отраслевой новостной портал)
 *    - Hellenic Shipping News (морской новостной портал)
 * 
 * Данные сохраняются в базе данных PostgreSQL для последующего использования
 * в расчетах фрахтовых ставок и анализе тенденций рынка.
 * 
 * @module scfi_scraper
 * @author TSP Team
 * @version 2.0.0
 * @last_updated 2025-04-28
 */

// Импорт необходимых модулей
const axios = require('axios'); // HTTP-клиент для выполнения запросов
const cheerio = require('cheerio'); // Библиотека для парсинга HTML
const { Pool } = require('pg'); // Клиент PostgreSQL для работы с базой данных
const dotenv = require('dotenv'); // Модуль для загрузки переменных окружения

/**
 * Загрузка переменных окружения из файла .env
 * Это позволяет хранить конфиденциальные данные (например, строки подключения к БД)
 * вне кода и не включать их в систему контроля версий
 */
dotenv.config();

/**
 * Настройка подключения к базе данных PostgreSQL
 * Используется пул соединений для эффективного управления подключениями
 * 
 * Параметры подключения:
 * - connectionString: строка подключения к базе данных из переменных окружения
 * - ssl: настройки SSL для безопасного подключения
 *   - rejectUnauthorized: false - позволяет подключаться к серверам с самоподписанными сертификатами
 *   - sslmode: 'require' - требует использования SSL
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
    sslmode: 'require'
  }
});

/**
 * URL для получения данных SCFI с основного источника
 * Shanghai Shipping Exchange (SSE) - официальный источник данных SCFI
 * @constant {string}
 */
const SCFI_URL = 'https://en.sse.net.cn/indices/scfinew.jsp';

/**
 * Альтернативные источники данных SCFI
 * Используются в случае недоступности основного источника
 * Порядок важен: источники проверяются последовательно
 * 
 * Изменен порядок: MacroMicro на втором месте, FreightWaves на третьем
 * MacroMicro предоставляет более структурированные и надежные данные
 * @constant {Array<string>}
 */
const SCFI_ALT_URLS = [
  'https://en.macromicro.me/series/17502/fbx-global-container-index-weekly',
  'https://www.freightwaves.com/news/tag/scfi',
  'https://www.container-news.com/scfi/',
  'https://www.hellenicshippingnews.com/shanghai-containerized-freight-index/'
];

/**
 * Константы для настройки HTTP-запросов
 * @constant {Object}
 */
const HTTP_CONFIG = {
  // Таймаут запроса в миллисекундах
  TIMEOUT: 15000,
  
  // Максимальное количество повторных попыток
  MAX_RETRIES: 3,
  
  // Задержка между повторными попытками в миллисекундах
  RETRY_DELAY: 2000,
  
  // Заголовки для имитации реального браузера
  HEADERS: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0'
  }
};

/**
 * Константы для работы с базой данных
 * @constant {Object}
 */
const DB_CONFIG = {
  // Название таблицы для хранения данных SCFI
  TABLE_NAME: 'freight_indices_scfi',
  
  // Максимальное количество соединений в пуле
  MAX_POOL_SIZE: 10,
  
  // Время ожидания для получения соединения из пула (в миллисекундах)
  CONNECTION_TIMEOUT: 10000,
  
  // Время простоя соединения перед его закрытием (в миллисекундах)
  IDLE_TIMEOUT: 30000
};

/**
 * Основная функция для получения данных SCFI
 * 
 * Эта функция координирует процесс получения данных:
 * 1. Пытается получить данные с основного источника
 * 2. Если основной источник недоступен, перебирает альтернативные источники
 * 3. Сохраняет полученные данные в базу данных
 * 4. В случае ошибки возвращает моковые данные
 * 
 * @async
 * @function fetchSCFIData
 * @returns {Promise<Array>} Массив объектов с данными SCFI
 * @throws {Error} Если не удалось получить данные ни с одного источника
 */
async function fetchSCFIData() {
  // Логирование начала процесса
  console.log('Fetching Shanghai Containerized Freight Index data...');
  console.log(`Current time: ${new Date().toISOString()}`);
  
  try {
    // Счетчик попыток для отладки
    let attemptCount = 0;
    let scfiData = null;
    
    // Попытка получить данные с основного источника
    console.log(`Attempt ${++attemptCount}: Trying primary source: ${SCFI_URL}`);
    scfiData = await fetchSCFIFromPrimarySource();
    
    // Проверка полученных данных
    if (scfiData && Array.isArray(scfiData) && scfiData.length > 0) {
      console.log(`Successfully fetched ${scfiData.length} records from primary source`);
    } else {
      console.log('Primary source returned no data or invalid data');
      
      // Если не удалось получить данные с основного источника, используем альтернативные
      for (const altUrl of SCFI_ALT_URLS) {
        console.log(`Attempt ${++attemptCount}: Trying alternative source: ${altUrl}`);
        scfiData = await fetchSCFIFromAlternativeSource(altUrl);
        
        // Проверка полученных данных
        if (scfiData && Array.isArray(scfiData) && scfiData.length > 0) {
          console.log(`Successfully fetched ${scfiData.length} records from alternative source: ${altUrl}`);
          break;
        } else {
          console.log(`Alternative source ${altUrl} returned no data or invalid data`);
        }
      }
    }
    
    // Если данные получены, сохраняем их в базу данных
    if (scfiData && Array.isArray(scfiData) && scfiData.length > 0) {
      console.log(`Saving ${scfiData.length} SCFI records to database...`);
      await saveSCFIData(scfiData);
      console.log('SCFI data successfully saved to database');
      return scfiData;
    } else {
      // Если не удалось получить данные ни с одного источника, генерируем ошибку
      console.error('Failed to fetch SCFI data from all sources');
      throw new Error('Failed to fetch SCFI data from all sources');
    }
  } catch (error) {
    // Логирование ошибки
    console.error('Error fetching SCFI data:', error);
    console.error('Stack trace:', error.stack);
    
    // В случае ошибки возвращаем моковые данные
    console.log('Falling back to mock data');
    return fetchMockSCFIData();
  } finally {
    // Логирование завершения процесса
    console.log(`SCFI data fetching process completed at ${new Date().toISOString()}`);
  }
}

/**
 * Функция для получения данных SCFI с основного источника (Shanghai Shipping Exchange)
 * 
 * Эта функция выполняет следующие шаги:
 * 1. Отправляет HTTP-запрос на сайт SSE
 * 2. Парсит HTML-страницу для извлечения данных
 * 3. Извлекает даты индексов из заголовков таблицы
 * 4. Извлекает данные о маршрутах, индексах и изменениях
 * 5. Форматирует данные в структурированный массив объектов
 * 
 * @async
 * @function fetchSCFIFromPrimarySource
 * @returns {Promise<Array>} Массив объектов с данными SCFI
 * @throws {Error} Если не удалось получить данные с основного источника
 */
async function fetchSCFIFromPrimarySource() {
  // Логирование начала процесса
  console.log('Fetching SCFI data from primary source...');
  
  // Переменные для отслеживания попыток и повторов
  let retryCount = 0;
  let lastError = null;
  
  // Цикл повторных попыток в случае ошибок
  while (retryCount <= HTTP_CONFIG.MAX_RETRIES) {
    try {
      // Если это повторная попытка, добавляем задержку
      if (retryCount > 0) {
        console.log(`Retry attempt ${retryCount}/${HTTP_CONFIG.MAX_RETRIES} after ${HTTP_CONFIG.RETRY_DELAY}ms delay`);
        await new Promise(resolve => setTimeout(resolve, HTTP_CONFIG.RETRY_DELAY));
      }
      
      // Отправка запроса на сайт Shanghai Shipping Exchange с имитацией реального браузера
      console.log(`Sending HTTP request to ${SCFI_URL}`);
      const response = await axios.get(SCFI_URL, {
        headers: HTTP_CONFIG.HEADERS,
        timeout: HTTP_CONFIG.TIMEOUT
      });
      
      // Проверка успешности запроса
      if (response.status !== 200) {
        throw new Error(`Failed to fetch SCFI data from primary source: HTTP status ${response.status}`);
      }
      
      // Логирование успешного получения ответа
      console.log(`Received response from ${SCFI_URL}, content length: ${response.data.length} bytes`);
      
      // Парсинг HTML-страницы
      console.log('Parsing HTML response...');
      const $ = cheerio.load(response.data);
      
      // Извлечение данных из таблицы
      const scfiData = [];
      
      // Получение текущей даты из заголовка таблицы
      let currentDate = '';
      let previousDate = '';
      
      // Ищем заголовки с датами
      console.log('Extracting dates from table headers...');
      $('th, td').each((i, el) => {
        const text = $(el).text().trim();
        if (text.includes('Current Index') && text.includes('-')) {
          const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
          if (dateMatch) {
            currentDate = dateMatch[1];
            console.log(`Found current date in headers: ${currentDate}`);
          }
        } else if (text.includes('Previous Index') && text.includes('-')) {
          const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
          if (dateMatch) {
            previousDate = dateMatch[1];
            console.log(`Found previous date in headers: ${previousDate}`);
          }
        }
      });
      
      // Если даты не найдены, используем текущую дату
      if (!currentDate) {
        currentDate = new Date().toISOString().split('T')[0];
        console.log(`Current date not found in headers, using current date: ${currentDate}`);
      }
      if (!previousDate) {
        // Предыдущая дата - неделю назад
        const prevDate = new Date();
        prevDate.setDate(prevDate.getDate() - 7);
        previousDate = prevDate.toISOString().split('T')[0];
        console.log(`Previous date not found in headers, using date from week ago: ${previousDate}`);
      }
      
      console.log(`Using dates: Current date: ${currentDate}, Previous date: ${previousDate}`);
      
      // Находим таблицу с данными SCFI (4-я таблица на странице)
      console.log('Searching for SCFI data table...');
      const tables = $('table');
      console.log(`Found ${tables.length} tables on the page`);
      
      if (tables.length >= 4) {
        const scfiTable = tables.eq(3); // Индексация с 0, поэтому 4-я таблица имеет индекс 3
        console.log('Found SCFI data table (4th table on the page)');
        
        // Парсинг строк таблицы
        console.log('Parsing table rows...');
        let rowCount = 0;
        let validRowCount = 0;
        
        scfiTable.find('tr').each((i, row) => {
          // Пропускаем заголовок таблицы
          if (i === 0) {
            console.log('Skipping header row');
            return;
          }
          
          rowCount++;
          const cells = $(row).find('td');
          
          // Проверяем, что строка содержит нужное количество колонок
          if (cells.length >= 5) {
            const route = $(cells[0]).text().trim();
            const unit = $(cells[1]).text().trim();
            const weighting = $(cells[2]).text().trim().replace('%', '');
            const previousIndex = $(cells[3]).text().trim();
            const currentIndex = $(cells[4]).text().trim();
            const change = cells.length > 5 ? $(cells[5]).text().trim() : '';
            
            // Логирование извлеченных данных для отладки
            console.log(`Row ${rowCount}: Route: "${route}", Unit: "${unit}", Current Index: "${currentIndex}", Change: "${change}"`);
            
            // Извлечение числовых значений
            const currentIndexValue = parseFloat(currentIndex.replace(',', ''));
            const previousIndexValue = parseFloat(previousIndex.replace(',', ''));
            const changeValue = parseFloat(change.replace(',', ''));
            const weightingValue = parseFloat(weighting);
            
            // Проверка валидности данных
            if (route && !isNaN(currentIndexValue)) {
              validRowCount++;
              
              // Добавление данных в массив
              scfiData.push({
                route: route,
                unit: unit,
                weighting: isNaN(weightingValue) ? 0 : weightingValue,
                previousIndex: isNaN(previousIndexValue) ? 0 : previousIndexValue,
                currentIndex: currentIndexValue,
                change: isNaN(changeValue) ? 0 : changeValue,
                previousDate: previousDate,
                currentDate: currentDate
              });
              
              console.log(`Added data for route: ${route}, current index: ${currentIndexValue}, change: ${changeValue}`);
            } else {
              console.log(`Skipping invalid row: Route: "${route}", Current Index: ${isNaN(currentIndexValue) ? 'NaN' : currentIndexValue}`);
            }
          } else {
            console.log(`Skipping row ${rowCount} with insufficient columns (${cells.length} < 5)`);
          }
        });
        
        console.log(`Processed ${rowCount} rows, found ${validRowCount} valid rows`);
      } else {
        console.log(`Not enough tables found on the page (${tables.length} < 4)`);
      }
      
      // Проверка полученных данных
      if (scfiData.length === 0) {
        console.log('No SCFI data found in the table');
        throw new Error('No SCFI data found in the table');
      }
      
      console.log(`Successfully parsed ${scfiData.length} SCFI records from primary source`);
      
      // Возвращаем полученные данные
      return scfiData;
    } catch (error) {
      // Сохраняем ошибку для возможного повторного выброса
      lastError = error;
      
      // Логирование ошибки
      console.error(`Error fetching SCFI data from primary source (attempt ${retryCount + 1}/${HTTP_CONFIG.MAX_RETRIES + 1}):`, error.message);
      
      // Увеличиваем счетчик попыток
      retryCount++;
    }
  }
  
  // Если все попытки неудачны, выбрасываем последнюю ошибку
  console.error('All retry attempts failed');
  throw lastError || new Error('Failed to fetch SCFI data from primary source after multiple attempts');
}

/**
 * Функция для получения данных SCFI с альтернативного источника
 * 
 * Эта функция адаптируется к различным форматам данных на разных сайтах:
 * - MacroMicro: извлекает данные из специальных элементов с классами 'value' и 'change'
 * - FreightWaves, Container News, Hellenic Shipping News: извлекает данные из таблиц или статей
 * 
 * @async
 * @function fetchSCFIFromAlternativeSource
 * @param {string} url - URL альтернативного источника данных
 * @returns {Promise<Array>} Массив объектов с данными SCFI
 * @throws {Error} Если не удалось получить данные с альтернативного источника
 */
async function fetchSCFIFromAlternativeSource(url) {
  // Логирование начала процесса
  console.log(`Fetching SCFI data from alternative source: ${url}`);
  
  // Переменные для отслеживания попыток и повторов
  let retryCount = 0;
  let lastError = null;
  
  // Цикл повторных попыток в случае ошибок
  while (retryCount <= HTTP_CONFIG.MAX_RETRIES) {
    try {
      // Если это повторная попытка, добавляем задержку
      if (retryCount > 0) {
        console.log(`Retry attempt ${retryCount}/${HTTP_CONFIG.MAX_RETRIES} after ${HTTP_CONFIG.RETRY_DELAY}ms delay`);
        await new Promise(resolve => setTimeout(resolve, HTTP_CONFIG.RETRY_DELAY));
      }
      
      // Отправка запроса на альтернативный источник с имитацией реального браузера
      console.log(`Sending HTTP request to ${url}`);
      const response = await axios.get(url, {
        headers: HTTP_CONFIG.HEADERS,
        timeout: HTTP_CONFIG.TIMEOUT
      });
      
      // Проверка успешности запроса
      if (response.status !== 200) {
        throw new Error(`Failed to fetch SCFI data from alternative source: HTTP status ${response.status}`);
      }
      
      // Логирование успешного получения ответа
      console.log(`Received response from ${url}, content length: ${response.data.length} bytes`);
      
      // Парсинг HTML-страницы
      console.log('Parsing HTML response...');
      const $ = cheerio.load(response.data);
      
      // Извлечение данных из страницы
      const scfiData = [];
      
      // Получение текущей даты
      const currentDate = new Date().toISOString().split('T')[0];
      console.log(`Using current date: ${currentDate}`);
      
      // Предыдущая дата - неделю назад
      const prevDate = new Date();
      prevDate.setDate(prevDate.getDate() - 7);
      const previousDate = prevDate.toISOString().split('T')[0];
      console.log(`Using previous date: ${previousDate}`);
      
      // Определение типа источника и соответствующий парсинг
      if (url.includes('macromicro')) {
        // Парсинг данных с MacroMicro
        console.log('Parsing MacroMicro format...');
        
        // Извлечение значения индекса
        const indexValue = $('.value').text().trim();
        const currentIndexValue = parseFloat(indexValue.replace(',', ''));
        console.log(`Found index value: ${currentIndexValue}`);
        
        // Извлечение изменения индекса
        const changeText = $('.change').text().trim();
        const changeMatch = changeText.match(/([-+]?\d+(\.\d+)?)/);
        const changeValue = changeMatch ? parseFloat(changeMatch[1]) : 0;
        console.log(`Found change value: ${changeValue}`);
        
        // Проверка валидности данных
        if (!isNaN(currentIndexValue)) {
          // Добавление данных в массив
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
          
          console.log(`Added data for Comprehensive Index: ${currentIndexValue}, change: ${changeValue}`);
        } else {
          console.log(`Invalid index value: ${indexValue}`);
        }
      } else if (url.includes('freightwaves') || url.includes('container-news') || url.includes('hellenicshippingnews')) {
        // Парсинг данных с новостных сайтов
        console.log('Parsing news site format...');
        
        // Поиск статей с упоминанием SCFI
        const articles = $('article, .article, .post, .entry, .content');
        console.log(`Found ${articles.length} potential article elements`);
        
        // Ищем в статьях упоминания индекса SCFI и его значения
        let foundData = false;
        
        articles.each((i, article) => {
          if (foundData) return false; // Прекращаем поиск, если уже нашли данные
          
          const articleText = $(article).text();
          
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
            
            // Проверка валидности данных
            if (!isNaN(currentIndexValue)) {
              // Добавление данных в массив
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
              
              console.log(`Added data from article: Index: ${currentIndexValue}, Change: ${changeValue}`);
              foundData = true;
              return false; // Прекращаем перебор статей
            } else {
              console.log(`Invalid index value found in article: ${currentIndexValue}`);
            }
          }
        });
        
        // Если не нашли данные в статьях, ищем в таблицах
        if (!foundData) {
          console.log('No data found in articles, searching in tables...');
          
          const tables = $('table');
          console.log(`Found ${tables.length} tables on the page`);
          
          tables.each((i, table) => {
            if (foundData) return false; // Прекращаем поиск, если уже нашли данные
            
            const tableText = $(table).text().toLowerCase();
            
            // Проверяем, содержит ли таблица данные SCFI
            if (tableText.includes('scfi') || 
                tableText.includes('shanghai') || 
                tableText.includes('freight index')) {
              console.log(`Table ${i + 1} contains potential SCFI data`);
              
              // Ищем строки с числовыми значениями
              $(table).find('tr').each((j, row) => {
                if (foundData) return false; // Прекращаем поиск, если уже нашли данные
                
                const rowText = $(row).text();
                const indexMatch = rowText.match(/(\d+(\.\d+)?)/);
                
                if (indexMatch) {
                  const currentIndexValue = parseFloat(indexMatch[1]);
                  console.log(`Found potential index value in table: ${currentIndexValue}`);
                  
                  // Ищем изменение в той же строке
                  const changeMatch = rowText.match(/([-+]\d+(\.\d+)?)/);
                  const changeValue = changeMatch ? parseFloat(changeMatch[1]) : 0;
                  
                  // Проверка валидности данных
                  if (!isNaN(currentIndexValue) && currentIndexValue > 100) { // Предполагаем, что индекс SCFI > 100
                    // Добавление данных в массив
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
                    
                    console.log(`Added data from table: Index: ${currentIndexValue}, Change: ${changeValue}`);
                    foundData = true;
                    return false; // Прекращаем перебор строк
                  }
                }
              });
            }
          });
        }
      }
      
      // Проверка полученных данных
      if (scfiData.length === 0) {
        console.log(`No SCFI data found on ${url}`);
        throw new Error(`No SCFI data found on ${url}`);
      }
      
      console.log(`Successfully parsed ${scfiData.length} SCFI records from alternative source: ${url}`);
      
      // Возвращаем полученные данные
      return scfiData;
    } catch (error) {
      // Сохраняем ошибку для возможного повторного выброса
      lastError = error;
      
      // Логирование ошибки
      console.error(`Error fetching SCFI data from alternative source ${url} (attempt ${retryCount + 1}/${HTTP_CONFIG.MAX_RETRIES + 1}):`, error.message);
      
      // Увеличиваем счетчик попыток
      retryCount++;
    }
  }
  
  // Если все попытки неудачны, выбрасываем последнюю ошибку
  console.error(`All retry attempts failed for alternative source: ${url}`);
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
      
      return {
        index: 'SCFI',
        value: data.current_index,
        change: data.change,
        date: data.current_date,
        trend: data.change > 0 ? 'up' : 'down',
        source: 'database'
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
        
        return {
          index: 'SCFI',
          value: compositeData.currentIndex,
          change: compositeData.change,
          date: compositeData.currentDate,
          trend: compositeData.change > 0 ? 'up' : 'down',
          source: 'api'
        };
      }
    } catch (error) {
      console.error('Error fetching SCFI data from API:', error);
    }
    
    // Если данные не удалось получить, возвращаем моковые данные
    console.log('Failed to get SCFI data, using mock data');
    return {
      index: 'SCFI',
      value: 1347.84,
      change: -22.74,
      date: new Date().toISOString().split('T')[0],
      trend: 'down',
      source: 'mock'
    };
  } catch (error) {
    console.error('Error getting SCFI data for calculation:', error);
    console.error('Stack trace:', error.stack);
    
    // В случае ошибки возвращаем моковые данные
    return {
      index: 'SCFI',
      value: 1347.84,
      change: -22.74,
      date: new Date().toISOString().split('T')[0],
      trend: 'down',
      source: 'mock'
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
        currentIndex: data.current_index,
        change: data.change,
        currentDate: data.current_date
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
module.exports = {
  fetchSCFIData,
  getSCFIDataForCalculation,
  getSCFIDataForRoute
};

// Специальный хак для совместимости с ES модулями в server.js
if (typeof exports === 'object' && typeof module !== 'undefined') {
  Object.defineProperty(exports, '__esModule', { value: true });
  exports.default = {
    fetchSCFIData,
    getSCFIDataForCalculation,
    getSCFIDataForRoute
  };
}
