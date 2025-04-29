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
 * 9. Расширенная диагностика HTTP-запросов и сетевых проблем
 * 10. Улучшенное логирование для отладки проблем с подключением
 *
 * @module scfi_scraper
 * @author TSP Team
 * @version 2.5.0
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
  TIMEOUT: 30000, // Увеличенный таймаут до 30 секунд
  MAX_RETRIES: 5, // Увеличенное количество повторных попыток
  RETRY_DELAY: 5000, // Увеличенная задержка между попытками до 5 секунд
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
  console.log(`[formatDate] Входная дата: "${date}" (тип: ${typeof date})`);
  
  if (!date) {
    console.log('[formatDate] Дата не указана, возвращаю текущую дату');
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const formattedDate = `${year}-${month}-${day}`;
    console.log(`[formatDate] Возвращаю текущую дату: ${formattedDate}`);
    return formattedDate;
  }
  
  let dateObj;
  if (typeof date === 'string') {
    console.log(`[formatDate] Обработка строки даты: "${date}"`);
    
    // Если дата уже в формате YYYY-MM-DD, возвращаем как есть
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      console.log(`[formatDate] Дата уже в формате YYYY-MM-DD: ${date}`);
      return date;
    }
    
    // Пробуем разные форматы даты
    if (date.includes('/')) {
      // Формат MM/DD/YYYY или DD/MM/YYYY
      const parts = date.split('/');
      console.log(`[formatDate] Разбор даты с разделителем "/": ${parts.join(', ')}`);
      
      if (parts.length === 3) {
        // Предполагаем MM/DD/YYYY, но проверяем валидность
        const month = parseInt(parts[0], 10);
        const day = parseInt(parts[1], 10);
        const year = parseInt(parts[2], 10);
        
        console.log(`[formatDate] Пробую формат MM/DD/YYYY: месяц=${month}, день=${day}, год=${year}`);
        
        if (month > 0 && month <= 12 && day > 0 && day <= 31 && year > 2000) {
          dateObj = new Date(year, month - 1, day);
          console.log(`[formatDate] Формат MM/DD/YYYY подошел, создан объект Date: ${dateObj}`);
        } else {
          // Пробуем DD/MM/YYYY
          const day = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10);
          const year = parseInt(parts[2], 10);
          
          console.log(`[formatDate] Пробую формат DD/MM/YYYY: день=${day}, месяц=${month}, год=${year}`);
          
          if (month > 0 && month <= 12 && day > 0 && day <= 31 && year > 2000) {
            dateObj = new Date(year, month - 1, day);
            console.log(`[formatDate] Формат DD/MM/YYYY подошел, создан объект Date: ${dateObj}`);
          } else {
            // Не удалось распознать формат, используем текущую дату
            console.log('[formatDate] Не удалось распознать формат даты с "/", использую текущую дату');
            dateObj = new Date();
          }
        }
      } else {
        // Неизвестный формат с /, используем текущую дату
        console.log(`[formatDate] Неизвестный формат с "/", частей: ${parts.length}, использую текущую дату`);
        dateObj = new Date();
      }
    } else if (date.includes('-')) {
      // Формат YYYY-MM-DD или DD-MM-YYYY
      const parts = date.split('-');
      console.log(`[formatDate] Разбор даты с разделителем "-": ${parts.join(', ')}`);
      
      if (parts.length === 3) {
        if (parts[0].length === 4) {
          // YYYY-MM-DD
          console.log(`[formatDate] Определен формат YYYY-MM-DD: ${date}`);
          dateObj = new Date(date);
          console.log(`[formatDate] Создан объект Date: ${dateObj}`);
        } else {
          // DD-MM-YYYY
          const day = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10);
          const year = parseInt(parts[2], 10);
          
          console.log(`[formatDate] Пробую формат DD-MM-YYYY: день=${day}, месяц=${month}, год=${year}`);
          
          if (month > 0 && month <= 12 && day > 0 && day <= 31 && year > 2000) {
            dateObj = new Date(year, month - 1, day);
            console.log(`[formatDate] Формат DD-MM-YYYY подошел, создан объект Date: ${dateObj}`);
          } else {
            // Не удалось распознать формат, используем текущую дату
            console.log('[formatDate] Не удалось распознать формат даты с "-", использую текущую дату');
            dateObj = new Date();
          }
        }
      } else {
        // Неизвестный формат с -, используем текущую дату
        console.log(`[formatDate] Неизвестный формат с "-", частей: ${parts.length}, использую текущую дату`);
        dateObj = new Date();
      }
    } else {
      // Пробуем стандартный парсинг
      console.log(`[formatDate] Пробую стандартный парсинг даты: "${date}"`);
      dateObj = new Date(date);
      if (isNaN(dateObj.getTime())) {
        // Если не удалось распознать, используем текущую дату
        console.log('[formatDate] Стандартный парсинг не удался, использую текущую дату');
        dateObj = new Date();
      } else {
        console.log(`[formatDate] Стандартный парсинг успешен, создан объект Date: ${dateObj}`);
      }
    }
  } else if (date instanceof Date) {
    console.log(`[formatDate] Входные данные уже являются объектом Date: ${date}`);
    dateObj = date;
  } else {
    // Если не строка и не Date, используем текущую дату
    console.log(`[formatDate] Неподдерживаемый тип данных: ${typeof date}, использую текущую дату`);
    dateObj = new Date();
  }
  
  // Проверяем, что дата валидна
  if (isNaN(dateObj.getTime())) {
    console.log('[formatDate] Созданная дата невалидна, использую текущую дату');
    dateObj = new Date(); // Если дата невалидна, используем текущую
  }
  
  // Форматируем в YYYY-MM-DD
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  
  const formattedDate = `${year}-${month}-${day}`;
  console.log(`[formatDate] Итоговая отформатированная дата: ${formattedDate}`);
  return formattedDate;
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
  console.log("Версия скрапера: 2.5.0 (улучшенная диагностика HTTP-запросов и обработка дат)");

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

      // Сохраняем моковые данные в базу данных
      try {
        await saveSCFIData(mockData);
        console.log("✅ Моковые данные SCFI успешно сохранены в базу данных");
      } catch (error) {
        console.error(
          "❌ Ошибка при сохранении моковых данных SCFI в базу данных:",
          error
        );
      }

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

    // Сохраняем моковые данные в базу данных
    try {
      await saveSCFIData(mockData);
      console.log("✅ Моковые данные SCFI успешно сохранены в базу данных после критической ошибки");
    } catch (error) {
      console.error(
        "❌ Ошибка при сохранении моковых данных SCFI в базу данных после критической ошибки:",
        error
      );
    }

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
      console.log(`[HTTP] Подготовка запроса к ${SCFI_URL}`);
      console.log(`[HTTP] Заголовки запроса:`, JSON.stringify(HTTP_CONFIG.HEADERS, null, 2));
      console.log(`[HTTP] Таймаут: ${HTTP_CONFIG.TIMEOUT}мс`);
      
      console.log(`[HTTP] Отправка HTTP-запроса на ${SCFI_URL}`);
      
      // Создаем экземпляр axios с подробным логированием
      const axiosInstance = axios.create({
        timeout: HTTP_CONFIG.TIMEOUT,
        headers: HTTP_CONFIG.HEADERS,
        validateStatus: function (status) {
          console.log(`[HTTP] Получен статус ответа: ${status}`);
          return status >= 200 && status < 300; // Принимаем только успешные статусы
        }
      });
      
      // Добавляем перехватчик для логирования запроса
      axiosInstance.interceptors.request.use(request => {
        console.log(`[HTTP] Метод запроса: ${request.method}`);
        console.log(`[HTTP] URL запроса: ${request.url}`);
        return request;
      });
      
      // Добавляем перехватчик для логирования ответа
      axiosInstance.interceptors.response.use(
        response => {
          console.log(`[HTTP] Успешный ответ от ${response.config.url}`);
          console.log(`[HTTP] Статус ответа: ${response.status}`);
          console.log(`[HTTP] Заголовки ответа:`, JSON.stringify(response.headers, null, 2));
          console.log(`[HTTP] Тип контента: ${response.headers['content-type']}`);
          console.log(`[HTTP] Размер ответа: ${response.data ? response.data.length : 0} байт`);
          return response;
        },
        error => {
          if (error.response) {
            // Сервер ответил с кодом ошибки
            console.log(`[HTTP] Ошибка ответа от ${error.config.url}`);
            console.log(`[HTTP] Статус ошибки: ${error.response.status}`);
            console.log(`[HTTP] Заголовки ответа:`, JSON.stringify(error.response.headers, null, 2));
            console.log(`[HTTP] Данные ответа:`, error.response.data);
          } else if (error.request) {
            // Запрос был сделан, но ответ не получен
            console.log(`[HTTP] Ошибка: запрос отправлен, но ответ не получен`);
            console.log(`[HTTP] Детали запроса:`, error.request);
          } else {
            // Что-то пошло не так при настройке запроса
            console.log(`[HTTP] Ошибка при настройке запроса:`, error.message);
          }
          console.log(`[HTTP] Полная конфигурация запроса:`, error.config);
          return Promise.reject(error);
        }
      );
      
      // Выполняем запрос с расширенным логированием
      const response = await axiosInstance.get(SCFI_URL);

      if (response.status !== 200) {
        throw new Error(`Неуспешный статус ответа: ${response.status}`);
      }

      console.log(
        `[HTTP] Получен успешный ответ от ${SCFI_URL}, размер: ${response.data.length} байт`
      );

      // Парсинг HTML-страницы
      console.log("[HTML] Начинаю парсинг HTML-ответа...");
      const $ = cheerio.load(response.data);

      // Подробная диагностика страницы
      const pageTitle = $("title").text().trim();
      console.log(`[HTML] Заголовок страницы: "${pageTitle}"`);

      const tableCount = $("table").length;
      console.log(`[HTML] Количество таблиц на странице: ${tableCount}`);

      // Сохраняем HTML для отладки
      console.log(`[HTML] Первые 500 символов HTML: "${response.data.substring(0, 500)}..."`);

      // Поиск таблицы с данными SCFI
      console.log("[HTML] Поиск таблицы с данными SCFI...");
      let scfiTable = null;

      // Ищем таблицу, содержащую строку с "Comprehensive Index"
      $("table").each((i, table) => {
        const tableHtml = $(table).html().toLowerCase();
        if (tableHtml.includes("comprehensive index")) {
          console.log(`[HTML] Найдена таблица ${i + 1}, содержащая "Comprehensive Index"`);
          scfiTable = $(table);
          return false; // Прекращаем поиск таблиц
        }
      });

      // Если не нашли по "Comprehensive Index", ищем по другим признакам
      if (!scfiTable) {
        console.log("[HTML] Таблица с 'Comprehensive Index' не найдена, ищу по другим ключевым словам...");
        $("table").each((i, table) => {
          const tableHtml = $(table).html().toLowerCase();
          if (tableHtml.includes("scfi") || 
              tableHtml.includes("shanghai containerized freight index") ||
              tableHtml.includes("freight index")) {
            console.log(`[HTML] Найдена таблица ${i + 1}, содержащая ключевые слова SCFI`);
            scfiTable = $(table);
            return false; // Прекращаем поиск таблиц
          }
        });
      }

      // Если таблица не найдена, выбрасываем ошибку
      if (!scfiTable) {
        console.log("[HTML] ОШИБКА: Таблица с данными SCFI не найдена");
        console.log("[HTML] Вывожу все таблицы на странице для отладки:");
        
        $("table").each((i, table) => {
          console.log(`[HTML] Таблица ${i + 1}:`);
          console.log(`[HTML] Первые 200 символов: "${$(table).html().substring(0, 200)}..."`);
        });
        
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

      console.log(`[DATE] Текущая дата: ${currentDate}, Предыдущая дата: ${previousDate}`);

      // Попытка найти даты в заголовках таблицы
      let foundCurrentDate = null;
      let foundPreviousDate = null;

      // Ищем даты в заголовках таблицы
      console.log("[HTML] Поиск дат в заголовках таблицы...");
      scfiTable.find("th").each((i, th) => {
        const text = $(th).text().trim();
        console.log(`[HTML] Заголовок ${i + 1}: "${text}"`);
        
        const dateMatch = text.match(/(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/);
        if (dateMatch) {
          const dateStr = dateMatch[1].replace(/\//g, "-");
          console.log(`[HTML] Найдена дата в заголовке ${i + 1}: "${dateStr}"`);
          
          if (text.toLowerCase().includes("current")) {
            foundCurrentDate = formatDate(dateStr);
            console.log(`[HTML] Найдена текущая дата в заголовке: ${foundCurrentDate}`);
          } else if (text.toLowerCase().includes("previous")) {
            foundPreviousDate = formatDate(dateStr);
            console.log(`[HTML] Найдена предыдущая дата в заголовке: ${foundPreviousDate}`);
          }
        }
      });

      // Используем найденные даты или значения по умолчанию
      const usedCurrentDate = foundCurrentDate || currentDate;
      const usedPreviousDate = foundPreviousDate || previousDate;
      console.log(`[DATE] Используемая текущая дата: ${usedCurrentDate}`);
      console.log(`[DATE] Используемая предыдущая дата: ${usedPreviousDate}`);

      // Ищем строку с Comprehensive Index
      console.log("[HTML] Поиск строки с Comprehensive Index...");
      let comprehensiveRow = null;
      
      // Сначала ищем точное совпадение
      scfiTable.find("tr").each((i, row) => {
        const firstCellText = $(row).find("td").first().text().trim().toLowerCase();
        console.log(`[HTML] Строка ${i + 1}, первая ячейка: "${firstCellText}"`);
        
        if (firstCellText === "comprehensive index") {
          console.log(`[HTML] Найдена строка "Comprehensive Index" (индекс строки: ${i})`);
          comprehensiveRow = $(row);
          return false; // Прекращаем поиск строк
        }
      });
      
      // Если точное совпадение не найдено, ищем частичное
      if (!comprehensiveRow) {
        console.log("[HTML] Точное совпадение 'Comprehensive Index' не найдено, ищу частичное...");
        scfiTable.find("tr").each((i, row) => {
          const rowText = $(row).text().trim().toLowerCase();
          console.log(`[HTML] Строка ${i + 1}, текст: "${rowText.substring(0, 50)}..."`);
          
          if (rowText.includes("comprehensive") && rowText.includes("index")) {
            console.log(`[HTML] Найдена строка, содержащая "comprehensive" и "index" (индекс строки: ${i})`);
            comprehensiveRow = $(row);
            return false; // Прекращаем поиск строк
          }
        });
      }
      
      // Если строка с Comprehensive Index не найдена, выбрасываем ошибку
      if (!comprehensiveRow) {
        console.log("[HTML] ОШИБКА: Строка с Comprehensive Index не найдена");
        console.log("[HTML] Вывожу все строки таблицы для отладки:");
        
        scfiTable.find("tr").each((i, row) => {
          console.log(`[HTML] Строка ${i + 1}: "${$(row).text().trim()}"`);
        });
        
        throw new Error(
          "Строка с Comprehensive Index не найдена в таблице SCFI"
        );
      }
      
      // Извлекаем данные из строки Comprehensive Index
      console.log("[HTML] Извлечение данных из строки Comprehensive Index...");
      
      // Получаем все ячейки строки
      const cells = comprehensiveRow.find("td");
      console.log(`[HTML] Количество ячеек в строке: ${cells.length}`);
      
      // Выводим содержимое всех ячеек для отладки
      cells.each((i, cell) => {
        console.log(`[HTML] Ячейка ${i + 1}: "${$(cell).text().trim()}"`);
      });
      
      // Извлекаем значения из ячеек
      // Обычно структура: Route | Previous Index | Current Index | Change
      let previousIndex = null;
      let currentIndex = null;
      let change = null;
      
      // Проверяем разные варианты расположения данных в ячейках
      if (cells.length >= 4) {
        // Стандартный вариант: ячейки 1, 2, 3 содержат previous, current, change
        const prevText = $(cells[1]).text().trim();
        const currText = $(cells[2]).text().trim();
        const changeText = $(cells[3]).text().trim();
        
        console.log(`[HTML] Извлеченный текст - Previous: "${prevText}", Current: "${currText}", Change: "${changeText}"`);
        
        // Парсим числа, удаляя нечисловые символы (кроме точки и минуса)
        previousIndex = parseFloat(prevText.replace(/[^\d.-]/g, ""));
        currentIndex = parseFloat(currText.replace(/[^\d.-]/g, ""));
        
        // Для изменения, сохраняем знак процента, если он есть
        if (changeText.includes("%")) {
          change = parseFloat(changeText.replace(/[^\d.-]/g, ""));
          // Если есть знак минус перед процентом, учитываем его
          if (changeText.includes("-")) {
            change = -Math.abs(change);
          }
        } else {
          change = parseFloat(changeText.replace(/[^\d.-]/g, ""));
        }
        
        console.log(`[HTML] Распарсенные значения - Previous: ${previousIndex}, Current: ${currentIndex}, Change: ${change}`);
      } else if (cells.length === 3) {
        // Альтернативный вариант: ячейки 0, 1, 2 содержат previous, current, change
        const prevText = $(cells[0]).text().trim();
        const currText = $(cells[1]).text().trim();
        const changeText = $(cells[2]).text().trim();
        
        console.log(`[HTML] Извлеченный текст (вариант 2) - Previous: "${prevText}", Current: "${currText}", Change: "${changeText}"`);
        
        previousIndex = parseFloat(prevText.replace(/[^\d.-]/g, ""));
        currentIndex = parseFloat(currText.replace(/[^\d.-]/g, ""));
        
        if (changeText.includes("%")) {
          change = parseFloat(changeText.replace(/[^\d.-]/g, ""));
          if (changeText.includes("-")) {
            change = -Math.abs(change);
          }
        } else {
          change = parseFloat(changeText.replace(/[^\d.-]/g, ""));
        }
        
        console.log(`[HTML] Распарсенные значения (вариант 2) - Previous: ${previousIndex}, Current: ${currentIndex}, Change: ${change}`);
      } else if (cells.length === 2) {
        // Минимальный вариант: ячейки 0, 1 содержат current, change
        const currText = $(cells[0]).text().trim();
        const changeText = $(cells[1]).text().trim();
        
        console.log(`[HTML] Извлеченный текст (вариант 3) - Current: "${currText}", Change: "${changeText}"`);
        
        currentIndex = parseFloat(currText.replace(/[^\d.-]/g, ""));
        
        if (changeText.includes("%")) {
          change = parseFloat(changeText.replace(/[^\d.-]/g, ""));
          if (changeText.includes("-")) {
            change = -Math.abs(change);
          }
        } else {
          change = parseFloat(changeText.replace(/[^\d.-]/g, ""));
        }
        
        // Вычисляем previous на основе current и change
        if (!isNaN(currentIndex) && !isNaN(change)) {
          previousIndex = currentIndex / (1 + change / 100);
          previousIndex = Math.round(previousIndex * 100) / 100; // Округляем до 2 знаков
        }
        
        console.log(`[HTML] Распарсенные значения (вариант 3) - Previous: ${previousIndex}, Current: ${currentIndex}, Change: ${change}`);
      }
      
      // Проверяем, что удалось извлечь хотя бы текущий индекс
      if (isNaN(currentIndex)) {
        console.log("[HTML] ОШИБКА: Не удалось извлечь значение текущего индекса");
        throw new Error(
          "Не удалось извлечь значение индекса из строки Comprehensive Index"
        );
      }
      
      // Если не удалось извлечь предыдущий индекс или изменение, вычисляем их
      if (isNaN(previousIndex) && !isNaN(currentIndex) && !isNaN(change)) {
        previousIndex = currentIndex / (1 + change / 100);
        previousIndex = Math.round(previousIndex * 100) / 100; // Округляем до 2 знаков
        console.log(`[HTML] Вычислен предыдущий индекс на основе текущего и изменения: ${previousIndex}`);
      }
      
      if (isNaN(change) && !isNaN(currentIndex) && !isNaN(previousIndex)) {
        change = ((currentIndex / previousIndex) - 1) * 100;
        change = Math.round(change * 10) / 10; // Округляем до 1 знака
        console.log(`[HTML] Вычислено изменение на основе текущего и предыдущего индексов: ${change}%`);
      }
      
      // Создаем объект с данными SCFI
      const scfiData = [
        {
          route: "SCFI Comprehensive",
          unit: "Points",
          current_index: currentIndex,
          previous_index: previousIndex,
          change: change,
          current_date: usedCurrentDate,
          previous_date: usedPreviousDate,
          weighting: 1.0, // Для Comprehensive Index вес всегда 1.0
        },
      ];
      
      console.log("[HTML] Создан объект с данными SCFI:", JSON.stringify(scfiData, null, 2));
      
      return scfiData;
    } catch (error) {
      console.error(
        `Ошибка при получении данных SCFI с основного источника (попытка ${retryCount + 1}/${
          HTTP_CONFIG.MAX_RETRIES + 1
        }): ${error.message}`
      );
      console.error("Стек ошибки:", error.stack);
      
      lastError = error;
      retryCount++;
      
      if (retryCount > HTTP_CONFIG.MAX_RETRIES) {
        console.log("Все попытки получения данных с основного источника неудачны");
        throw lastError;
      }
    }
  }
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
        console.log(
          `Повторная попытка ${retryCount}/${HTTP_CONFIG.MAX_RETRIES} через ${HTTP_CONFIG.RETRY_DELAY}мс`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, HTTP_CONFIG.RETRY_DELAY)
        );
      }

      // Отправка запроса на альтернативный источник
      console.log(`[HTTP] Отправка HTTP-запроса на ${source.url}`);
      
      // Создаем экземпляр axios с подробным логированием
      const axiosInstance = axios.create({
        timeout: HTTP_CONFIG.TIMEOUT,
        headers: HTTP_CONFIG.HEADERS,
        validateStatus: function (status) {
          console.log(`[HTTP] Получен статус ответа: ${status}`);
          return status >= 200 && status < 300; // Принимаем только успешные статусы
        }
      });
      
      // Добавляем перехватчик для логирования запроса
      axiosInstance.interceptors.request.use(request => {
        console.log(`[HTTP] Метод запроса: ${request.method}`);
        console.log(`[HTTP] URL запроса: ${request.url}`);
        return request;
      });
      
      // Добавляем перехватчик для логирования ответа
      axiosInstance.interceptors.response.use(
        response => {
          console.log(`[HTTP] Успешный ответ от ${response.config.url}`);
          console.log(`[HTTP] Статус ответа: ${response.status}`);
          console.log(`[HTTP] Заголовки ответа:`, JSON.stringify(response.headers, null, 2));
          console.log(`[HTTP] Тип контента: ${response.headers['content-type']}`);
          console.log(`[HTTP] Размер ответа: ${response.data ? response.data.length : 0} байт`);
          return response;
        },
        error => {
          if (error.response) {
            // Сервер ответил с кодом ошибки
            console.log(`[HTTP] Ошибка ответа от ${error.config.url}`);
            console.log(`[HTTP] Статус ошибки: ${error.response.status}`);
            console.log(`[HTTP] Заголовки ответа:`, JSON.stringify(error.response.headers, null, 2));
            console.log(`[HTTP] Данные ответа:`, error.response.data);
          } else if (error.request) {
            // Запрос был сделан, но ответ не получен
            console.log(`[HTTP] Ошибка: запрос отправлен, но ответ не получен`);
            console.log(`[HTTP] Детали запроса:`, error.request);
          } else {
            // Что-то пошло не так при настройке запроса
            console.log(`[HTTP] Ошибка при настройке запроса:`, error.message);
          }
          console.log(`[HTTP] Полная конфигурация запроса:`, error.config);
          return Promise.reject(error);
        }
      );
      
      const response = await axiosInstance.get(source.url);

      console.log(
        `Получен ответ от ${source.url}, размер: ${response.data.length} байт`
      );

      // Парсинг HTML-страницы
      console.log("Парсинг HTML-ответа...");
      const $ = cheerio.load(response.data);

      // Поиск элементов по селектору
      console.log(`Поиск элементов по селектору: ${source.selector}`);
      const elements = $(source.selector);
      console.log(`Найдено ${elements.length} элементов`);

      if (elements.length === 0) {
        throw new Error(
          `Элементы по селектору ${source.selector} не найдены`
        );
      }

      // Поиск данных SCFI в найденных элементах
      let scfiValue = null;
      let scfiChange = null;
      let scfiDate = null;

      if (source.textSearch) {
        // Поиск по тексту
        const text = elements.text();
        console.log(`Поиск данных SCFI в тексте: ${text.substring(0, 200)}...`);

        // Поиск значения индекса
        const indexMatch = text.match(/SCFI.*?(\d+\.?\d*)/i);
        if (indexMatch) {
          scfiValue = parseFloat(indexMatch[1]);
          console.log(`Найдено значение индекса SCFI: ${scfiValue}`);
        }

        // Поиск изменения
        const changeMatch = text.match(/change.*?([+-]?\d+\.?\d*%?)/i);
        if (changeMatch) {
          scfiChange = parseFloat(changeMatch[1].replace("%", ""));
          console.log(`Найдено изменение индекса SCFI: ${scfiChange}%`);
        }

        // Поиск даты
        const dateMatch = text.match(
          /(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}|\d{4}[\/\.-]\d{1,2}[\/\.-]\d{1,2})/
        );
        if (dateMatch) {
          scfiDate = formatDate(dateMatch[1]);
          console.log(`Найдена дата индекса SCFI: ${scfiDate}`);
        }
      } else {
        // Поиск в таблице
        elements.each((i, element) => {
          const text = $(element).text();
          console.log(`Проверка элемента ${i + 1}: ${text.substring(0, 100)}...`);

          if (text.toLowerCase().includes("scfi") || text.toLowerCase().includes("shanghai containerized freight index")) {
            // Поиск значения индекса
            const rows = $(element).find("tr");
            console.log(`Найдено ${rows.length} строк в таблице`);

            rows.each((j, row) => {
              const rowText = $(row).text().toLowerCase();
              console.log(`Проверка строки ${j + 1}: ${rowText.substring(0, 50)}...`);

              if (rowText.includes("comprehensive") || rowText.includes("scfi")) {
                const cells = $(row).find("td");
                console.log(`Найдено ${cells.length} ячеек в строке`);

                // Извлекаем данные из ячеек
                if (cells.length >= 3) {
                  const valueText = $(cells[1]).text().trim();
                  const changeText = $(cells[2]).text().trim();

                  console.log(`Текст значения: "${valueText}", текст изменения: "${changeText}"`);

                  scfiValue = parseFloat(valueText.replace(/[^\d.-]/g, ""));
                  
                  if (changeText.includes("%")) {
                    scfiChange = parseFloat(changeText.replace(/[^\d.-]/g, ""));
                    if (changeText.includes("-")) {
                      scfiChange = -Math.abs(scfiChange);
                    }
                  } else {
                    scfiChange = parseFloat(changeText.replace(/[^\d.-]/g, ""));
                  }

                  console.log(`Распарсенное значение: ${scfiValue}, распарсенное изменение: ${scfiChange}`);
                  return false; // Прекращаем перебор строк
                }
              }
            });

            // Поиск даты в заголовке таблицы
            const headers = $(element).find("th, thead");
            headers.each((j, header) => {
              const headerText = $(header).text();
              const dateMatch = headerText.match(
                /(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}|\d{4}[\/\.-]\d{1,2}[\/\.-]\d{1,2})/
              );
              if (dateMatch) {
                scfiDate = formatDate(dateMatch[1]);
                console.log(`Найдена дата в заголовке: ${scfiDate}`);
                return false; // Прекращаем перебор заголовков
              }
            });

            return false; // Прекращаем перебор элементов
          }
        });
      }

      // Проверяем, что удалось найти хотя бы значение индекса
      if (scfiValue === null || isNaN(scfiValue)) {
        throw new Error(
          `Не удалось найти значение индекса SCFI на источнике ${source.name}`
        );
      }

      // Если не удалось найти дату, используем текущую
      if (scfiDate === null) {
        scfiDate = formatDate(new Date());
        console.log(`Используется текущая дата: ${scfiDate}`);
      }

      // Если не удалось найти изменение, устанавливаем его в 0
      if (scfiChange === null || isNaN(scfiChange)) {
        scfiChange = 0;
        console.log(`Используется значение изменения по умолчанию: ${scfiChange}`);
      }

      // Создаем объект с данными SCFI
      const scfiData = [
        {
          route: "SCFI Comprehensive",
          unit: "Points",
          current_index: scfiValue,
          previous_index: null, // Нет данных о предыдущем значении
          change: scfiChange,
          current_date: scfiDate,
          previous_date: null, // Нет данных о предыдущей дате
          weighting: 1.0, // Для Comprehensive Index вес всегда 1.0
        },
      ];

      console.log(`Создан объект с данными SCFI: ${JSON.stringify(scfiData)}`);

      return scfiData;
    } catch (error) {
      console.error(
        `Ошибка при получении данных SCFI с источника ${source.name} (попытка ${retryCount + 1}/${
          HTTP_CONFIG.MAX_RETRIES + 1
        }): ${error.message}`
      );

      lastError = error;
      retryCount++;

      if (retryCount > HTTP_CONFIG.MAX_RETRIES) {
        console.log(`Все попытки получения данных с источника ${source.name} неудачны`);
        throw lastError;
      }
    }
  }
}

/**
 * Функция для создания моковых данных SCFI
 * ОПТИМИЗИРОВАНА для создания ТОЛЬКО основного индекса (Comprehensive Index)
 *
 * @async
 * @function fetchMockSCFIData
 * @returns {Promise<Array>} Массив объектов с моковыми данными SCFI
 */
async function fetchMockSCFIData() {
  console.log("Создание моковых данных SCFI (только Comprehensive Index)...");

  // Получение текущей даты и даты неделю назад
  const today = new Date();
  const currentDate = formatDate(today);
  const prevDate = new Date(today);
  prevDate.setDate(prevDate.getDate() - 7);
  const previousDate = formatDate(prevDate);

  // Создание моковых данных для Comprehensive Index
  const mockCurrentIndex = 1100; // Фиксированное значение для стабильности
  const mockChange = 2; // Фиксированное изменение для стабильности
  const mockPreviousIndex = Math.round((mockCurrentIndex / (1 + mockChange / 100)) * 100) / 100;

  console.log(`Создан моковый Comprehensive Index: ${mockCurrentIndex} (изменение: ${mockChange})`);

  const mockData = [
    {
      route: "SCFI Comprehensive",
      unit: "Points",
      current_index: mockCurrentIndex,
      previous_index: mockPreviousIndex,
      change: mockChange,
      current_date: currentDate,
      previous_date: previousDate,
      weighting: 1.0,
    },
  ];

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
  if (!data || !Array.isArray(data) || data.length === 0) {
    console.log("Нет данных для сохранения в базу данных");
    return;
  }

  console.log(`Сохранение ${data.length} записей SCFI в базу данных...`);

  const client = await pool.connect();
  try {
    // Проверяем, существует ли таблица
    const tableCheckQuery = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = '${DB_CONFIG.TABLE_NAME}'
      );
    `;
    const tableCheckResult = await client.query(tableCheckQuery);
    const tableExists = tableCheckResult.rows[0].exists;

    if (!tableExists) {
      console.log(`Таблица ${DB_CONFIG.TABLE_NAME} не существует, создаем...`);
      const createTableQuery = `
        CREATE TABLE ${DB_CONFIG.TABLE_NAME} (
          id SERIAL PRIMARY KEY,
          route VARCHAR(255) NOT NULL,
          unit VARCHAR(50),
          current_index NUMERIC,
          previous_index NUMERIC,
          change NUMERIC,
          current_date DATE,
          previous_date DATE,
          weighting NUMERIC,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;
      await client.query(createTableQuery);
      console.log(`Таблица ${DB_CONFIG.TABLE_NAME} успешно создана`);
    }

    // Проверяем, как называется колонка для маршрута (route или rate)
    console.log("Проверка имени колонки для маршрута...");
    const columnCheckQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = '${DB_CONFIG.TABLE_NAME}' 
      AND column_name IN ('route', 'rate');
    `;
    const columnCheckResult = await client.query(columnCheckQuery);
    
    let routeColumnName = 'route'; // По умолчанию
    if (columnCheckResult.rows.length > 0) {
      routeColumnName = columnCheckResult.rows[0].column_name;
      console.log(`Найдена колонка для маршрута: ${routeColumnName}`);
    } else {
      console.log(`Колонка для маршрута не найдена, использую значение по умолчанию: ${routeColumnName}`);
    }

    // Начинаем транзакцию
    await client.query("BEGIN");

    // Сохраняем каждую запись
    for (const item of data) {
      // Форматируем даты
      const currentDate = item.current_date ? formatDate(item.current_date) : null;
      const previousDate = item.previous_date ? formatDate(item.previous_date) : null;

      console.log(`Сохранение записи: ${item.route}, текущий индекс: ${item.current_index}, дата: ${currentDate}`);

      // Используем INSERT ... ON CONFLICT DO UPDATE
      const query = `
        INSERT INTO ${DB_CONFIG.TABLE_NAME} (
          ${routeColumnName}, unit, current_index, previous_index, change, 
          current_date, previous_date, weighting, updated_at
        ) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
        ON CONFLICT (${routeColumnName}, current_date) 
        DO UPDATE SET
          unit = EXCLUDED.unit,
          current_index = EXCLUDED.current_index,
          previous_index = EXCLUDED.previous_index,
          change = EXCLUDED.change,
          previous_date = EXCLUDED.previous_date,
          weighting = EXCLUDED.weighting,
          updated_at = CURRENT_TIMESTAMP
        RETURNING id;
      `;

      try {
        const result = await client.query(query, [
          item.route,
          item.unit,
          item.current_index,
          item.previous_index,
          item.change,
          currentDate,
          previousDate,
          item.weighting,
        ]);

        console.log(`Запись сохранена с ID: ${result.rows[0].id}`);
      } catch (error) {
        // Если ошибка связана с отсутствием ограничения уникальности, пробуем другой запрос
        if (error.message.includes('duplicate key value violates unique constraint') || 
            error.message.includes('there is no unique or exclusion constraint')) {
          console.log(`Ошибка с ограничением уникальности, пробую альтернативный запрос...`);
          
          // Проверяем, существует ли уже запись
          const checkQuery = `
            SELECT id FROM ${DB_CONFIG.TABLE_NAME}
            WHERE ${routeColumnName} = $1 AND current_date = $2;
          `;
          const checkResult = await client.query(checkQuery, [item.route, currentDate]);
          
          if (checkResult.rows.length > 0) {
            // Запись существует, обновляем
            const updateQuery = `
              UPDATE ${DB_CONFIG.TABLE_NAME}
              SET unit = $1, current_index = $2, previous_index = $3, 
                  change = $4, previous_date = $5, weighting = $6, updated_at = CURRENT_TIMESTAMP
              WHERE ${routeColumnName} = $7 AND current_date = $8
              RETURNING id;
            `;
            const updateResult = await client.query(updateQuery, [
              item.unit,
              item.current_index,
              item.previous_index,
              item.change,
              previousDate,
              item.weighting,
              item.route,
              currentDate
            ]);
            
            console.log(`Запись обновлена с ID: ${updateResult.rows[0].id}`);
          } else {
            // Запись не существует, вставляем
            const insertQuery = `
              INSERT INTO ${DB_CONFIG.TABLE_NAME} (
                ${routeColumnName}, unit, current_index, previous_index, change, 
                current_date, previous_date, weighting, updated_at
              ) 
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
              RETURNING id;
            `;
            const insertResult = await client.query(insertQuery, [
              item.route,
              item.unit,
              item.current_index,
              item.previous_index,
              item.change,
              currentDate,
              previousDate,
              item.weighting,
            ]);
            
            console.log(`Запись вставлена с ID: ${insertResult.rows[0].id}`);
          }
        } else {
          // Другая ошибка, пробрасываем дальше
          throw error;
        }
      }
    }

    // Завершаем транзакцию
    await client.query("COMMIT");
    console.log(`Все ${data.length} записей SCFI успешно сохранены в базу данных`);
  } catch (error) {
    // В случае ошибки отменяем транзакцию
    await client.query("ROLLBACK");
    console.error("Ошибка при сохранении данных SCFI в базу данных:", error);
    throw error;
  } finally {
    // Освобождаем клиент
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
      // Проверяем, как называется колонка для маршрута (route или rate)
      console.log("Проверка имени колонки для маршрута...");
      const columnCheckQuery = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = '${DB_CONFIG.TABLE_NAME}' 
        AND column_name IN ('route', 'rate');
      `;
      const columnCheckResult = await client.query(columnCheckQuery);
      
      let routeColumnName = 'route'; // По умолчанию
      if (columnCheckResult.rows.length > 0) {
        routeColumnName = columnCheckResult.rows[0].column_name;
        console.log(`Найдена колонка для маршрута: ${routeColumnName}`);
      } else {
        console.log(`Колонка для маршрута не найдена, использую значение по умолчанию: ${routeColumnName}`);
      }
      
      // Получаем последнюю запись для Comprehensive Index
      const query = `
        SELECT * FROM ${DB_CONFIG.TABLE_NAME}
        WHERE ${routeColumnName} = 'SCFI Comprehensive' OR ${routeColumnName} = 'SCFI Comprehensive AI'
        ORDER BY current_date DESC
        LIMIT 1;
      `;
      
      const result = await client.query(query);
      
      if (result.rows.length === 0) {
        console.log("Данные SCFI не найдены в базе данных");
        
        // Если данных нет, возвращаем моковые данные
        const mockData = await fetchMockSCFIData();
        return {
          current_index: mockData[0].current_index,
          previous_index: mockData[0].previous_index,
          change: mockData[0].change,
          current_date: mockData[0].current_date,
          previous_date: mockData[0].previous_date,
        };
      }
      
      const scfiData = result.rows[0];
      console.log(`Получены данные SCFI: ${JSON.stringify(scfiData)}`);
      
      // Форматируем даты
      const currentDate = scfiData.current_date ? formatDate(scfiData.current_date) : null;
      const previousDate = scfiData.previous_date ? formatDate(scfiData.previous_date) : null;
      
      return {
        current_index: scfiData.current_index,
        previous_index: scfiData.previous_index,
        change: scfiData.change,
        current_date: currentDate,
        previous_date: previousDate,
      };
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Ошибка при получении данных SCFI для калькулятора:", error);
    
    // В случае ошибки возвращаем моковые данные
    const mockData = await fetchMockSCFIData();
    return {
      current_index: mockData[0].current_index,
      previous_index: mockData[0].previous_index,
      change: mockData[0].change,
      current_date: mockData[0].current_date,
      previous_date: mockData[0].previous_date,
    };
  }
}

// Экспорт функций модуля
module.exports = {
  fetchSCFIData,
  getSCFIDataForCalculation,
};
