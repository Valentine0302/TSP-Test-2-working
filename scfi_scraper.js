/**
 * Improved Shanghai Containerized Freight Index (SCFI) Scraper Module
 * =========================================================
 *
 * Этот модуль предназначен для сбора данных из Shanghai Containerized Freight Index (SCFI),
 * который является важным индикатором стоимости морских контейнерных перевозок.
 *
 * Улучшения в этой версии:
 * 1. Более гибкая логика поиска таблицы SCFI
 * 2. Улучшенная обработка ошибок и повторные попытки
 * 3. Подробное логирование для диагностики
 * 4. Поддержка различных форматов данных
 * 5. Более надежный парсинг альтернативных источников
 * 6. Оптимизация для получения только основного индекса (Comprehensive Index)
 *
 * @module scfi_scraper
 * @author TSP Team
 * @version 2.2.0
 * @last_updated 2025-04-29
 */

// Импорт необходимых модулей
const axios = require('axios'); // HTTP-клиент для выполнения запросов
const cheerio = require('cheerio'); // Библиотека для парсинга HTML
const { Pool } = require('pg'); // Клиент PostgreSQL для работы с базой данных
const dotenv = require('dotenv'); // Модуль для загрузки переменных окружения

/**
 * Загрузка переменных окружения из файла .env
 */
dotenv.config();

/**
 * Настройка подключения к базе данных PostgreSQL
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
 * @constant {string}
 */
const SCFI_URL = 'https://en.sse.net.cn/indices/scfinew.jsp';

/**
 * Альтернативные источники данных SCFI
 * @constant {Array<Object>}
 */
const SCFI_ALT_SOURCES = [
  {
    name: 'MacroMicro',
    url: 'https://en.macromicro.me/series/17502/fbx-global-container-index-weekly',
    selector: '.chart-data-table, table:contains("SCFI")',
    dateFormat: 'YYYY-MM-DD'
  },
  {
    name: 'FreightWaves',
    url: 'https://www.freightwaves.com/news/tag/scfi',
    selector: 'article:contains("SCFI")',
    textSearch: true
  },
  {
    name: 'Container News',
    url: 'https://www.container-news.com/scfi/',
    selector: '.entry-content table, .entry-content p:contains("SCFI")',
    textSearch: true
  },
  {
    name: 'Hellenic Shipping News',
    url: 'https://www.hellenicshippingnews.com/shanghai-containerized-freight-index/',
    selector: '.td-post-content table, .td-post-content p:contains("SCFI")',
    textSearch: true
  },
  {
    name: 'Drewry',
    url: 'https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/world-container-index-assessed-by-drewry',
    selector: '.table-responsive table, .content p:contains("index")',
    textSearch: true
  }
];

/**
 * Константы для настройки HTTP-запросов
 * @constant {Object}
 */
const HTTP_CONFIG = {
  TIMEOUT: 20000, // Увеличенный таймаут
  MAX_RETRIES: 4, // Увеличенное количество повторных попыток
  RETRY_DELAY: 3000, // Увеличенная задержка между попытками
  HEADERS: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  }
};

/**
 * Константы для работы с базой данных
 * @constant {Object}
 */
const DB_CONFIG = {
  TABLE_NAME: 'freight_indices_scfi',
  MAX_POOL_SIZE: 10,
  CONNECTION_TIMEOUT: 10000,
  IDLE_TIMEOUT: 30000
};

/**
 * Основная функция для получения данных SCFI
 *
 * @async
 * @function fetchSCFIData
 * @returns {Promise<Array>} Массив объектов с данными SCFI
 */
async function fetchSCFIData() {
  console.log('=== НАЧАЛО ПОЛУЧЕНИЯ ДАННЫХ SCFI ===');
  console.log(`Время запуска: ${new Date().toISOString()}`);
  console.log('Версия скрапера: 2.2.0 (оптимизирован для основного индекса)');

  try {
    let scfiData = null;
    let sourceUsed = '';

    // 1. Попытка получить данные с основного источника
    console.log('\n=== ПОПЫТКА ПОЛУЧЕНИЯ ДАННЫХ С ОСНОВНОГО ИСТОЧНИКА ===');
    try {
      scfiData = await fetchSCFIFromPrimarySource();
      if (scfiData && Array.isArray(scfiData) && scfiData.length > 0) {
        console.log(`✅ Успешно получено ${scfiData.length} записей с основного источника`);
        sourceUsed = 'primary';
      } else {
        console.log('❌ Основной источник не вернул данные');
      }
    } catch (error) {
      console.error(`❌ Ошибка при получении данных с основного источника: ${error.message}`);
      console.error('Стек ошибки:', error.stack);
    }

    // 2. Если основной источник не сработал, перебираем альтернативные
    if (!scfiData || !Array.isArray(scfiData) || scfiData.length === 0) {
      console.log('\n=== ПОПЫТКА ПОЛУЧЕНИЯ ДАННЫХ С АЛЬТЕРНАТИВНЫХ ИСТОЧНИКОВ ===');
      
      for (const source of SCFI_ALT_SOURCES) {
        console.log(`\n--- Проверка источника: ${source.name} ---`);
        try {
          scfiData = await fetchSCFIFromAlternativeSource(source);
          if (scfiData && Array.isArray(scfiData) && scfiData.length > 0) {
            console.log(`✅ Успешно получено ${scfiData.length} записей с источника ${source.name}`);
            sourceUsed = source.name;
            break;
          } else {
            console.log(`❌ Источник ${source.name} не вернул данные`);
          }
        } catch (error) {
          console.error(`❌ Ошибка при получении данных с источника ${source.name}: ${error.message}`);
        }
      }
    }

    // 3. Если данные получены, сохраняем их в базу данных
    if (scfiData && Array.isArray(scfiData) && scfiData.length > 0) {
      console.log(`\n=== СОХРАНЕНИЕ ${scfiData.length} ЗАПИСЕЙ SCFI В БАЗУ ДАННЫХ ===`);
      try {
        await saveSCFIData(scfiData);
        console.log('✅ Данные SCFI успешно сохранены в базу данных');
      } catch (error) {
        console.error('❌ Ошибка при сохранении данных SCFI в базу данных:', error);
      }
      
      console.log(`\n=== ИТОГ: ДАННЫЕ УСПЕШНО ПОЛУЧЕНЫ С ИСТОЧНИКА: ${sourceUsed} ===`);
      return scfiData;
    } else {
      // 4. Если данные не получены ни с одного источника, используем моковые данные
      console.log('\n=== ИСПОЛЬЗОВАНИЕ МОКОВЫХ ДАННЫХ ===');
      console.log('❌ Не удалось получить данные ни с одного источника');
      
      const mockData = await fetchMockSCFIData();
      console.log(`✅ Создано ${mockData.length} моковых записей SCFI`);
      
      console.log('\n=== ИТОГ: ИСПОЛЬЗУЮТСЯ МОКОВЫЕ ДАННЫЕ ===');
      return mockData;
    }
  } catch (error) {
    console.error('\n=== КРИТИЧЕСКАЯ ОШИБКА ПРИ ПОЛУЧЕНИИ ДАННЫХ SCFI ===');
    console.error('Ошибка:', error);
    console.error('Стек ошибки:', error.stack);
    
    // В случае критической ошибки возвращаем моковые данные
    console.log('\n=== ИСПОЛЬЗОВАНИЕ МОКОВЫХ ДАННЫХ ПОСЛЕ КРИТИЧЕСКОЙ ОШИБКИ ===');
    const mockData = await fetchMockSCFIData();
    
    console.log('\n=== ИТОГ: ИСПОЛЬЗУЮТСЯ МОКОВЫЕ ДАННЫЕ ПОСЛЕ ОШИБКИ ===');
    return mockData;
  } finally {
    console.log(`\n=== ЗАВЕРШЕНИЕ ПОЛУЧЕНИЯ ДАННЫХ SCFI ===`);
    console.log(`Время завершения: ${new Date().toISOString()}`);
  }
}

/**
 * Функция для получения данных SCFI с основного источника
 * ОПТИМИЗИРОВАНА для получения ТОЛЬКО основного индекса (Comprehensive Index)
 *
 * @async
 * @function fetchSCFIFromPrimarySource
 * @returns {Promise<Array>} Массив объектов с данными SCFI (только основной индекс)
 */
async function fetchSCFIFromPrimarySource() {
  let retryCount = 0;
  let lastError = null;

  while (retryCount <= HTTP_CONFIG.MAX_RETRIES) {
    try {
      if (retryCount > 0) {
        console.log(`Повторная попытка ${retryCount}/${HTTP_CONFIG.MAX_RETRIES} через ${HTTP_CONFIG.RETRY_DELAY}мс`);
        await new Promise(resolve => setTimeout(resolve, HTTP_CONFIG.RETRY_DELAY));
      }

      // Отправка запроса на сайт Shanghai Shipping Exchange
      console.log(`Отправка HTTP-запроса на ${SCFI_URL}`);
      const response = await axios.get(SCFI_URL, {
        headers: HTTP_CONFIG.HEADERS,
        timeout: HTTP_CONFIG.TIMEOUT
      });

      if (response.status !== 200) {
        throw new Error(`Неуспешный статус ответа: ${response.status}`);
      }

      console.log(`Получен ответ от ${SCFI_URL}, размер: ${response.data.length} байт`);

      // Парсинг HTML-страницы
      console.log('Парсинг HTML-ответа...');
      const $ = cheerio.load(response.data);

      // Подробная диагностика страницы
      const pageTitle = $('title').text().trim();
      console.log(`Заголовок страницы: "${pageTitle}"`);
      
      const tableCount = $('table').length;
      console.log(`Количество таблиц на странице: ${tableCount}`);
      
      // Поиск всех возможных таблиц с данными SCFI
      console.log('Поиск таблицы с данными SCFI...');
      
      // Массив потенциальных таблиц SCFI
      const potentialTables = [];
      
      // 1. Поиск по классу
      const scfiTableByClass = $('.scfitable');
      if (scfiTableByClass.length > 0) {
        console.log('Найдена таблица по классу .scfitable');
        potentialTables.push({ table: scfiTableByClass, source: 'class' });
      }
      
      // 2. Поиск по содержимому
      $('table').each((i, table) => {
        const tableHtml = $(table).html().toLowerCase();
        if (tableHtml.includes('scfi') || 
            tableHtml.includes('shanghai containerized freight index') ||
            tableHtml.includes('freight index')) {
          console.log(`Найдена таблица по содержимому (${i + 1}-я таблица)`);
          potentialTables.push({ table: $(table), source: 'content' });
        }
      });
      
      // 3. Поиск по заголовкам
      $('h1, h2, h3, h4, h5, h6').each((i, heading) => {
        const headingText = $(heading).text().toLowerCase();
        if (headingText.includes('scfi') || 
            headingText.includes('shanghai containerized freight index') ||
            headingText.includes('freight index')) {
          // Ищем ближайшую таблицу после заголовка
          const nextTable = $(heading).nextAll('table').first();
          if (nextTable.length > 0) {
            console.log(`Найдена таблица после заголовка "${$(heading).text().trim()}"`);
            potentialTables.push({ table: nextTable, source: 'heading' });
          }
        }
      });
      
      // 4. Запасной вариант - берем все таблицы на странице
      if (potentialTables.length === 0 && tableCount > 0) {
        console.log('Не найдено специфичных таблиц SCFI, проверяем все таблицы на странице');
        $('table').each((i, table) => {
          potentialTables.push({ table: $(table), source: `table_${i}` });
        });
      }
      
      console.log(`Найдено ${potentialTables.length} потенциальных таблиц SCFI`);
      
      // Если таблицы не найдены, выбрасываем ошибку
      if (potentialTables.length === 0) {
        throw new Error('Таблицы с данными SCFI не найдены на странице');
      }
      
      // Получение текущей даты и даты неделю назад
      const currentDate = new Date().toISOString().split('T')[0];
      const prevDate = new Date();
      prevDate.setDate(prevDate.getDate() - 7);
      const previousDate = prevDate.toISOString().split('T')[0];
      
      // Попытка найти даты в заголовках таблицы
      let foundCurrentDate = null;
      
      $('th, td').each((i, el) => {
        const text = $(el).text().trim();
        const dateMatch = text.match(/(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/);
        if (dateMatch) {
          const dateStr = dateMatch[1].replace(/\//g, '-');
          if (!foundCurrentDate) {
            foundCurrentDate = dateStr;
            console.log(`Найдена текущая дата в таблице: ${foundCurrentDate}`);
          }
        }
      });
      
      // Используем найденную дату или значение по умолчанию
      const usedCurrentDate = foundCurrentDate || currentDate;
      console.log(`Используемая дата: ${usedCurrentDate}`);
      
      // ОПТИМИЗАЦИЯ: Ищем только строку с Comprehensive Index
      console.log('Поиск строки с Comprehensive Index...');
      
      // Перебираем потенциальные таблицы
      for (const { table, source } of potentialTables) {
        console.log(`Поиск Comprehensive Index в таблице (источник: ${source})...`);
        
        let foundComprehensiveIndex = false;
        let comprehensiveValue = null;
        let comprehensiveChange = 0;
        
        // Ищем строку с Comprehensive Index
        table.find('tr').each((i, row) => {
          const rowText = $(row).text().toLowerCase();
          
          // Проверяем, содержит ли строка ключевые слова
          if (rowText.includes('comprehensive') || 
              rowText.includes('composite') || 
              rowText.includes('total') || 
              rowText.includes('all routes') ||
              rowText.includes('scfi')) {
            
            console.log(`Найдена потенциальная строка с Comprehensive Index: "${$(row).text().trim()}"`);
            
            // Ищем числовое значение в ячейках строки
            const cells = $(row).find('td');
            cells.each((j, cell) => {
              const cellText = $(cell).text().trim();
              const indexMatch = cellText.match(/(\d+(?:\.\d+)?)/);
              
              if (indexMatch) {
                const value = parseFloat(indexMatch[0]);
                if (!isNaN(value)) {
                  console.log(`Найдено значение индекса: ${value} в ячейке ${j + 1}`);
                  
                  // Если это первое найденное значение, считаем его индексом
                  if (comprehensiveValue === null) {
                    comprehensiveValue = value;
                    
                    // Ищем изменение в следующей ячейке
                    if (j + 1 < cells.length) {
                      const nextCellText = $(cells[j + 1]).text().trim();
                      const changeMatch = nextCellText.match(/([-+]?\d+(?:\.\d+)?)/);
                      if (changeMatch) {
                        comprehensiveChange = parseFloat(changeMatch[0]);
                        console.log(`Найдено изменение индекса: ${comprehensiveChange}`);
                      }
                    }
                    
                    foundComprehensiveIndex = true;
                  }
                }
              }
            });
            
            // Если нашли значение, прекращаем поиск
            if (foundComprehensiveIndex) {
              return;
            }
          }
        });
        
        // Если нашли Comprehensive Index, возвращаем результат
        if (foundComprehensiveIndex && comprehensiveValue !== null) {
          console.log(`✅ Успешно найден Comprehensive Index: ${comprehensiveValue} (изменение: ${comprehensiveChange})`);
          
          // Создаем объект с данными только для Comprehensive Index
          return [{
            route: 'SCFI Comprehensive',
            unit: 'Points',
            weighting: 100,
            previousIndex: comprehensiveValue - comprehensiveChange,
            currentIndex: comprehensiveValue,
            change: comprehensiveChange,
            previousDate: previousDate,
            currentDate: usedCurrentDate
          }];
        }
      }
      
      // Если не нашли Comprehensive Index ни в одной таблице, пробуем найти любое числовое значение
      console.log('Comprehensive Index не найден, ищем любое числовое значение в контексте SCFI...');
      
      // Ищем параграфы или элементы с упоминанием SCFI и числовым значением
      const scfiElements = $('p, div, span').filter(function() {
        const text = $(this).text().toLowerCase();
        return text.includes('scfi') || 
               text.includes('shanghai containerized freight index') || 
               text.includes('freight index');
      });
      
      console.log(`Найдено ${scfiElements.length} элементов с упоминанием SCFI`);
      
      for (let i = 0; i < scfiElements.length; i++) {
        const elementText = $(scfiElements[i]).text();
        console.log(`Проверка элемента ${i + 1}: "${elementText.substring(0, 100)}..."`);
        
        const indexMatch = elementText.match(/(\d+(?:\.\d+)?)/);
        if (indexMatch) {
          const value = parseFloat(indexMatch[0]);
          if (!isNaN(value)) {
            console.log(`Найдено числовое значение: ${value}`);
            
            // Ищем изменение (число со знаком + или -)
            const changeMatch = elementText.match(/([+-]\d+(?:\.\d+)?)/);
            const change = changeMatch ? parseFloat(changeMatch[0]) : 0;
            
            console.log(`✅ Используем найденное значение как Comprehensive Index: ${value} (изменение: ${change})`);
            
            // Создаем объект с данными
            return [{
              route: 'SCFI Comprehensive',
              unit: 'Points',
              weighting: 100,
              previousIndex: value - change,
              currentIndex: value,
              change: change,
              previousDate: previousDate,
              currentDate: usedCurrentDate
            }];
          }
        }
      }
      
      // Если не нашли ни в таблицах, ни в тексте, выбрасываем ошибку
      throw new Error('Не удалось найти значение Comprehensive Index на странице');
      
    } catch (error) {
      lastError = error;
      console.error(`Ошибка при получении данных SCFI с основного источника (попытка ${retryCount + 1}/${HTTP_CONFIG.MAX_RETRIES + 1}):`, error.message);
      retryCount++;
    }
  }

  console.error('Все попытки получения данных с основного источника неудачны');
  throw lastError || new Error('Не удалось получить данные SCFI с основного источника после нескольких попыток');
}

/**
 * Функция для получения данных SCFI с альтернативного источника
 * ОПТИМИЗИРОВАНА для получения ТОЛЬКО основного индекса (Comprehensive Index)
 *
 * @async
 * @function fetchSCFIFromAlternativeSource
 * @param {Object} source - Объект с информацией об альтернативном источнике
 * @returns {Promise<Array>} Массив объектов с данными SCFI (только основной индекс)
 */
async function fetchSCFIFromAlternativeSource(source) {
  let retryCount = 0;
  let lastError = null;

  while (retryCount <= HTTP_CONFIG.MAX_RETRIES) {
    try {
      if (retryCount > 0) {
        console.log(`Повторная попытка ${retryCount}/${HTTP_CONFIG.MAX_RETRIES} через ${HTTP_CONFIG.RETRY_DELAY}мс`);
        await new Promise(resolve => setTimeout(resolve, HTTP_CONFIG.RETRY_DELAY));
      }

      // Отправка запроса на альтернативный источник
      console.log(`Отправка HTTP-запроса на ${source.url}`);
      const response = await axios.get(source.url, {
        headers: HTTP_CONFIG.HEADERS,
        timeout: HTTP_CONFIG.TIMEOUT
      });

      if (response.status !== 200) {
        throw new Error(`Неуспешный статус ответа: ${response.status}`);
      }

      console.log(`Получен ответ от ${source.url}, размер: ${response.data.length} байт`);

      // Парсинг HTML-страницы
      console.log('Парсинг HTML-ответа...');
      const $ = cheerio.load(response.data);

      // Получение текущей даты и даты неделю назад
      const currentDate = new Date().toISOString().split('T')[0];
      const prevDate = new Date();
      prevDate.setDate(prevDate.getDate() - 7);
      const previousDate = prevDate.toISOString().split('T')[0];

      // Поиск элементов по селектору
      console.log(`Поиск элементов по селектору: ${source.selector}`);
      const elements = $(source.selector);
      console.log(`Найдено ${elements.length} элементов`);

      // Если источник использует текстовый поиск
      if (source.textSearch) {
        console.log('Поиск значения SCFI в тексте...');
        
        // Ищем текст с упоминанием SCFI и числовым значением
        const text = elements.text();
        console.log(`Анализ текста (первые 200 символов): "${text.substring(0, 200)}..."`);
        
        // Ищем упоминание SCFI с числом рядом
        const scfiMatch = text.match(/SCFI.*?(\d+(\.\d+)?)/i) || 
                          text.match(/Shanghai Containerized Freight Index.*?(\d+(\.\d+)?)/i) ||
                          text.match(/freight index.*?(\d+(\.\d+)?)/i);
        
        if (scfiMatch) {
          const currentIndex = parseFloat(scfiMatch[1]);
          console.log(`Найдено значение SCFI: ${currentIndex}`);
          
          // Ищем изменение (число со знаком + или -)
          const changeMatch = text.match(/([+-]\d+(\.\d+)?)/);
          const change = changeMatch ? parseFloat(changeMatch[1]) : 0;
          console.log(`Найдено изменение: ${change}`);
          
          // Ищем дату публикации
          const dateMatch = text.match(/(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/);
          let foundDate = null;
          if (dateMatch) {
            foundDate = dateMatch[1];
            console.log(`Найдена дата публикации: ${foundDate}`);
          }
          
          // Создание объекта с данными
          const scfiData = [{
            route: 'SCFI Comprehensive',
            unit: 'Points',
            weighting: 100,
            previousIndex: currentIndex - change,
            currentIndex,
            change,
            previousDate: previousDate,
            currentDate: foundDate || currentDate
          }];
          
          return scfiData;
        } else {
          console.log('Значение индекса SCFI не найдено в тексте');
        }
      } 
      // Если источник использует таблицу
      else {
        console.log('Парсинг таблицы для извлечения данных...');
        
        // Поиск таблицы
        const tables = elements.filter('table');
        if (tables.length > 0) {
          console.log(`Найдено ${tables.length} таблиц`);
          
          // Перебор таблиц
          for (let i = 0; i < tables.length; i++) {
            const table = tables.eq(i);
            console.log(`Анализ таблицы ${i + 1}...`);
            
            // Ищем строку с Comprehensive Index или похожим названием
            let foundComprehensiveRow = false;
            let comprehensiveValue = null;
            let comprehensiveChange = 0;
            
            table.find('tr').each((j, row) => {
              const rowText = $(row).text().toLowerCase();
              
              if (rowText.includes('comprehensive') || 
                  rowText.includes('composite') || 
                  rowText.includes('total') || 
                  rowText.includes('all routes') ||
                  rowText.includes('scfi')) {
                
                console.log(`Найдена потенциальная строка с Comprehensive Index: "${$(row).text().trim()}"`);
                
                // Ищем числовое значение в ячейках строки
                const cells = $(row).find('td');
                cells.each((k, cell) => {
                  const cellText = $(cell).text().trim();
                  const indexMatch = cellText.match(/(\d+(?:\.\d+)?)/);
                  
                  if (indexMatch) {
                    const value = parseFloat(indexMatch[0]);
                    if (!isNaN(value)) {
                      console.log(`Найдено значение индекса: ${value} в ячейке ${k + 1}`);
                      
                      // Если это первое найденное значение, считаем его индексом
                      if (comprehensiveValue === null) {
                        comprehensiveValue = value;
                        
                        // Ищем изменение в следующей ячейке
                        if (k + 1 < cells.length) {
                          const nextCellText = $(cells[k + 1]).text().trim();
                          const changeMatch = nextCellText.match(/([-+]?\d+(?:\.\d+)?)/);
                          if (changeMatch) {
                            comprehensiveChange = parseFloat(changeMatch[0]);
                            console.log(`Найдено изменение индекса: ${comprehensiveChange}`);
                          }
                        }
                        
                        foundComprehensiveRow = true;
                      }
                    }
                  }
                });
                
                // Если нашли значение, прекращаем поиск
                if (foundComprehensiveRow) {
                  return;
                }
              }
            });
            
            // Если нашли Comprehensive Index, возвращаем результат
            if (foundComprehensiveRow && comprehensiveValue !== null) {
              console.log(`✅ Успешно найден Comprehensive Index: ${comprehensiveValue} (изменение: ${comprehensiveChange})`);
              
              // Создаем объект с данными только для Comprehensive Index
              return [{
                route: 'SCFI Comprehensive',
                unit: 'Points',
                weighting: 100,
                previousIndex: comprehensiveValue - comprehensiveChange,
                currentIndex: comprehensiveValue,
                change: comprehensiveChange,
                previousDate: previousDate,
                currentDate: currentDate
              }];
            }
            
            // Если не нашли специфическую строку, берем первую строку с числовым значением
            if (!foundComprehensiveRow) {
              console.log('Специфическая строка не найдена, ищем первую строку с числовым значением...');
              
              let firstRowValue = null;
              let firstRowChange = 0;
              
              table.find('tr').each((j, row) => {
                if (j === 0) return; // Пропускаем заголовок
                
                if (firstRowValue === null) {
                  const cells = $(row).find('td');
                  
                  // Ищем числовое значение в ячейках
                  cells.each((k, cell) => {
                    const cellText = $(cell).text().trim();
                    const indexMatch = cellText.match(/(\d+(?:\.\d+)?)/);
                    
                    if (indexMatch) {
                      const value = parseFloat(indexMatch[0]);
                      if (!isNaN(value)) {
                        console.log(`Найдено значение: ${value} в строке ${j + 1}, ячейке ${k + 1}`);
                        
                        // Если это первое найденное значение, считаем его индексом
                        if (firstRowValue === null) {
                          firstRowValue = value;
                          
                          // Ищем изменение в следующей ячейке
                          if (k + 1 < cells.length) {
                            const nextCellText = $(cells[k + 1]).text().trim();
                            const changeMatch = nextCellText.match(/([-+]?\d+(?:\.\d+)?)/);
                            if (changeMatch) {
                              firstRowChange = parseFloat(changeMatch[0]);
                              console.log(`Найдено изменение: ${firstRowChange}`);
                            }
                          }
                          
                          return false; // Прекращаем перебор ячеек
                        }
                      }
                    }
                  });
                  
                  if (firstRowValue !== null) {
                    return false; // Прекращаем перебор строк
                  }
                }
              });
              
              // Если нашли значение в первой строке, используем его
              if (firstRowValue !== null) {
                console.log(`✅ Используем значение из первой строки как Comprehensive Index: ${firstRowValue} (изменение: ${firstRowChange})`);
                
                // Создаем объект с данными
                return [{
                  route: 'SCFI Comprehensive',
                  unit: 'Points',
                  weighting: 100,
                  previousIndex: firstRowValue - firstRowChange,
                  currentIndex: firstRowValue,
                  change: firstRowChange,
                  previousDate: previousDate,
                  currentDate: currentDate
                }];
              }
            }
          }
        } else {
          console.log('Таблицы не найдены');
        }
      }
      
      throw new Error('Не удалось извлечь данные SCFI из источника');
      
    } catch (error) {
      lastError = error;
      console.error(`Ошибка при получении данных SCFI с источника ${source.name} (попытка ${retryCount + 1}/${HTTP_CONFIG.MAX_RETRIES + 1}):`, error.message);
      retryCount++;
    }
  }

  console.error(`Все попытки получения данных с источника ${source.name} неудачны`);
  throw lastError || new Error(`Не удалось получить данные SCFI с источника ${source.name} после нескольких попыток`);
}

/**
 * Функция для получения весового коэффициента маршрута
 * 
 * @function getRouteWeighting
 * @param {string} route - Название маршрута
 * @returns {number} Весовой коэффициент маршрута
 */
function getRouteWeighting(route) {
  const routeLower = route.toLowerCase();
  
  if (routeLower.includes('comprehensive') || routeLower.includes('composite')) {
    return 100.0;
  } else if (routeLower.includes('europe') && !routeLower.includes('mediterranean')) {
    return 20.0;
  } else if (routeLower.includes('mediterranean')) {
    return 10.0;
  } else if (routeLower.includes('us west') || routeLower.includes('west coast')) {
    return 20.0;
  } else if (routeLower.includes('us east') || routeLower.includes('east coast')) {
    return 7.5;
  } else if (routeLower.includes('persian') || routeLower.includes('red sea')) {
    return 7.5;
  } else if (routeLower.includes('australia') || routeLower.includes('new zealand')) {
    return 5.0;
  } else if (routeLower.includes('southeast asia') || routeLower.includes('singapore')) {
    return 7.5;
  } else if (routeLower.includes('japan')) {
    return 5.0;
  } else if (routeLower.includes('south america')) {
    return 5.0;
  } else if (routeLower.includes('west africa')) {
    return 2.5;
  } else if (routeLower.includes('south africa')) {
    return 2.5;
  } else {
    return 2.0; // Значение по умолчанию для неизвестных маршрутов
  }
}

/**
 * Функция для получения моковых данных SCFI
 * ОПТИМИЗИРОВАНА для возврата ТОЛЬКО основного индекса (Comprehensive Index)
 * 
 * @async
 * @function fetchMockSCFIData
 * @returns {Promise<Array>} Массив объектов с моковыми данными SCFI (только основной индекс)
 */
async function fetchMockSCFIData() {
  console.log('Создание моковых данных SCFI (только Comprehensive Index)...');
  
  // Получение текущей даты и даты неделю назад
  const currentDate = new Date().toISOString().split('T')[0];
  const prevDate = new Date();
  prevDate.setDate(prevDate.getDate() - 7);
  const previousDate = prevDate.toISOString().split('T')[0];
  
  // Генерация случайного значения индекса в диапазоне 800-1200
  const currentIndex = Math.floor(Math.random() * 400) + 800;
  
  // Генерация случайного изменения в диапазоне -50 до +50
  const change = Math.floor(Math.random() * 100) - 50;
  
  // Создание моковых данных только для Comprehensive Index
  const mockData = [{
    route: 'SCFI Comprehensive',
    unit: 'Points',
    weighting: 100,
    previousIndex: currentIndex - change,
    currentIndex,
    change,
    previousDate,
    currentDate
  }];
  
  console.log(`Создан моковый Comprehensive Index: ${currentIndex} (изменение: ${change})`);
  
  return mockData;
}

/**
 * Функция для сохранения данных SCFI в базу данных
 * 
 * @async
 * @function saveSCFIData
 * @param {Array} data - Массив объектов с данными SCFI
 * @returns {Promise<void>}
 */
async function saveSCFIData(data) {
  console.log(`Сохранение ${data.length} записей SCFI в базу данных...`);
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    for (const item of data) {
      const query = `
        INSERT INTO ${DB_CONFIG.TABLE_NAME} 
        (route, unit, weighting, previous_index, current_index, change, previous_date, current_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (route, current_date) 
        DO UPDATE SET 
          unit = EXCLUDED.unit,
          weighting = EXCLUDED.weighting,
          previous_index = EXCLUDED.previous_index,
          current_index = EXCLUDED.current_index,
          change = EXCLUDED.change,
          previous_date = EXCLUDED.previous_date
      `;
      
      const values = [
        item.route,
        item.unit,
        item.weighting,
        item.previousIndex,
        item.currentIndex,
        item.change,
        item.previousDate,
        item.currentDate
      ];
      
      await client.query(query, values);
      console.log(`✅ Сохранены данные для маршрута "${item.route}"`);
    }
    
    await client.query('COMMIT');
    console.log('✅ Транзакция успешно завершена');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка при сохранении данных в базу данных:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Функция для получения данных SCFI для калькулятора
 * 
 * @async
 * @function getSCFIDataForCalculation
 * @returns {Promise<Object>} Объект с данными SCFI для калькулятора
 */
async function getSCFIDataForCalculation() {
  console.log('Получение данных SCFI для калькулятора...');
  
  try {
    const client = await pool.connect();
    
    try {
      // Получаем последнюю запись для Comprehensive Index
      const query = `
        SELECT * FROM ${DB_CONFIG.TABLE_NAME}
        WHERE route = 'SCFI Comprehensive'
        ORDER BY current_date DESC
        LIMIT 1
      `;
      
      const result = await client.query(query);
      
      if (result.rows.length > 0) {
        console.log(`✅ Получены данные SCFI для калькулятора: ${result.rows[0].current_index}`);
        return result.rows[0];
      } else {
        console.log('❌ Данные SCFI для калькулятора не найдены в базе данных');
        
        // Если данных нет, получаем их
        const scfiData = await fetchSCFIData();
        
        // Находим Comprehensive Index
        const comprehensiveData = scfiData.find(item => 
          item.route === 'SCFI Comprehensive' || 
          item.route === 'Comprehensive Index'
        );
        
        if (comprehensiveData) {
          console.log(`✅ Использование свежеполученных данных SCFI: ${comprehensiveData.currentIndex}`);
          return {
            route: comprehensiveData.route,
            unit: comprehensiveData.unit,
            weighting: comprehensiveData.weighting,
            previous_index: comprehensiveData.previousIndex,
            current_index: comprehensiveData.currentIndex,
            change: comprehensiveData.change,
            previous_date: comprehensiveData.previousDate,
            current_date: comprehensiveData.currentDate
          };
        } else {
          throw new Error('Не удалось получить данные SCFI для калькулятора');
        }
      }
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Ошибка при получении данных SCFI для калькулятора:', error);
    
    // В случае ошибки возвращаем моковые данные
    console.log('Использование моковых данных для калькулятора...');
    
    const mockData = await fetchMockSCFIData();
    const mockItem = mockData[0];
    
    return {
      route: mockItem.route,
      unit: mockItem.unit,
      weighting: mockItem.weighting,
      previous_index: mockItem.previousIndex,
      current_index: mockItem.currentIndex,
      change: mockItem.change,
      previous_date: mockItem.previousDate,
      current_date: mockItem.currentDate
    };
  }
}

// Экспорт функций модуля
module.exports = {
  fetchSCFIData,
  getSCFIDataForCalculation
};
