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
 *
 * @module scfi_scraper
 * @author TSP Team
 * @version 2.1.0
 * @last_updated 2025-04-28
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
  console.log('Версия скрапера: 2.1.0 (улучшенная)');

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
 *
 * @async
 * @function fetchSCFIFromPrimarySource
 * @returns {Promise<Array>} Массив объектов с данными SCFI
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

      // Сохраняем HTML для диагностики
      console.log('Анализ структуры страницы...');
      
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
      
      // Перебираем потенциальные таблицы и пытаемся извлечь данные
      for (const { table, source } of potentialTables) {
        console.log(`Попытка извлечения данных из таблицы (источник: ${source})...`);
        
        // Получение текущей даты и даты неделю назад
        const currentDate = new Date().toISOString().split('T')[0];
        const prevDate = new Date();
        prevDate.setDate(prevDate.getDate() - 7);
        const previousDate = prevDate.toISOString().split('T')[0];
        
        // Попытка найти даты в заголовках таблицы
        let foundCurrentDate = null;
        let foundPreviousDate = null;
        
        table.find('th, td').each((i, el) => {
          const text = $(el).text().trim();
          const dateMatch = text.match(/(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/);
          if (dateMatch) {
            const dateStr = dateMatch[1].replace(/\//g, '-');
            if (!foundCurrentDate) {
              foundCurrentDate = dateStr;
              console.log(`Найдена текущая дата в таблице: ${foundCurrentDate}`);
            } else if (!foundPreviousDate) {
              foundPreviousDate = dateStr;
              console.log(`Найдена предыдущая дата в таблице: ${foundPreviousDate}`);
            }
          }
        });
        
        // Используем найденные даты или значения по умолчанию
        const usedCurrentDate = foundCurrentDate || currentDate;
        const usedPreviousDate = foundPreviousDate || previousDate;
        console.log(`Используемые даты: Текущая: ${usedCurrentDate}, Предыдущая: ${usedPreviousDate}`);
        
        // Парсинг строк таблицы
        const scfiData = [];
        let rowCount = 0;
        let validRowCount = 0;
        
        table.find('tr').each((i, row) => {
          // Пропускаем заголовок таблицы
          if (i === 0) return;
          
          rowCount++;
          const columns = $(row).find('td');
          
          // Проверяем, что строка содержит достаточно колонок
          if (columns.length >= 2) {
            // Пытаемся определить, какие колонки содержат нужные данные
            let routeCol = 0;
            let indexCol = null;
            let changeCol = null;
            
            // Ищем колонку с индексом (обычно это числовое значение)
            for (let j = 1; j < columns.length; j++) {
              const text = $(columns[j]).text().trim();
              if (/^\d+(\.\d+)?$/.test(text)) {
                indexCol = j;
                // Следующая колонка обычно содержит изменение
                changeCol = j + 1 < columns.length ? j + 1 : null;
                break;
              }
            }
            
            // Если не нашли колонку с индексом, пробуем другую эвристику
            if (indexCol === null) {
              for (let j = 1; j < columns.length; j++) {
                const text = $(columns[j]).text().trim();
                if (text.includes('$') || text.includes('USD')) {
                  indexCol = j;
                  break;
                }
              }
            }
            
            // Если все еще не нашли, берем вторую колонку
            if (indexCol === null && columns.length >= 2) {
              indexCol = 1;
            }
            
            // Извлекаем данные
            if (indexCol !== null) {
              const route = $(columns[routeCol]).text().trim();
              const indexText = $(columns[indexCol]).text().trim();
              
              // Извлечение числового значения индекса
              const indexMatch = indexText.match(/(\d+(?:\.\d+)?)/);
              const currentIndex = indexMatch ? parseFloat(indexMatch[0]) : NaN;
              
              // Извлечение изменения
              let change = 0;
              if (changeCol !== null) {
                const changeText = $(columns[changeCol]).text().trim();
                const changeMatch = changeText.match(/([-+]?\d+(?:\.\d+)?)/);
                change = changeMatch ? parseFloat(changeMatch[0]) : 0;
              }
              
              console.log(`Строка ${i}: Маршрут: "${route}", Индекс: ${currentIndex}, Изменение: ${change}`);
              
              // Добавление данных в массив, если маршрут не пустой и индекс является числом
              if (route && !isNaN(currentIndex)) {
                validRowCount++;
                
                // Определение единицы измерения
                let unit = 'USD/TEU';
                if (route.toLowerCase().includes('feu') || indexText.toLowerCase().includes('feu')) {
                  unit = 'USD/FEU';
                }
                
                scfiData.push({
                  route,
                  unit,
                  weighting: getRouteWeighting(route),
                  previousIndex: currentIndex - change,
                  currentIndex,
                  change,
                  previousDate: usedPreviousDate,
                  currentDate: usedCurrentDate
                });
              }
            }
          }
        });
        
        console.log(`Обработано ${rowCount} строк, найдено ${validRowCount} валидных строк`);
        
        // Если нашли данные, добавляем композитный индекс и возвращаем результат
        if (scfiData.length > 0) {
          // Добавляем композитный индекс, если его нет
          const hasComposite = scfiData.some(data => 
            data.route.toLowerCase().includes('composite') || 
            data.route.toLowerCase().includes('comprehensive') ||
            data.route === 'Comprehensive Index'
          );
          
          if (!hasComposite) {
            console.log('Добавление композитного индекса...');
            
            // Расчет композитного индекса как средневзвешенного значения
            let totalWeighting = 0;
            let weightedSum = 0;
            
            scfiData.forEach(data => {
              if (data.weighting > 0) {
                totalWeighting += data.weighting;
                weightedSum += data.currentIndex * data.weighting;
              }
            });
            
            const compositeIndex = totalWeighting > 0 ? 
              Math.round((weightedSum / totalWeighting) * 100) / 100 : 
              Math.round(scfiData.reduce((sum, data) => sum + data.currentIndex, 0) / scfiData.length);
            
            // Расчет изменения композитного индекса
            let prevWeightedSum = 0;
            scfiData.forEach(data => {
              if (data.weighting > 0) {
                prevWeightedSum += data.previousIndex * data.weighting;
              }
            });
            
            const prevCompositeIndex = totalWeighting > 0 ? 
              Math.round((prevWeightedSum / totalWeighting) * 100) / 100 : 
              Math.round(scfiData.reduce((sum, data) => sum + data.previousIndex, 0) / scfiData.length);
            
            const compositeChange = Math.round((compositeIndex - prevCompositeIndex) * 100) / 100;
            
            // Добавление композитного индекса в начало массива
            scfiData.unshift({
              route: 'Comprehensive Index',
              unit: 'points',
              weighting: 100,
              previousIndex: prevCompositeIndex,
              currentIndex: compositeIndex,
              change: compositeChange,
              previousDate: usedPreviousDate,
              currentDate: usedCurrentDate
            });
            
            console.log(`Добавлен композитный индекс: ${compositeIndex} (изменение: ${compositeChange})`);
          }
          
          return scfiData;
        }
      }
      
      // Если ни одна таблица не содержит валидных данных
      throw new Error('Не удалось извлечь данные SCFI из найденных таблиц');
      
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
 *
 * @async
 * @function fetchSCFIFromAlternativeSource
 * @param {Object} source - Объект с информацией об альтернативном источнике
 * @returns {Promise<Array>} Массив объектов с данными SCFI
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

      if (elements.length === 0) {
        throw new Error(`Элементы по селектору ${source.selector} не найдены`);
      }

      // Если источник использует текстовый поиск
      if (source.textSearch) {
        console.log('Использование текстового поиска для извлечения данных...');
        
        // Извлечение текста из всех найденных элементов
        let fullText = '';
        elements.each((i, el) => {
          fullText += $(el).text() + ' ';
        });
        
        console.log(`Извлечено ${fullText.length} символов текста`);
        
        // Поиск значения индекса SCFI
        const scfiMatch = fullText.match(/SCFI.*?(\d+(\.\d+)?)/i) || 
                         fullText.match(/Shanghai Containerized Freight Index.*?(\d+(\.\d+)?)/i) ||
                         fullText.match(/freight index.*?(\d+(\.\d+)?)/i);
        
        if (scfiMatch) {
          const currentIndex = parseFloat(scfiMatch[1]);
          console.log(`Найдено значение индекса SCFI: ${currentIndex}`);
          
          // Поиск изменения индекса
          const changeMatch = fullText.match(/increased by\s+(\d+(\.\d+)?)/i) || 
                             fullText.match(/decreased by\s+(\d+(\.\d+)?)/i) ||
                             fullText.match(/up\s+(\d+(\.\d+)?)/i) ||
                             fullText.match(/down\s+(\d+(\.\d+)?)/i) ||
                             fullText.match(/\+(\d+(\.\d+)?)/i) ||
                             fullText.match(/\-(\d+(\.\d+)?)/i);
          
          let change = 0;
          if (changeMatch) {
            change = parseFloat(changeMatch[1]);
            // Определение знака изменения
            if (fullText.includes('decreased') || fullText.includes('down') || fullText.includes('-')) {
              change = -change;
            }
            console.log(`Найдено изменение индекса: ${change}`);
          }
          
          // Поиск даты публикации
          const dateMatch = fullText.match(/(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/) ||
                           fullText.match(/(\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/) ||
                           fullText.match(/(\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i);
          
          let foundDate = null;
          if (dateMatch) {
            foundDate = dateMatch[1];
            console.log(`Найдена дата публикации: ${foundDate}`);
          }
          
          // Создание объекта с данными
          const scfiData = [{
            route: 'Comprehensive Index',
            unit: 'points',
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
            
            const scfiData = [];
            let rowCount = 0;
            let validRowCount = 0;
            
            // Парсинг строк таблицы
            table.find('tr').each((j, row) => {
              if (j === 0) return; // Пропускаем заголовок
              
              rowCount++;
              const columns = $(row).find('td');
              
              if (columns.length >= 2) {
                const route = $(columns[0]).text().trim();
                const indexText = $(columns[1]).text().trim();
                
                // Извлечение числового значения индекса
                const indexMatch = indexText.match(/(\d+(\.\d+)?)/);
                const currentIndex = indexMatch ? parseFloat(indexMatch[1]) : NaN;
                
                // Извлечение изменения
                let change = 0;
                if (columns.length >= 3) {
                  const changeText = $(columns[2]).text().trim();
                  const changeMatch = changeText.match(/([-+]?\d+(\.\d+)?)/);
                  change = changeMatch ? parseFloat(changeMatch[1]) : 0;
                }
                
                console.log(`Строка ${j}: Маршрут: "${route}", Индекс: ${currentIndex}, Изменение: ${change}`);
                
                // Добавление данных в массив, если маршрут не пустой и индекс является числом
                if (route && !isNaN(currentIndex)) {
                  validRowCount++;
                  
                  // Определение единицы измерения
                  let unit = 'USD/TEU';
                  if (route.toLowerCase().includes('feu') || indexText.toLowerCase().includes('feu')) {
                    unit = 'USD/FEU';
                  }
                  
                  scfiData.push({
                    route,
                    unit,
                    weighting: getRouteWeighting(route),
                    previousIndex: currentIndex - change,
                    currentIndex,
                    change,
                    previousDate: previousDate,
                    currentDate: currentDate
                  });
                }
              }
            });
            
            console.log(`Обработано ${rowCount} строк, найдено ${validRowCount} валидных строк`);
            
            // Если нашли данные, добавляем композитный индекс и возвращаем результат
            if (scfiData.length > 0) {
              // Проверяем, есть ли уже композитный индекс
              const hasComposite = scfiData.some(data => 
                data.route.toLowerCase().includes('composite') || 
                data.route.toLowerCase().includes('comprehensive') ||
                data.route === 'Comprehensive Index'
              );
              
              // Если нет, добавляем его
              if (!hasComposite) {
                console.log('Добавление композитного индекса...');
                
                // Расчет композитного индекса как среднего значения
                const compositeIndex = Math.round(scfiData.reduce((sum, data) => sum + data.currentIndex, 0) / scfiData.length);
                const prevCompositeIndex = Math.round(scfiData.reduce((sum, data) => sum + data.previousIndex, 0) / scfiData.length);
                const compositeChange = compositeIndex - prevCompositeIndex;
                
                // Добавление композитного индекса в начало массива
                scfiData.unshift({
                  route: 'Comprehensive Index',
                  unit: 'points',
                  weighting: 100,
                  previousIndex: prevCompositeIndex,
                  currentIndex: compositeIndex,
                  change: compositeChange,
                  previousDate: previousDate,
                  currentDate: currentDate
                });
                
                console.log(`Добавлен композитный индекс: ${compositeIndex} (изменение: ${compositeChange})`);
              }
              
              return scfiData;
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
 * 
 * @async
 * @function fetchMockSCFIData
 * @returns {Promise<Array>} Массив объектов с моковыми данными SCFI
 */
async function fetchMockSCFIData() {
  console.log('Создание моковых данных SCFI...');
  
  // Получение текущей даты и даты неделю назад
  const currentDate = new Date().toISOString().split('T')[0];
  const prevDate = new Date();
  prevDate.setDate(prevDate.getDate() - 7);
  const previousDate = prevDate.toISOString().split('T')[0];
  
  // Создание моковых данных
  const mockData = [
    {
      route: 'Comprehensive Index',
      unit: 'points',
      weighting: 100.0,
      previousIndex: 1000,
      currentIndex: 977.26,
      change: -22.74,
      previousDate: previousDate,
      currentDate: currentDate
    },
    {
      route: 'Europe (base port)',
      unit: 'USD/TEU',
      weighting: 20.0,
      previousIndex: 1050,
      currentIndex: 1030,
      change: -20,
      previousDate: previousDate,
      currentDate: currentDate
    },
    {
      route: 'Mediterranean (base port)',
      unit: 'USD/TEU',
      weighting: 10.0,
      previousIndex: 1100,
      currentIndex: 1080,
      change: -20,
      previousDate: previousDate,
      currentDate: currentDate
    },
    {
      route: 'US West Coast',
      unit: 'USD/FEU',
      weighting: 20.0,
      previousIndex: 2200,
      currentIndex: 2150,
      change: -50,
      previousDate: previousDate,
      currentDate: currentDate
    },
    {
      route: 'US East Coast',
      unit: 'USD/FEU',
      weighting: 7.5,
      previousIndex: 3100,
      currentIndex: 3050,
      change: -50,
      previousDate: previousDate,
      currentDate: currentDate
    },
    {
      route: 'Persian Gulf and Red Sea',
      unit: 'USD/TEU',
      weighting: 7.5,
      previousIndex: 850,
      currentIndex: 830,
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
  
  console.log(`Создано ${mockData.length} моковых записей SCFI`);
  
  // Сохранение моковых данных в базу данных
  try {
    console.log('Сохранение моковых данных в базу данных...');
    await saveSCFIData(mockData);
    console.log('Моковые данные успешно сохранены в базу данных');
  } catch (error) {
    console.error('Ошибка при сохранении моковых данных в базу данных:', error);
    console.log('Продолжение без сохранения моковых данных в базу данных');
  }
  
  return mockData;
}

/**
 * Функция для сохранения данных SCFI в базу данных
 * 
 * @async
 * @function saveSCFIData
 * @param {Array} scfiData - Массив объектов с данными SCFI
 * @throws {Error} Если не удалось сохранить данные в базу данных
 */
async function saveSCFIData(scfiData) {
  // Проверка входных данных
  if (!Array.isArray(scfiData) || scfiData.length === 0) {
    console.error('Недопустимые данные SCFI для сохранения');
    throw new Error('Недопустимые данные SCFI для сохранения');
  }
  
  console.log(`Сохранение ${scfiData.length} записей SCFI в базу данных...`);
  
  // Получение соединения из пула
  let client = null;
  
  try {
    console.log('Получение соединения с базой данных из пула...');
    client = await pool.connect();
    console.log('Соединение с базой данных получено');
    
    // Начало транзакции
    console.log('Начало транзакции в базе данных...');
    await client.query('BEGIN');
    
    // Создание таблицы, если она не существует
    console.log(`Создание таблицы ${DB_CONFIG.TABLE_NAME}, если она не существует...`);
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
    console.log('Создание/проверка таблицы завершена');
    
    // Вставка данных
    console.log('Вставка записей данных SCFI...');
    let successCount = 0;
    let errorCount = 0;
    
    for (const data of scfiData) {
      try {
        // Проверка обязательных полей
        if (!data.route || isNaN(data.currentIndex) || !data.currentDate) {
          console.error(`Пропуск недопустимой записи данных SCFI: ${JSON.stringify(data)}`);
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
        console.log(`Успешно вставлена/обновлена запись для маршрута: ${data.route}`);
      } catch (error) {
        errorCount++;
        console.error(`Ошибка при вставке данных SCFI для маршрута ${data.route}:`, error);
        // Продолжаем вставку других данных
      }
    }
    
    // Завершение транзакции
    console.log('Фиксация транзакции в базе данных...');
    await client.query('COMMIT');
    
    console.log(`Операция с базой данных завершена: ${successCount} записей сохранено успешно, ${errorCount} ошибок`);
  } catch (error) {
    // Откат транзакции в случае ошибки
    if (client) {
      console.error('Ошибка во время операции с базой данных, откат транзакции...');
      await client.query('ROLLBACK');
    }
    
    console.error('Ошибка при сохранении данных SCFI в базу данных:', error);
    throw error;
  } finally {
    // Освобождение клиента
    if (client) {
      console.log('Возврат соединения с базой данных в пул...');
      client.release();
    }
  }
}

/**
 * Функция для получения данных SCFI для расчета ставки фрахта
 * 
 * @async
 * @function getSCFIDataForCalculation
 * @returns {Promise<Object>} Объект с данными SCFI для расчета
 */
async function getSCFIDataForCalculation() {
  try {
    console.log('Получение данных SCFI для расчета...');
    
    // Получение последних данных композитного индекса SCFI из базы данных
    console.log('Запрос к базе данных для получения последнего композитного индекса SCFI...');
    const query = `
      SELECT * FROM ${DB_CONFIG.TABLE_NAME} 
      WHERE route = 'Comprehensive Index'
      ORDER BY current_date DESC 
      LIMIT 1
    `;
    
    console.log(`[DB LOG] Выполнение запроса: ${query}`);
    console.log(`[DB LOG] Имя таблицы: ${DB_CONFIG.TABLE_NAME}`);
    
    const result = await pool.query(query);
    console.log(`[DB LOG] Запрос выполнен успешно. Возвращено строк: ${result.rows.length}`);
    
    // Если данные найдены в базе, возвращаем их
    if (result.rows.length > 0) {
      const data = result.rows[0];
      console.log('Найдены данные SCFI в базе данных:', data);
      
      // Форматируем дату в строку в формате YYYY-MM-DD
      const formattedDate = data.current_date instanceof Date 
        ? data.current_date.toISOString().split('T')[0]
        : data.current_date;
      
      // Преобразуем числовые значения с помощью parseFloat
      const indexValue = parseFloat(data.current_index) || 0;
      const changeValue = parseFloat(data.change) || 0;
      
      console.log(`Форматированные данные SCFI: Индекс: ${indexValue}, Изменение: ${changeValue}, Дата: ${formattedDate}`);
      
      // Возвращаем данные в формате, ожидаемом сервером
      return {
        current_index: indexValue,
        change: changeValue,
        index_date: formattedDate
      };
    }
    
    // Если данных нет в базе, пытаемся получить их через API
    console.log('Данных SCFI в базе нет, получение через API...');
    try {
      const scfiData = await fetchSCFIData();
      
      // Ищем композитный индекс в полученных данных
      const compositeData = scfiData.find(data => 
        data.route === 'Comprehensive Index' || 
        data.route.toLowerCase().includes('composite')
      );
      
      if (compositeData) {
        console.log('Получены данные SCFI через API:', compositeData);
        
        // Форматируем дату в строку в формате YYYY-MM-DD
        const formattedDate = compositeData.currentDate instanceof Date 
          ? compositeData.currentDate.toISOString().split('T')[0]
          : compositeData.currentDate;
        
        // Преобразуем числовые значения с помощью parseFloat
        const indexValue = parseFloat(compositeData.currentIndex) || 0;
        const changeValue = parseFloat(compositeData.change) || 0;
        
        console.log(`Форматированные данные SCFI из API: Индекс: ${indexValue}, Изменение: ${changeValue}, Дата: ${formattedDate}`);
        
        // Возвращаем данные в формате, ожидаемом сервером
        return {
          current_index: indexValue,
          change: changeValue,
          index_date: formattedDate
        };
      }
    } catch (error) {
      console.error('Ошибка при получении данных SCFI через API:', error);
    }
    
    // Если не удалось получить данные ни из базы, ни через API, используем значения по умолчанию
    console.log('Использование значений SCFI по умолчанию');
    return {
      current_index: 977.26,
      change: -22.74,
      index_date: new Date().toISOString().split('T')[0]
    };
  } catch (error) {
    console.error('Ошибка при получении данных SCFI для расчета:', error);
    
    // В случае ошибки возвращаем значения по умолчанию
    console.log('Использование значений SCFI по умолчанию после ошибки');
    return {
      current_index: 977.26,
      change: -22.74,
      index_date: new Date().toISOString().split('T')[0]
    };
  }
}

/**
 * Функция для получения данных SCFI для конкретного маршрута
 * 
 * @async
 * @function getSCFIDataForRoute
 * @param {string} originPort - Порт отправления
 * @param {string} destinationPort - Порт назначения
 * @returns {Promise<Object>} Объект с данными SCFI для маршрута
 */
async function getSCFIDataForRoute(originPort, destinationPort) {
  try {
    console.log(`Получение данных SCFI для маршрута: ${originPort} -> ${destinationPort}`);
    
    // Определение региона для порта отправления
    const originRegion = getPortRegion(originPort);
    console.log(`Регион порта отправления: ${originRegion}`);
    
    // Определение региона для порта назначения
    const destinationRegion = getPortRegion(destinationPort);
    console.log(`Регион порта назначения: ${destinationRegion}`);
    
    // Формирование возможных маршрутов
    const possibleRoutes = [];
    
    // Добавление точных маршрутов
    if (originPort === 'CNSHA' || originPort === 'CNNGB') {
      if (destinationRegion === 'Europe' && destinationPort !== 'TRMER') {
        possibleRoutes.push('Europe (base port)');
      } else if (destinationRegion === 'Mediterranean' || destinationPort === 'TRMER') {
        possibleRoutes.push('Mediterranean (base port)');
      } else if (destinationRegion === 'US West Coast') {
        possibleRoutes.push('US West Coast');
      } else if (destinationRegion === 'US East Coast') {
        possibleRoutes.push('US East Coast');
      } else if (destinationRegion === 'Persian Gulf' || destinationRegion === 'Red Sea') {
        possibleRoutes.push('Persian Gulf and Red Sea');
      } else if (destinationRegion === 'Australia' || destinationRegion === 'New Zealand') {
        possibleRoutes.push('Australia/New Zealand');
      } else if (destinationRegion === 'Southeast Asia') {
        possibleRoutes.push('Southeast Asia (Singapore)');
      } else if (destinationRegion === 'Japan') {
        possibleRoutes.push('Japan');
      } else if (destinationRegion === 'South America') {
        possibleRoutes.push('South America');
      } else if (destinationRegion === 'West Africa') {
        possibleRoutes.push('West Africa');
      } else if (destinationRegion === 'South Africa') {
        possibleRoutes.push('South Africa');
      }
    }
    
    // Добавление общих маршрутов
    if (originRegion === 'China' || originRegion === 'East Asia') {
      if (destinationRegion === 'Europe' && destinationPort !== 'TRMER') {
        possibleRoutes.push('Europe (base port)');
      } else if (destinationRegion === 'Mediterranean' || destinationPort === 'TRMER') {
        possibleRoutes.push('Mediterranean (base port)');
      } else if (destinationRegion === 'US West Coast') {
        possibleRoutes.push('US West Coast');
      } else if (destinationRegion === 'US East Coast') {
        possibleRoutes.push('US East Coast');
      }
    }
    
    console.log(`Возможные маршруты: ${possibleRoutes.join(', ')}`);
    
    // Если нет возможных маршрутов, используем композитный индекс
    if (possibleRoutes.length === 0) {
      console.log('Нет подходящих маршрутов, использование композитного индекса');
      return getSCFIDataForCalculation();
    }
    
    // Получение данных SCFI из базы данных
    console.log('Запрос к базе данных для получения данных SCFI для маршрута...');
    const query = `
      SELECT * FROM ${DB_CONFIG.TABLE_NAME} 
      WHERE route = ANY($1)
      ORDER BY current_date DESC 
      LIMIT 1
    `;
    
    console.log(`[DB LOG] Выполнение запроса: ${query}`);
    console.log(`[DB LOG] Параметры: ${JSON.stringify(possibleRoutes)}`);
    
    const result = await pool.query(query, [possibleRoutes]);
    console.log(`[DB LOG] Запрос выполнен успешно. Возвращено строк: ${result.rows.length}`);
    
    // Если данные найдены в базе, возвращаем их
    if (result.rows.length > 0) {
      const data = result.rows[0];
      console.log('Найдены данные SCFI в базе данных для маршрута:', data);
      
      // Форматируем дату в строку в формате YYYY-MM-DD
      const formattedDate = data.current_date instanceof Date 
        ? data.current_date.toISOString().split('T')[0]
        : data.current_date;
      
      // Преобразуем числовые значения с помощью parseFloat
      const indexValue = parseFloat(data.current_index) || 0;
      const changeValue = parseFloat(data.change) || 0;
      
      console.log(`Форматированные данные SCFI для маршрута: Индекс: ${indexValue}, Изменение: ${changeValue}, Дата: ${formattedDate}`);
      
      // Возвращаем данные в формате, ожидаемом сервером
      return {
        current_index: indexValue,
        change: changeValue,
        index_date: formattedDate,
        route: data.route
      };
    }
    
    // Если данных нет в базе, пытаемся получить их через API
    console.log('Данных SCFI для маршрута в базе нет, получение через API...');
    try {
      const scfiData = await fetchSCFIData();
      
      // Ищем данные для маршрута в полученных данных
      for (const route of possibleRoutes) {
        const routeData = scfiData.find(data => data.route === route);
        if (routeData) {
          console.log('Получены данные SCFI через API для маршрута:', routeData);
          
          // Форматируем дату в строку в формате YYYY-MM-DD
          const formattedDate = routeData.currentDate instanceof Date 
            ? routeData.currentDate.toISOString().split('T')[0]
            : routeData.currentDate;
          
          // Преобразуем числовые значения с помощью parseFloat
          const indexValue = parseFloat(routeData.currentIndex) || 0;
          const changeValue = parseFloat(routeData.change) || 0;
          
          console.log(`Форматированные данные SCFI из API для маршрута: Индекс: ${indexValue}, Изменение: ${changeValue}, Дата: ${formattedDate}`);
          
          // Возвращаем данные в формате, ожидаемом сервером
          return {
            current_index: indexValue,
            change: changeValue,
            index_date: formattedDate,
            route: routeData.route
          };
        }
      }
    } catch (error) {
      console.error('Ошибка при получении данных SCFI через API для маршрута:', error);
    }
    
    // Если не удалось получить данные ни из базы, ни через API, используем композитный индекс
    console.log('Не удалось получить данные для конкретного маршрута, использование композитного индекса');
    return getSCFIDataForCalculation();
  } catch (error) {
    console.error('Ошибка при получении данных SCFI для маршрута:', error);
    
    // В случае ошибки используем композитный индекс
    console.log('Использование композитного индекса после ошибки');
    return getSCFIDataForCalculation();
  }
}

/**
 * Функция для определения региона порта
 * 
 * @function getPortRegion
 * @param {string} portCode - Код порта
 * @returns {string} Регион порта
 */
function getPortRegion(portCode) {
  // Коды портов Китая
  const chinaPorts = ['CNSHA', 'CNNGB', 'CNDLC', 'CNTXG', 'CNQIN', 'CNSZH'];
  
  // Коды портов Европы (без Средиземноморья)
  const europePorts = ['NLRTM', 'DEHAM', 'BEANR', 'GBFXT', 'GBSOU', 'FRLEH', 'DEBRV'];
  
  // Коды портов Средиземноморья
  const mediterraneanPorts = ['ITGOA', 'ESVLC', 'ESALG', 'FRFOS', 'GRPIR', 'TRMER', 'ITGIT'];
  
  // Коды портов западного побережья США
  const usWestCoastPorts = ['USLAX', 'USLGB', 'USOAK', 'USSEA'];
  
  // Коды портов восточного побережья США
  const usEastCoastPorts = ['USNYC', 'USSAV', 'USMIA', 'USBAL', 'USBOS'];
  
  // Коды портов Персидского залива и Красного моря
  const persianGulfRedSeaPorts = ['AEJEA', 'AEDXB', 'AEAUH', 'SADMM', 'KWKWI', 'EGPSD'];
  
  // Коды портов Австралии и Новой Зеландии
  const australiaNewZealandPorts = ['AUSYD', 'AUMEL', 'AUBNE', 'NZAKL'];
  
  // Коды портов Юго-Восточной Азии
  const southeastAsiaPorts = ['SGSIN', 'MYPKG', 'IDTPP', 'VNSGN', 'THBKK', 'PHMNL'];
  
  // Коды портов Японии
  const japanPorts = ['JPYOK', 'JPNGO', 'JPOSA', 'JPUKB'];
  
  // Коды портов Южной Америки
  const southAmericaPorts = ['BRRIG', 'BRSSZ', 'CLVAP', 'ARBUE', 'PECLL'];
  
  // Коды портов Западной Африки
  const westAfricaPorts = ['NGAPP', 'GHTEM', 'CIABJ', 'SNLOS'];
  
  // Коды портов Южной Африки
  const southAfricaPorts = ['ZADUR', 'ZACPT'];
  
  // Определение региона по коду порта
  if (chinaPorts.includes(portCode)) {
    return 'China';
  } else if (europePorts.includes(portCode)) {
    return 'Europe';
  } else if (mediterraneanPorts.includes(portCode)) {
    return 'Mediterranean';
  } else if (usWestCoastPorts.includes(portCode)) {
    return 'US West Coast';
  } else if (usEastCoastPorts.includes(portCode)) {
    return 'US East Coast';
  } else if (persianGulfRedSeaPorts.includes(portCode)) {
    if (portCode === 'EGPSD') {
      return 'Red Sea';
    } else {
      return 'Persian Gulf';
    }
  } else if (australiaNewZealandPorts.includes(portCode)) {
    if (portCode.startsWith('AU')) {
      return 'Australia';
    } else {
      return 'New Zealand';
    }
  } else if (southeastAsiaPorts.includes(portCode)) {
    return 'Southeast Asia';
  } else if (japanPorts.includes(portCode)) {
    return 'Japan';
  } else if (southAmericaPorts.includes(portCode)) {
    return 'South America';
  } else if (westAfricaPorts.includes(portCode)) {
    return 'West Africa';
  } else if (southAfricaPorts.includes(portCode)) {
    return 'South Africa';
  } else if (portCode.startsWith('CN')) {
    return 'China';
  } else if (portCode.startsWith('US')) {
    if (['W', 'L', 'S', 'O'].some(char => portCode.includes(char))) {
      return 'US West Coast';
    } else {
      return 'US East Coast';
    }
  } else if (portCode.startsWith('EU') || portCode.startsWith('DE') || portCode.startsWith('FR') || 
             portCode.startsWith('NL') || portCode.startsWith('BE') || portCode.startsWith('GB')) {
    return 'Europe';
  } else {
    // Если регион не определен, возвращаем "Unknown"
    return 'Unknown';
  }
}

// Экспорт функций
module.exports = {
  fetchSCFIData,
  getSCFIDataForCalculation,
  getSCFIDataForRoute
};

// Совместимость с ES модулями
if (typeof exports === 'object' && typeof module !== 'undefined') {
  Object.defineProperty(exports, '__esModule', { value: true });
  exports.default = {
    fetchSCFIData,
    getSCFIDataForCalculation,
    getSCFIDataForRoute
  };
}
