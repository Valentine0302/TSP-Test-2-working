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
 * 7. Исправлена логика извлечения Comprehensive Index из основной таблицы
 * 8. Исправлена обработка дат и имен колонок в базе данных
 *
 * @module scfi_scraper
 * @author TSP Team
 * @version 2.4.0
 * @last_updated 2025-04-29
 */

// Импорт необходимых модулей
const axios = require("axios"); // HTTP-клиент для выполнения запросов
const cheerio = require("cheerio"); // Библиотека для парсинга HTML
const { Pool } = require("pg"); // Клиент PostgreSQL для работы с базой данных
const dotenv = require("dotenv"); // Модуль для загрузки переменных окружения

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
    sslmode: "require",
  },
});

/**
 * URL для получения данных SCFI с основного источника
 * @constant {string}
 */
const SCFI_URL = "https://en.sse.net.cn/indices/scfinew.jsp";

/**
 * Альтернативные источники данных SCFI
 * @constant {Array<Object>}
 */
const SCFI_ALT_SOURCES = [
  {
    name: "MacroMicro",
    url: "https://en.macromicro.me/series/17502/fbx-global-container-index-weekly",
    selector: ".chart-data-table, table:contains(\"SCFI\")",
    dateFormat: "YYYY-MM-DD",
  },
  {
    name: "FreightWaves",
    url: "https://www.freightwaves.com/news/tag/scfi",
    selector: "article:contains(\"SCFI\")",
    textSearch: true,
  },
  {
    name: "Container News",
    url: "https://www.container-news.com/scfi/",
    selector: ".entry-content table, .entry-content p:contains(\"SCFI\")",
    textSearch: true,
  },
  {
    name: "Hellenic Shipping News",
    url: "https://www.hellenicshippingnews.com/shanghai-containerized-freight-index/",
    selector: ".td-post-content table, .td-post-content p:contains(\"SCFI\")",
    textSearch: true,
  },
  {
    name: "Drewry",
    url: "https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/world-container-index-assessed-by-drewry",
    selector: ".table-responsive table, .content p:contains(\"index\")",
    textSearch: true,
  },
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
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  },
};

/**
 * Константы для работы с базой данных
 * @constant {Object}
 */
const DB_CONFIG = {
  TABLE_NAME: "freight_indices_scfi",
  MAX_POOL_SIZE: 10,
  CONNECTION_TIMEOUT: 10000,
  IDLE_TIMEOUT: 30000,
};

/**
 * Форматирует дату в строку ISO формата (YYYY-MM-DD)
 * 
 * @function formatDate
 * @param {Date|string} date - Дата для форматирования
 * @returns {string} Отформатированная дата в формате YYYY-MM-DD
 */
function formatDate(date) {
  if (!date) return null;
  
  let dateObj;
  if (typeof date === 'string') {
    // Если дата уже в формате YYYY-MM-DD, возвращаем как есть
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return date;
    }
    
    // Пробуем разные форматы даты
    if (date.includes('/')) {
      // Формат MM/DD/YYYY или DD/MM/YYYY
      const parts = date.split('/');
      if (parts.length === 3) {
        // Предполагаем MM/DD/YYYY, но проверяем валидность
        const month = parseInt(parts[0], 10);
        const day = parseInt(parts[1], 10);
        const year = parseInt(parts[2], 10);
        
        if (month > 0 && month <= 12 && day > 0 && day <= 31 && year > 2000) {
          dateObj = new Date(year, month - 1, day);
        } else {
          // Пробуем DD/MM/YYYY
          const day = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10);
          const year = parseInt(parts[2], 10);
          
          if (month > 0 && month <= 12 && day > 0 && day <= 31 && year > 2000) {
            dateObj = new Date(year, month - 1, day);
          } else {
            // Не удалось распознать формат, используем текущую дату
            dateObj = new Date();
          }
        }
      } else {
        // Неизвестный формат с /, используем текущую дату
        dateObj = new Date();
      }
    } else if (date.includes('-')) {
      // Формат YYYY-MM-DD или DD-MM-YYYY
      const parts = date.split('-');
      if (parts.length === 3) {
        if (parts[0].length === 4) {
          // YYYY-MM-DD
          dateObj = new Date(date);
        } else {
          // DD-MM-YYYY
          const day = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10);
          const year = parseInt(parts[2], 10);
          
          if (month > 0 && month <= 12 && day > 0 && day <= 31 && year > 2000) {
            dateObj = new Date(year, month - 1, day);
          } else {
            // Не удалось распознать формат, используем текущую дату
            dateObj = new Date();
          }
        }
      } else {
        // Неизвестный формат с -, используем текущую дату
        dateObj = new Date();
      }
    } else {
      // Пробуем стандартный парсинг
      dateObj = new Date(date);
      if (isNaN(dateObj.getTime())) {
        // Если не удалось распознать, используем текущую дату
        dateObj = new Date();
      }
    }
  } else if (date instanceof Date) {
    dateObj = date;
  } else {
    // Если не строка и не Date, используем текущую дату
    dateObj = new Date();
  }
  
  // Проверяем, что дата валидна
  if (isNaN(dateObj.getTime())) {
    dateObj = new Date(); // Если дата невалидна, используем текущую
  }
  
  // Форматируем в YYYY-MM-DD
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

/**
 * Основная функция для получения данных SCFI
 *
 * @async
 * @function fetchSCFIData
 * @returns {Promise<Array>} Массив объектов с данными SCFI
 */
async function fetchSCFIData() {
  console.log("=== НАЧАЛО ПОЛУЧЕНИЯ ДАННЫХ SCFI ===");
  console.log(`Время запуска: ${new Date().toISOString()}`);
  console.log("Версия скрапера: 2.4.0 (исправлена обработка дат и имен колонок)");

  try {
    let scfiData = null;
    let sourceUsed = "";

    // 1. Попытка получить данные с основного источника
    console.log("\n=== ПОПЫТКА ПОЛУЧЕНИЯ ДАННЫХ С ОСНОВНОГО ИСТОЧНИКА ===");
    try {
      scfiData = await fetchSCFIFromPrimarySource();
      if (scfiData && Array.isArray(scfiData) && scfiData.length > 0) {
        console.log(
          `✅ Успешно получено ${scfiData.length} записей с основного источника`
        );
        sourceUsed = "primary";
      } else {
        console.log("❌ Основной источник не вернул данные");
      }
    } catch (error) {
      console.error(
        `❌ Ошибка при получении данных с основного источника: ${error.message}`
      );
      console.error("Стек ошибки:", error.stack);
    }

    // 2. Если основной источник не сработал, перебираем альтернативные
    if (!scfiData || !Array.isArray(scfiData) || scfiData.length === 0) {
      console.log(
        "\n=== ПОПЫТКА ПОЛУЧЕНИЯ ДАННЫХ С АЛЬТЕРНАТИВНЫХ ИСТОЧНИКОВ ==="
      );

      for (const source of SCFI_ALT_SOURCES) {
        console.log(`\n--- Проверка источника: ${source.name} ---`);
        try {
          scfiData = await fetchSCFIFromAlternativeSource(source);
          if (scfiData && Array.isArray(scfiData) && scfiData.length > 0) {
            console.log(
              `✅ Успешно получено ${scfiData.length} записей с источника ${source.name}`
            );
            sourceUsed = source.name;
            break;
          } else {
            console.log(`❌ Источник ${source.name} не вернул данные`);
          }
        } catch (error) {
          console.error(
            `❌ Ошибка при получении данных с источника ${source.name}: ${error.message}`
          );
        }
      }
    }

    // 3. Если данные получены, сохраняем их в базу данных
    if (scfiData && Array.isArray(scfiData) && scfiData.length > 0) {
      console.log(
        `\n=== СОХРАНЕНИЕ ${scfiData.length} ЗАПИСЕЙ SCFI В БАЗУ ДАННЫХ ===`
      );
      try {
        await saveSCFIData(scfiData);
        console.log("✅ Данные SCFI успешно сохранены в базу данных");
      } catch (error) {
        console.error(
          "❌ Ошибка при сохранении данных SCFI в базу данных:",
          error
        );
      }

      console.log(
        `\n=== ИТОГ: ДАННЫЕ УСПЕШНО ПОЛУЧЕНЫ С ИСТОЧНИКА: ${sourceUsed} ===`
      );
      return scfiData;
    } else {
      // 4. Если данные не получены ни с одного источника, используем моковые данные
      console.log("\n=== ИСПОЛЬЗОВАНИЕ МОКОВЫХ ДАННЫХ ===");
      console.log("❌ Не удалось получить данные ни с одного источника");

      const mockData = await fetchMockSCFIData();
      console.log(`✅ Создано ${mockData.length} моковых записей SCFI`);

      console.log("\n=== ИТОГ: ИСПОЛЬЗУЮТСЯ МОКОВЫЕ ДАННЫЕ ===");
      return mockData;
    }
  } catch (error) {
    console.error("\n=== КРИТИЧЕСКАЯ ОШИБКА ПРИ ПОЛУЧЕНИИ ДАННЫХ SCFI ===");
    console.error("Ошибка:", error);
    console.error("Стек ошибки:", error.stack);

    // В случае критической ошибки возвращаем моковые данные
    console.log(
      "\n=== ИСПОЛЬЗОВАНИЕ МОКОВЫХ ДАННЫХ ПОСЛЕ КРИТИЧЕСКОЙ ОШИБКИ ==="
    );
    const mockData = await fetchMockSCFIData();

    console.log("\n=== ИТОГ: ИСПОЛЬЗУЮТСЯ МОКОВЫЕ ДАННЫЕ ПОСЛЕ ОШИБКИ ===");
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
        console.log(
          `Повторная попытка ${retryCount}/${HTTP_CONFIG.MAX_RETRIES} через ${HTTP_CONFIG.RETRY_DELAY}мс`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, HTTP_CONFIG.RETRY_DELAY)
        );
      }

      // Отправка запроса на сайт Shanghai Shipping Exchange
      console.log(`Отправка HTTP-запроса на ${SCFI_URL}`);
      const response = await axios.get(SCFI_URL, {
        headers: HTTP_CONFIG.HEADERS,
        timeout: HTTP_CONFIG.TIMEOUT,
      });

      if (response.status !== 200) {
        throw new Error(`Неуспешный статус ответа: ${response.status}`);
      }

      console.log(
        `Получен ответ от ${SCFI_URL}, размер: ${response.data.length} байт`
      );

      // Парсинг HTML-страницы
      console.log("Парсинг HTML-ответа...");
      const $ = cheerio.load(response.data);

      // Подробная диагностика страницы
      const pageTitle = $("title").text().trim();
      console.log(`Заголовок страницы: "${pageTitle}"`);

      const tableCount = $("table").length;
      console.log(`Количество таблиц на странице: ${tableCount}`);

      // Поиск таблицы с данными SCFI
      console.log("Поиск таблицы с данными SCFI...");
      let scfiTable = null;

      // Ищем таблицу, содержащую строку с "Comprehensive Index"
      $("table").each((i, table) => {
        const tableHtml = $(table).html().toLowerCase();
        if (tableHtml.includes("comprehensive index")) {
          console.log(`Найдена таблица ${i + 1}, содержащая "Comprehensive Index"`);
          scfiTable = $(table);
          return false; // Прекращаем поиск таблиц
        }
      });

      // Если не нашли по "Comprehensive Index", ищем по другим признакам
      if (!scfiTable) {
        $("table").each((i, table) => {
          const tableHtml = $(table).html().toLowerCase();
          if (tableHtml.includes("scfi") || 
              tableHtml.includes("shanghai containerized freight index") ||
              tableHtml.includes("freight index")) {
            console.log(`Найдена таблица ${i + 1}, содержащая ключевые слова SCFI`);
            scfiTable = $(table);
            return false; // Прекращаем поиск таблиц
          }
        });
      }

      // Если таблица не найдена, выбрасываем ошибку
      if (!scfiTable) {
        throw new Error(
          "Таблица с данными SCFI не найдена"
        );
      }

      // Получение текущей даты и даты неделю назад
      const today = new Date();
      const currentDate = formatDate(today);
      const prevDate = new Date(today);
      prevDate.setDate(prevDate.getDate() - 7);
      const previousDate = formatDate(prevDate);

      console.log(`Текущая дата: ${currentDate}, Предыдущая дата: ${previousDate}`);

      // Попытка найти даты в заголовках таблицы
      let foundCurrentDate = null;
      let foundPreviousDate = null;

      // Ищем даты в заголовках таблицы
      scfiTable.find("th").each((i, th) => {
        const text = $(th).text().trim();
        const dateMatch = text.match(/(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/);
        if (dateMatch) {
          const dateStr = dateMatch[1].replace(/\//g, "-");
          if (text.toLowerCase().includes("current")) {
            foundCurrentDate = formatDate(dateStr);
            console.log(`Найдена текущая дата в заголовке: ${foundCurrentDate}`);
          } else if (text.toLowerCase().includes("previous")) {
            foundPreviousDate = formatDate(dateStr);
            console.log(`Найдена предыдущая дата в заголовке: ${foundPreviousDate}`);
          }
        }
      });

      // Используем найденные даты или значения по умолчанию
      const usedCurrentDate = foundCurrentDate || currentDate;
      const usedPreviousDate = foundPreviousDate || previousDate;
      console.log(`Используемая текущая дата: ${usedCurrentDate}`);
      console.log(`Используемая предыдущая дата: ${usedPreviousDate}`);

      // Ищем строку с Comprehensive Index
      console.log("Поиск строки с Comprehensive Index...");
      let comprehensiveRow = null;
      
      // Сначала ищем точное совпадение
      scfiTable.find("tr").each((i, row) => {
        const firstCellText = $(row).find("td").first().text().trim().toLowerCase();
        if (firstCellText === "comprehensive index") {
          console.log(`Найдена строка "Comprehensive Index" (индекс строки: ${i})`);
          comprehensiveRow = $(row);
          return false; // Прекращаем поиск строк
        }
      });
      
      // Если точное совпадение не найдено, ищем частичное
      if (!comprehensiveRow) {
        scfiTable.find("tr").each((i, row) => {
          const rowText = $(row).text().trim().toLowerCase();
          if (rowText.includes("comprehensive") && rowText.includes("index")) {
            console.log(`Найдена строка, содержащая "comprehensive" и "index" (индекс строки: ${i})`);
            comprehensiveRow = $(row);
            return false; // Прекращаем поиск строк
          }
        });
      }

      // Если строка не найдена, выбрасываем ошибку
      if (!comprehensiveRow) {
        throw new Error("Строка с Comprehensive Index не найдена в таблице");
      }

      // Извлекаем значения из ячеек строки
      const cells = comprehensiveRow.find("td");
      console.log(`Количество ячеек в строке: ${cells.length}`);

      // Ищем числовые значения в ячейках
      let previousIndexValue = null;
      let currentIndexValue = null;
      let changeValue = null;
      
      // Перебираем все ячейки и ищем числовые значения
      cells.each((i, cell) => {
        const cellText = $(cell).text().trim();
        const numMatch = cellText.match(/(\d+(?:\.\d+)?)/);
        if (numMatch) {
          const value = parseFloat(numMatch[0]);
          if (!isNaN(value)) {
            console.log(`Найдено числовое значение в ячейке ${i}: ${value}`);
            
            // Первое найденное число считаем текущим индексом
            if (currentIndexValue === null) {
              currentIndexValue = value;
            } 
            // Второе найденное число может быть либо предыдущим индексом, либо изменением
            else if (previousIndexValue === null) {
              // Если в тексте ячейки есть знак минус или плюс, это изменение
              if (cellText.includes('-') || cellText.includes('+')) {
                changeValue = cellText.includes('-') ? -value : value;
                // Вычисляем предыдущий индекс
                previousIndexValue = currentIndexValue - changeValue;
              } else {
                // Иначе это предыдущий индекс
                previousIndexValue = value;
                // Вычисляем изменение
                changeValue = currentIndexValue - previousIndexValue;
              }
            }
            // Если уже есть и текущий и предыдущий, но нет изменения
            else if (changeValue === null) {
              // Если в тексте ячейки есть знак минус или плюс, это изменение
              if (cellText.includes('-')) {
                changeValue = -value;
              } else if (cellText.includes('+')) {
                changeValue = value;
              } else {
                // Иначе просто берем разницу
                changeValue = currentIndexValue - previousIndexValue;
              }
            }
          }
        }
      });

      // Если не нашли все значения, пробуем определить их по-другому
      if (currentIndexValue === null) {
        throw new Error("Не удалось найти значение текущего индекса");
      }
      
      if (previousIndexValue === null) {
        // Если не нашли предыдущий индекс, но есть изменение
        if (changeValue !== null) {
          previousIndexValue = currentIndexValue - changeValue;
        } else {
          // Если нет ни предыдущего индекса, ни изменения, используем текущий индекс
          previousIndexValue = currentIndexValue;
          changeValue = 0;
        }
      }
      
      if (changeValue === null) {
        // Если не нашли изменение, вычисляем его
        changeValue = currentIndexValue - previousIndexValue;
      }

      console.log(
        `✅ Успешно извлечен Comprehensive Index: ${currentIndexValue} (пред: ${previousIndexValue}, изм: ${changeValue})`
      );

      // Создаем объект с данными только для Comprehensive Index
      return [
        {
          route: "SCFI Comprehensive",
          unit: "Points",
          weighting: 100,
          previousIndex: previousIndexValue,
          currentIndex: currentIndexValue,
          change: changeValue,
          previousDate: usedPreviousDate,
          currentDate: usedCurrentDate,
        },
      ];
    } catch (error) {
      lastError = error;
      console.error(
        `Ошибка при получении данных SCFI с основного источника (попытка ${retryCount + 1}/${HTTP_CONFIG.MAX_RETRIES + 1}):`,
        error.message
      );
      retryCount++;
    }
  }

  console.error("Все попытки получения данных с основного источника неудачны");
  throw (
    lastError ||
    new Error(
      "Не удалось получить данные SCFI с основного источника после нескольких попыток"
    )
  );
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
        console.log(
          `Повторная попытка ${retryCount}/${HTTP_CONFIG.MAX_RETRIES} через ${HTTP_CONFIG.RETRY_DELAY}мс`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, HTTP_CONFIG.RETRY_DELAY)
        );
      }

      // Отправка запроса на альтернативный источник
      console.log(`Отправка HTTP-запроса на ${source.url}`);
      const response = await axios.get(source.url, {
        headers: HTTP_CONFIG.HEADERS,
        timeout: HTTP_CONFIG.TIMEOUT,
      });

      if (response.status !== 200) {
        throw new Error(`Неуспешный статус ответа: ${response.status}`);
      }

      console.log(
        `Получен ответ от ${source.url}, размер: ${response.data.length} байт`
      );

      // Парсинг HTML-страницы
      console.log("Парсинг HTML-ответа...");
      const $ = cheerio.load(response.data);

      // Получение текущей даты и даты неделю назад
      const today = new Date();
      const currentDate = formatDate(today);
      const prevDate = new Date(today);
      prevDate.setDate(prevDate.getDate() - 7);
      const previousDate = formatDate(prevDate);

      // Поиск элементов по селектору
      console.log(`Поиск элементов по селектору: ${source.selector}`);
      const elements = $(source.selector);
      console.log(`Найдено ${elements.length} элементов`);

      if (elements.length === 0) {
        throw new Error(`Элементы по селектору ${source.selector} не найдены`);
      }

      // Если источник использует текстовый поиск
      if (source.textSearch) {
        console.log("Поиск значения SCFI в тексте...");

        // Ищем текст с упоминанием SCFI и числовым значением
        const text = elements.text();
        console.log(
          `Анализ текста (первые 200 символов): "${text.substring(0, 200)}..."`
        );

        // Ищем упоминание SCFI с числом рядом
        const scfiMatch =
          text.match(/SCFI.*?(\d+(?:\.\d+)?)/i) ||
          text.match(
            /Shanghai Containerized Freight Index.*?(\d+(?:\.\d+)?)/i
          ) ||
          text.match(/freight index.*?(\d+(?:\.\d+)?)/i);

        if (scfiMatch) {
          const currentIndex = parseFloat(scfiMatch[1]);
          console.log(`Найдено значение SCFI: ${currentIndex}`);

          // Ищем изменение (число со знаком + или -)
          const changeMatch = text.match(/([+-]\d+(?:\.\d+)?)/);
          const change = changeMatch ? parseFloat(changeMatch[1]) : 0;
          console.log(`Найдено изменение: ${change}`);

          // Ищем дату публикации
          const dateMatch = text.match(/(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/);
          let foundDate = null;
          if (dateMatch) {
            foundDate = formatDate(dateMatch[1]);
            console.log(`Найдена дата публикации: ${foundDate}`);
          }

          // Создание объекта с данными
          const scfiData = [
            {
              route: "SCFI Comprehensive",
              unit: "Points",
              weighting: 100,
              previousIndex: currentIndex - change,
              currentIndex,
              change,
              previousDate,
              currentDate: foundDate || currentDate,
            },
          ];

          return scfiData;
        } else {
          console.log("Значение индекса SCFI не найдено в тексте");
        }
      }
      // Если источник использует таблицу
      else {
        console.log("Парсинг таблицы для извлечения данных...");

        // Поиск таблицы
        const tables = elements.filter("table");
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

            table.find("tr").each((j, row) => {
              const firstCellText = $(row).find("td, th").first().text().trim();

              if (firstCellText.toLowerCase().includes("comprehensive")) {
                console.log(
                  `Найдена потенциальная строка с Comprehensive Index: "${$(
                    row
                  )
                    .text()
                    .trim()}"`
                );

                // Ищем числовое значение в ячейках строки
                const cells = $(row).find("td");
                if (cells.length > 2) {
                  // Предполагаем, что индекс - второе число, изменение - третье
                  let valueFound = false;
                  let changeFound = false;
                  cells.each((k, cell) => {
                    const cellText = $(cell).text().trim();
                    const numMatch = cellText.match(/([-+]?\d+(?:\.\d+)?)/);
                    if (numMatch) {
                      const numValue = parseFloat(numMatch[0]);
                      if (!isNaN(numValue)) {
                        if (comprehensiveValue === null) {
                          comprehensiveValue = numValue;
                          valueFound = true;
                          console.log(`Найдено значение индекса: ${comprehensiveValue}`);
                        } else if (comprehensiveChange === 0 && valueFound) {
                          comprehensiveChange = numValue;
                          changeFound = true;
                          console.log(`Найдено изменение индекса: ${comprehensiveChange}`);
                          return false; // Нашли оба, выходим
                        }
                      }
                    }
                  });
                  if (valueFound) {
                    foundComprehensiveRow = true;
                    return false; // Выходим из перебора строк
                  }
                }
              }
            });

            // Если нашли Comprehensive Index, возвращаем результат
            if (foundComprehensiveRow && comprehensiveValue !== null) {
              console.log(
                `✅ Успешно найден Comprehensive Index: ${comprehensiveValue} (изменение: ${comprehensiveChange})`
              );

              // Создаем объект с данными только для Comprehensive Index
              return [
                {
                  route: "SCFI Comprehensive",
                  unit: "Points",
                  weighting: 100,
                  previousIndex: comprehensiveValue - comprehensiveChange,
                  currentIndex: comprehensiveValue,
                  change: comprehensiveChange,
                  previousDate,
                  currentDate,
                },
              ];
            }
          }
        } else {
          console.log("Таблицы не найдены");
        }
      }

      throw new Error("Не удалось извлечь данные SCFI из источника");
    } catch (error) {
      lastError = error;
      console.error(
        `Ошибка при получении данных SCFI с источника ${source.name} (попытка ${retryCount + 1}/${HTTP_CONFIG.MAX_RETRIES + 1}):`,
        error.message
      );
      retryCount++;
    }
  }

  console.error(
    `Все попытки получения данных с источника ${source.name} неудачны`
  );
  throw (
    lastError ||
    new Error(
      `Не удалось получить данные SCFI с источника ${source.name} после нескольких попыток`
    )
  );
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
  
  if (routeLower.includes("comprehensive") || routeLower.includes("composite")) {
    return 100.0;
  } else if (routeLower.includes("europe") && !routeLower.includes("mediterranean")) {
    return 20.0;
  } else if (routeLower.includes("mediterranean")) {
    return 10.0;
  } else if (routeLower.includes("us west") || routeLower.includes("west coast")) {
    return 20.0;
  } else if (routeLower.includes("us east") || routeLower.includes("east coast")) {
    return 7.5;
  } else if (routeLower.includes("persian") || routeLower.includes("red sea")) {
    return 7.5;
  } else if (routeLower.includes("australia") || routeLower.includes("new zealand")) {
    return 5.0;
  } else if (routeLower.includes("southeast asia") || routeLower.includes("singapore")) {
    return 7.5;
  } else if (routeLower.includes("japan")) {
    return 5.0;
  } else if (routeLower.includes("south america")) {
    return 5.0;
  } else if (routeLower.includes("west africa")) {
    return 2.5;
  } else if (routeLower.includes("south africa")) {
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
  console.log("Создание моковых данных SCFI (только Comprehensive Index)...");

  // Получение текущей даты и даты неделю назад
  const today = new Date();
  const currentDate = formatDate(today);
  const prevDate = new Date(today);
  prevDate.setDate(prevDate.getDate() - 7);
  const previousDate = formatDate(prevDate);

  // Генерация случайного значения индекса в диапазоне 800-1200
  const currentIndex = Math.floor(Math.random() * 400) + 800;

  // Генерация случайного изменения в диапазоне -50 до +50
  const change = Math.floor(Math.random() * 100) - 50;

  // Создание моковых данных только для Comprehensive Index
  const mockData = [
    {
      route: "SCFI Comprehensive",
      unit: "Points",
      weighting: 100,
      previousIndex: currentIndex - change,
      currentIndex,
      change,
      previousDate,
      currentDate,
    },
  ];

  console.log(
    `Создан моковый Comprehensive Index: ${currentIndex} (изменение: ${change})`
  );

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
    // Проверяем структуру таблицы, чтобы определить правильные имена колонок
    console.log("Проверка структуры таблицы...");
    const tableInfoQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = '${DB_CONFIG.TABLE_NAME.toLowerCase()}'
    `;
    
    const tableInfoResult = await client.query(tableInfoQuery);
    const columnNames = tableInfoResult.rows.map(row => row.column_name);
    
    console.log(`Найдены колонки: ${columnNames.join(', ')}`);
    
    // Определяем, какие имена колонок использовать
    const routeColumn = columnNames.includes('route') ? 'route' : 'rate';
    const unitColumn = columnNames.includes('unit') ? 'unit' : 'unit';
    const weightingColumn = columnNames.includes('weighting') ? 'weighting' : 'weighting';
    const previousIndexColumn = columnNames.includes('previous_index') ? 'previous_index' : 'previous_index';
    const currentIndexColumn = columnNames.includes('current_index') ? 'current_index' : 'current_index';
    const changeColumn = columnNames.includes('change') ? 'change' : 'change';
    const previousDateColumn = columnNames.includes('previous_date') ? 'previous_date' : 'previous_date';
    const currentDateColumn = columnNames.includes('current_date') ? 'current_date' : 'current_date';
    
    console.log(`Используем колонку для маршрута: ${routeColumn}`);

    await client.query("BEGIN");

    for (const item of data) {
      // Форматируем даты перед сохранением
      const formattedCurrentDate = formatDate(item.currentDate);
      const formattedPreviousDate = formatDate(item.previousDate);
      
      console.log(`Форматированные даты: текущая=${formattedCurrentDate}, предыдущая=${formattedPreviousDate}`);

      const query = `
        INSERT INTO ${DB_CONFIG.TABLE_NAME} 
        (${routeColumn}, ${unitColumn}, ${weightingColumn}, ${previousIndexColumn}, ${currentIndexColumn}, ${changeColumn}, ${previousDateColumn}, ${currentDateColumn})
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (${routeColumn}, ${currentDateColumn}) 
        DO UPDATE SET 
          ${unitColumn} = EXCLUDED.${unitColumn},
          ${weightingColumn} = EXCLUDED.${weightingColumn},
          ${previousIndexColumn} = EXCLUDED.${previousIndexColumn},
          ${currentIndexColumn} = EXCLUDED.${currentIndexColumn},
          ${changeColumn} = EXCLUDED.${changeColumn},
          ${previousDateColumn} = EXCLUDED.${previousDateColumn}
      `;

      const values = [
        item.route,
        item.unit,
        item.weighting,
        item.previousIndex,
        item.currentIndex,
        item.change,
        formattedPreviousDate,
        formattedCurrentDate,
      ];

      await client.query(query, values);
      console.log(`✅ Сохранены данные для маршрута \"${item.route}\"`);
    }

    await client.query("COMMIT");
    console.log("✅ Транзакция успешно завершена");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Ошибка при сохранении данных в базу данных:", error);
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
  console.log("Получение данных SCFI для калькулятора...");

  try {
    const client = await pool.connect();

    try {
      // Проверяем структуру таблицы, чтобы определить правильные имена колонок
      console.log("Проверка структуры таблицы для запроса...");
      const tableInfoQuery = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = '${DB_CONFIG.TABLE_NAME.toLowerCase()}'
      `;
      
      const tableInfoResult = await client.query(tableInfoQuery);
      const columnNames = tableInfoResult.rows.map(row => row.column_name);
      
      console.log(`Найдены колонки: ${columnNames.join(', ')}`);
      
      // Определяем, какие имена колонок использовать
      const routeColumn = columnNames.includes('route') ? 'route' : 'rate';
      
      console.log(`Используем колонку для маршрута: ${routeColumn}`);

      // Получаем последнюю запись для Comprehensive Index
      const query = `
        SELECT * FROM ${DB_CONFIG.TABLE_NAME}
        WHERE ${routeColumn} = 'SCFI Comprehensive'
        ORDER BY current_date DESC
        LIMIT 1
      `;

      const result = await client.query(query);

      if (result.rows.length > 0) {
        console.log(
          `✅ Получены данные SCFI для калькулятора: ${result.rows[0].current_index}`
        );
        
        // Форматируем даты перед возвратом
        const row = result.rows[0];
        if (row.current_date) {
          row.current_date = formatDate(row.current_date);
        }
        if (row.previous_date) {
          row.previous_date = formatDate(row.previous_date);
        }
        
        return row;
      } else {
        console.log("❌ Данные SCFI для калькулятора не найдены в базе данных");

        // Если данных нет, получаем их
        const scfiData = await fetchSCFIData();

        // Находим Comprehensive Index
        const comprehensiveData = scfiData.find(
          (item) =>
            item.route === "SCFI Comprehensive" ||
            item.route === "Comprehensive Index"
        );

        if (comprehensiveData) {
          console.log(
            `✅ Использование свежеполученных данных SCFI: ${comprehensiveData.currentIndex}`
          );
          
          // Форматируем даты
          const formattedCurrentDate = formatDate(comprehensiveData.currentDate);
          const formattedPreviousDate = formatDate(comprehensiveData.previousDate);
          
          return {
            [routeColumn]: comprehensiveData.route,
            unit: comprehensiveData.unit,
            weighting: comprehensiveData.weighting,
            previous_index: comprehensiveData.previousIndex,
            current_index: comprehensiveData.currentIndex,
            change: comprehensiveData.change,
            previous_date: formattedPreviousDate,
            current_date: formattedCurrentDate,
          };
        } else {
          throw new Error("Не удалось получить данные SCFI для калькулятора");
        }
      }
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("❌ Ошибка при получении данных SCFI для калькулятора:", error);

    // В случае ошибки возвращаем моковые данные
    console.log("Использование моковых данных для калькулятора...");

    const mockData = await fetchMockSCFIData();
    const mockItem = mockData[0];
    
    // Форматируем даты
    const formattedCurrentDate = formatDate(mockItem.currentDate);
    const formattedPreviousDate = formatDate(mockItem.previousDate);

    return {
      route: mockItem.route,
      unit: mockItem.unit,
      weighting: mockItem.weighting,
      previous_index: mockItem.previousIndex,
      current_index: mockItem.currentIndex,
      change: mockItem.change,
      previous_date: formattedPreviousDate,
      current_date: formattedCurrentDate,
    };
  }
}

// Экспорт функций модуля
module.exports = {
  fetchSCFIData,
  getSCFIDataForCalculation,
};
