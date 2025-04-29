// Модуль для сбора данных из China Containerized Freight Index (CCFI)
// Использует публично доступные данные индекса CCFI

const axios = require("axios");
const cheerio = require("cheerio");
const { Pool } = require("pg");
const dotenv = require("dotenv");

// Загрузка переменных окружения
dotenv.config();

// Подключение к базе данных
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
    sslmode: "require",
  },
});

// URL для получения данных CCFI
const CCFI_URL = "https://en.sse.net.cn/indices/ccfinew.jsp";
// Альтернативные источники данных (в порядке приоритета)
const CCFI_ALT_URLS = [
  "https://en.macromicro.me/series/20786/ccfi-composite-index",
  "https://www.freightwaves.com/news/tag/ccfi",
  "https://www.container-news.com/ccfi/",
  "https://www.hellenicshippingnews.com/china-containerized-freight-index/",
];

// Константы для настройки HTTP-запросов
const HTTP_CONFIG = {
  // Таймаут запроса в миллисекундах
  TIMEOUT: 15000,
  // Максимальное количество повторных попыток
  MAX_RETRIES: 3,
  // Задержка между повторными попытками в миллисекундах
  RETRY_DELAY: 2000,
  // Заголовки для имитации реального браузера
  HEADERS: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
  },
};

/**
 * Функция-адаптер для преобразования данных в единый формат
 * 
 * Эта функция принимает данные в любом формате и преобразует их
 * в единый формат с полями current_index, change, index_date,
 * который ожидается сервером.
 * 
 * @function normalizeIndexData
 * @param {Object} data - Данные индекса в любом формате
 * @returns {Object} Данные в едином формате
 */
function normalizeIndexData(data) {
  if (!data) {
    console.error("Received null or undefined data in normalizeIndexData");
    return null;
  }

  console.log("Normalizing index data:", JSON.stringify(data));

  // Создаем новый объект с полями, ожидаемыми сервером
  const normalizedData = {
    current_index: null,
    change: null,
    index_date: null,
  };

  // Определяем значение для current_index
  if ("current_index" in data) {
    normalizedData.current_index = parseFloat(data.current_index);
  } else if ("currentIndex" in data) {
    normalizedData.current_index = parseFloat(data.currentIndex);
  } else if ("value" in data) {
    normalizedData.current_index = parseFloat(data.value);
  } else if ("index_value" in data) {
    normalizedData.current_index = parseFloat(data.index_value);
  } else if ("index" in data && typeof data.index === "number") {
    normalizedData.current_index = parseFloat(data.index);
  }

  // Определяем значение для change
  if ("change" in data) {
    normalizedData.change = parseFloat(data.change);
  } else if ("index_change" in data) {
    normalizedData.change = parseFloat(data.index_change);
  } else if ("delta" in data) {
    normalizedData.change = parseFloat(data.delta);
  }

  // Определяем значение для index_date
  if ("index_date" in data) {
    normalizedData.index_date = formatDate(data.index_date);
  } else if ("indexDate" in data) {
    normalizedData.index_date = formatDate(data.indexDate);
  } else if ("date" in data) {
    normalizedData.index_date = formatDate(data.date);
  } else if ("current_date" in data) {
    normalizedData.index_date = formatDate(data.current_date);
  } else if ("timestamp" in data) {
    normalizedData.index_date = formatDate(data.timestamp);
  } else {
    // Если дата не найдена, используем текущую дату
    normalizedData.index_date = formatDate(new Date());
  }

  // Проверяем, что все поля имеют значения
  if (
    normalizedData.current_index === null ||
    isNaN(normalizedData.current_index)
  ) {
    console.warn("Failed to determine current_index value, using default");
    normalizedData.current_index = 1122.4; // Актуальное значение CCFI на 25.04.2025
  }

  if (normalizedData.change === null || isNaN(normalizedData.change)) {
    console.warn("Failed to determine change value, using default");
    normalizedData.change = 1.0; // Актуальное изменение CCFI на 25.04.2025 (+1%)
  }

  if (!normalizedData.index_date) {
    console.warn("Failed to determine index_date value, using current date");
    normalizedData.index_date = formatDate(new Date());
  }

  console.log("Normalized data:", JSON.stringify(normalizedData));
  return normalizedData;
}

/**
 * Вспомогательная функция для форматирования даты
 * 
 * @function formatDate
 * @param {Date|string} date - Дата для форматирования
 * @returns {string} Дата в формате YYYY-MM-DD
 */
function formatDate(date) {
  if (!date) {
    return new Date().toISOString().split("T")[0];
  }

  if (typeof date === "string") {
    // Если дата уже в формате YYYY-MM-DD, возвращаем её
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return date;
    }

    // Пытаемся преобразовать строку в дату
    const parsedDate = new Date(date);
    if (!isNaN(parsedDate.getTime())) {
      return parsedDate.toISOString().split("T")[0];
    }
  }

  if (date instanceof Date) {
    return date.toISOString().split("T")[0];
  }

  // Если не удалось преобразовать, возвращаем текущую дату
  return new Date().toISOString().split("T")[0];
}

// Функция для получения данных CCFI с основного источника (Shanghai Shipping Exchange)
// с улучшенным парсингом таблицы и обработкой ошибок.
// Версия 2.1.0 - Улучшенная логика парсинга и обработки ошибок
async function fetchCCFIFromPrimarySource() {
  console.log("Fetching CCFI data from primary source (Shanghai Shipping Exchange)...");
  let retryCount = 0;
  let lastError = null;

  while (retryCount < HTTP_CONFIG.MAX_RETRIES) {
    try {
      if (retryCount > 0) {
        console.log(`Retry attempt ${retryCount + 1}/${HTTP_CONFIG.MAX_RETRIES} after ${HTTP_CONFIG.RETRY_DELAY}ms delay`);
        await new Promise(resolve => setTimeout(resolve, HTTP_CONFIG.RETRY_DELAY));
      }

      console.log(`Sending HTTP request to ${CCFI_URL}`);
      const response = await axios.get(CCFI_URL, {
        headers: HTTP_CONFIG.HEADERS,
        timeout: HTTP_CONFIG.TIMEOUT
      });

      if (response.status !== 200) {
        throw new Error(`Failed to fetch CCFI data from primary source: HTTP status ${response.status}`);
      }

      console.log(`Received response from ${CCFI_URL}, content length: ${response.data.length} bytes`);
      console.log("Parsing HTML response...");
      const $ = cheerio.load(response.data);
      const ccfiData = [];
      let currentDate = "";
      let previousDate = "";

      // Ищем таблицу с данными CCFI (улучшенная логика)
      console.log("Searching for CCFI data table...");
      let ccfiTable = null;
      let tableFoundMethod = "";

      // Метод 1: Поиск по заголовкам, содержащим даты и ключевые слова
      $("table").each(function() {
          const headerText = $(this).find("th").text();
          if (headerText.includes("Current Index") && headerText.includes("Previous Index") && headerText.includes("Weekly Growth")) {
              ccfiTable = $(this);
              tableFoundMethod = "headers with dates and keywords";
              return false; // Нашли, выходим
          }
      });

      // Метод 2: Поиск по специфичным заголовкам и содержимому
      if (!ccfiTable) {
          $("table").each(function() {
              const headerText = $(this).find("th").first().text().toLowerCase();
              const firstRowText = $(this).find("tr").eq(1).text().toLowerCase(); // Текст первой строки данных
              // Ищем "description" в заголовке и "composite" или "europe" в первой строке
              if (headerText.includes("description") && (firstRowText.includes("composite") || firstRowText.includes("europe"))) {
                  ccfiTable = $(this);
                  tableFoundMethod = "description header and content";
                  return false; // Нашли, выходим
              }
          });
      }
      
      // Метод 3: Поиск по наличию ключевых слов в HTML таблицы
      if (!ccfiTable) {
        $("table").each(function() {
          const tableHtml = $(this).html().toLowerCase();
          // Ищем одновременное наличие "composite index", "europe", и "mediterranean"
          if (tableHtml.includes("composite index") && tableHtml.includes("europe") && tableHtml.includes("mediterranean")) {
            ccfiTable = $(this);
            tableFoundMethod = "keywords in HTML";
            return false; // Нашли, выходим
          }
        });
      }

      if (!ccfiTable) {
        throw new Error("CCFI data table not found on the page using multiple methods.");
      }
      console.log(`Found CCFI data table using method: ${tableFoundMethod}`);

      // Извлечение дат из заголовков таблицы
      console.log("Extracting dates from table headers...");
      const headerCells = ccfiTable.find("th");
      headerCells.each((i, el) => {
          const text = $(el).text().trim();
          // Ищем дату в формате YYYY-MM-DD
          const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
          if (dateMatch) {
              if (text.includes("Current Index")) {
                  currentDate = dateMatch[1];
              } else if (text.includes("Previous Index")) {
                  previousDate = dateMatch[1];
              }
          }
      });

      // Если даты не найдены в заголовках, используем запасные варианты
      if (!currentDate) {
        currentDate = new Date().toISOString().split("T")[0];
        console.log(`Current date not found in headers, using current date: ${currentDate}`);
      }
      if (!previousDate) {
        const prevDate = new Date(currentDate);
        prevDate.setDate(prevDate.getDate() - 7); // Предполагаем еженедельные данные
        previousDate = prevDate.toISOString().split("T")[0];
        console.log(`Previous date not found in headers, using date from week ago: ${previousDate}`);
      }
      console.log(`Using dates: Current date: ${currentDate}, Previous date: ${previousDate}`);

      // Определяем индексы столбцов на основе заголовков
      let descriptionCol = -1, currentCol = -1, prevCol = -1, growthCol = -1;
      ccfiTable.find("tr").first().find("th").each((index, th) => {
          const text = $(th).text().toLowerCase();
          if (text.includes("description")) descriptionCol = index;
          else if (text.includes("current index")) currentCol = index;
          else if (text.includes("previous index")) prevCol = index;
          else if (text.includes("weekly growth")) growthCol = index;
      });

      // Проверка и установка значений по умолчанию, если не все столбцы найдены
      if (descriptionCol === -1 || currentCol === -1 || growthCol === -1) {
          console.warn(`Could not reliably determine all column indices. Found: Desc=${descriptionCol}, Curr=${currentCol}, Prev=${prevCol}, Growth=${growthCol}. Attempting default indices [0, 2, 1, 3]`);
          descriptionCol = descriptionCol === -1 ? 0 : descriptionCol;
          currentCol = currentCol === -1 ? 2 : currentCol;
          prevCol = prevCol === -1 ? 1 : prevCol; // prevCol не используется для основной логики, но определяем для полноты
          growthCol = growthCol === -1 ? 3 : growthCol;
      }
      console.log(`Column indices determined: Description=${descriptionCol}, Previous=${prevCol}, Current=${currentCol}, Growth=${growthCol}`);

      console.log("Parsing CCFI table rows...");
      let rowCount = 0;
      let validRowCount = 0;
      ccfiTable.find("tr").each((i, row) => {
        // Пропускаем заголовок
        if (i === 0 || $(row).find("th").length > 0) {
          console.log(`Skipping header row ${i}`);
          return;
        }

        rowCount++;
        const cells = $(row).find("td");
        // Убедимся, что есть достаточно ячеек для извлечения данных
        const requiredCols = Math.max(descriptionCol, currentCol, growthCol) + 1;

        if (cells.length >= requiredCols) {
          const route = $(cells[descriptionCol]).text().trim();
          const currentIndexText = $(cells[currentCol]).text().trim();
          const weeklyGrowthText = $(cells[growthCol]).text().trim();
          
          // Извлекаем числовые значения, удаляя запятые и знак процента
          const currentIndexValue = parseFloat(currentIndexText.replace(/,/g, ""));
          const weeklyGrowthValue = parseFloat(weeklyGrowthText.replace(/%/g, ""));

          console.log(`Row ${rowCount}: Route: "${route}", Current Index Text: "${currentIndexText}", Weekly Growth Text: "${weeklyGrowthText}"`);

          // Проверяем валидность извлеченных данных
          if (route && !isNaN(currentIndexValue) && !isNaN(weeklyGrowthValue)) {
            validRowCount++;
            ccfiData.push({
              route: route,
              currentIndex: currentIndexValue,
              // Сохраняем процентное изменение в поле 'change'
              change: weeklyGrowthValue, 
              indexDate: currentDate
            });
            console.log(`Added valid data for route: ${route}, current index: ${currentIndexValue}, change (growth %): ${weeklyGrowthValue}`);
          } else {
            console.log(`Skipping invalid row: Route: "${route}", Current Index Value: ${currentIndexValue}, Weekly Growth Value: ${weeklyGrowthValue}`);
          }
        } else {
          console.log(`Skipping row ${rowCount} due to insufficient columns (${cells.length} < ${requiredCols})`);
        }
      });

      console.log(`Processed ${rowCount} rows, found ${validRowCount} valid rows`);

      if (ccfiData.length === 0) {
        throw new Error("No valid CCFI data found in the table after parsing.");
      }

      console.log(`Successfully parsed ${ccfiData.length} CCFI records from primary source`);
      return ccfiData; // Успешно получили и распарсили данные

    } catch (error) {
      lastError = error;
      console.error(`Error fetching/parsing CCFI data from primary source (attempt ${retryCount + 1}/${HTTP_CONFIG.MAX_RETRIES}):`, error.message);
      // Добавляем вывод стека ошибки для лучшей диагностики
      if (error.stack) {
          console.error("Stack trace:", error.stack);
      }
      retryCount++;
    }
  }

  // Если все попытки неудачны, выбрасываем последнюю ошибку
  console.error("All retry attempts failed for primary source.");
  throw lastError || new Error("Failed to fetch CCFI data from primary source after multiple attempts");
}

// Функция для получения данных CCFI с альтернативного источника
async function fetchCCFIFromAlternativeSource(url) {
  try {
    console.log(`Fetching CCFI data from alternative source: ${url}`);

    // Отправка запроса на альтернативный сайт
    const response = await axios.get(url, {
      headers: HTTP_CONFIG.HEADERS,
      timeout: HTTP_CONFIG.TIMEOUT,
    });

    // Проверка успешности запроса
    if (response.status !== 200) {
      throw new Error(
        `Failed to fetch CCFI data from alternative source: ${response.status}`
      );
    }

    // Парсинг HTML-страницы
    const $ = cheerio.load(response.data);

    // Извлечение данных из статей
    const ccfiData = [];

    // Получение текущей даты
    const currentDate = new Date().toISOString().split("T")[0];

    // Определение типа источника и соответствующий парсинг
    if (url.includes("macromicro")) {
      // Парсинг данных с MacroMicro
      console.log("Parsing MacroMicro format...");

      // Извлечение значения индекса
      const indexValue = $(".value").text().trim();
      const currentIndex = parseFloat(indexValue.replace(",", ""));

      // Извлечение изменения индекса
      const changeText = $(".change").text().trim();
      const changeMatch = changeText.match(/([-+]?\d+(\.\d+)?)/);
      const change = changeMatch ? parseFloat(changeMatch[1]) : 0;

      // Проверка валидности данных
      if (!isNaN(currentIndex)) {
        // Добавление данных в массив
        ccfiData.push({
          route: "CCFI Composite Index",
          currentIndex,
          change,
          indexDate: currentDate,
        });

        console.log(
          `Found CCFI data on MacroMicro: Index: ${currentIndex}, Change: ${change}`
        );
      } else {
        console.log(`Invalid CCFI data on MacroMicro: Index: ${indexValue}`);
      }
    } else if (
      url.includes("freightwaves") ||
      url.includes("container-news") ||
      url.includes("hellenicshippingnews")
    ) {
      // Поиск статей с упоминанием CCFI
      const articles = $("article, .article, .post, .entry, .content");
      console.log(`Found ${articles.length} articles on the page`);

      // Ищем в статьях упоминания индекса CCFI и его значения
      articles.each((i, article) => {
        const articleText = $(article).text();

        // Ищем упоминание композитного индекса CCFI
        const indexMatch = articleText.match(/CCFI.*?(\d+(\.\d+)?)/i);

        if (indexMatch) {
          const currentIndex = parseFloat(indexMatch[1]);

          // Ищем упоминание изменения индекса
          const changeMatch = articleText.match(
            /(up|down|increased|decreased|rose|fell).*?(\d+(\.\d+)?)/i
          );
          let change = 0;

          if (changeMatch) {
            change = parseFloat(changeMatch[2]);
            const direction = changeMatch[1].toLowerCase();

            // Определяем направление изменения
            if (
              direction.includes("down") ||
              direction.includes("decreased") ||
              direction.includes("fell")
            ) {
              change = -change;
            }

            console.log(`Found change value in article: ${change} (${direction})`);
          } else {
            console.log("No change value found in article, using default: 0");
          }

          // Добавление данных в массив, если индекс является числом
          if (!isNaN(currentIndex)) {
            console.log(
              `Adding data from article: Index: ${currentIndex}, Change: ${change}`
            );

            ccfiData.push({
              route: "CCFI Composite Index",
              currentIndex,
              change,
              indexDate: currentDate,
            });

            console.log("Successfully added data from article");

            // Берем только первое найденное значение
            return false;
          } else {
            console.log(`Invalid index value found in article: ${currentIndex}`);
          }
        }
      });
    }

    console.log(
      `Parsed CCFI data from alternative source ${url}: ${ccfiData.length} records`
    );

    return ccfiData;
  } catch (error) {
    console.error(`Error fetching CCFI data from alternative source ${url}:`, error);
    return [];
  }
}

// Функция для получения моковых данных CCFI
async function fetchMockCCFIData() {
  console.log("Using mock data for CCFI");

  // Получение текущей даты
  const currentDate = new Date().toISOString().split("T")[0];

  // Создание моковых данных на основе реальных значений CCFI
  const mockData = [
    {
      route: "CCFI Composite Index",
      currentIndex: 1122.4, // Значение на 25.04.2025
      change: 1.0, // Изменение на 25.04.2025 (+1%)
      indexDate: currentDate,
    },
    {
      route: "Europe",
      currentIndex: 1300.0, // Примерное значение
      change: 1.2,
      indexDate: currentDate,
    },
    {
      route: "Mediterranean",
      currentIndex: 1800.0, // Примерное значение
      change: -0.5,
      indexDate: currentDate,
    },
    {
      route: "W/C America",
      currentIndex: 800.0, // Примерное значение
      change: 2.0,
      indexDate: currentDate,
    },
    {
      route: "E/C America",
      currentIndex: 1000.0, // Примерное значение
      change: 0.8,
      indexDate: currentDate,
    },
  ];

  // Сохранение моковых данных в базу данных (опционально)
  // await saveCCFIData(mockData);

  return mockData;
}

// Функция для сохранения данных CCFI в базу данных
async function saveCCFIData(ccfiData) {
  const client = await pool.connect();

  try {
    // Начало транзакции
    await client.query("BEGIN");

    // Создание таблицы, если она не существует
    await client.query(`
      CREATE TABLE IF NOT EXISTS freight_indices_ccfi (
        id SERIAL PRIMARY KEY,
        route VARCHAR(255) NOT NULL,
        current_index NUMERIC NOT NULL,
        "change" NUMERIC,
        index_date DATE NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(route, index_date)
      )
    `);

    // Вставка данных
    for (const data of ccfiData) {
      // Проверка, что данные валидны перед вставкой
      if (
        data.route &&
        data.currentIndex !== undefined &&
        !isNaN(data.currentIndex) &&
        data.indexDate
      ) {
        await client.query(
          `INSERT INTO freight_indices_ccfi
           (route, current_index, "change", index_date)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (route, index_date)
           DO UPDATE SET
             current_index = EXCLUDED.current_index,
             "change" = EXCLUDED.change,
             created_at = NOW()`, // Обновляем created_at при конфликте
          [
            data.route,
            data.currentIndex,
            data.change !== undefined && !isNaN(data.change) ? data.change : null,
            data.indexDate,
          ]
        );
      } else {
        console.warn("Skipping invalid CCFI data record:", data);
      }
    }

    // Завершение транзакции
    await client.query("COMMIT");

    console.log(`Saved ${ccfiData.length} valid CCFI records to database`);
  } catch (error) {
    // Откат транзакции в случае ошибки
    await client.query("ROLLBACK");
    console.error("Error saving CCFI data to database:", error);
    throw error;
  } finally {
    // Освобождение клиента
    client.release();
  }
}

/**
 * Основная функция для получения данных CCFI.
 * Пытается получить данные с основного источника, затем с альтернативных.
 * Если все источники недоступны, возвращает моковые данные.
 * 
 * @async
 * @function fetchCCFIData
 * @returns {Promise<Array>} Массив с данными CCFI
 */
async function fetchCCFIData() {
  try {
    // Попытка получить данные с основного источника
    const primaryData = await fetchCCFIFromPrimarySource();
    if (primaryData && primaryData.length > 0) {
      await saveCCFIData(primaryData);
      return primaryData;
    }
  } catch (primaryError) {
    console.error(
      "Failed to fetch CCFI data from primary source, trying alternatives...",
      primaryError.message
    );

    // Попытка получить данные с альтернативных источников
    for (const altUrl of CCFI_ALT_URLS) {
      try {
        const altData = await fetchCCFIFromAlternativeSource(altUrl);
        if (altData && altData.length > 0) {
          await saveCCFIData(altData);
          return altData;
        }
      } catch (altError) {
        console.error(
          `Failed to fetch CCFI data from alternative source ${altUrl}:`,
          altError.message
        );
      }
    }

    // Если все источники недоступны, используем моковые данные
    console.warn(
      "All CCFI data sources failed, falling back to mock data."
    );
    const mockData = await fetchMockCCFIData();
    // Не сохраняем моковые данные в базу по умолчанию
    // await saveCCFIData(mockData);
    return mockData;
  }
}

/**
 * Функция для получения данных CCFI для расчета ставок.
 * Возвращает объект { current_index, change, index_date } для композитного индекса
 * или null, если данные недоступны.
 * 
 * @async
 * @function getCCFIDataForCalculation
 * @returns {Promise<Object|null>} Данные CCFI для расчета или null
 */
async function getCCFIDataForCalculation() {
  let ccfiCalcData = null;
  try {
    // 1. Попытка получить последние данные CCFI из базы данных для композитного индекса
    const query = `
      SELECT current_index, change, index_date
      FROM freight_indices_ccfi
      WHERE route ILIKE '%composite%'
      ORDER BY index_date DESC
      LIMIT 1
    `;
    const result = await pool.query(query);

    if (result.rows.length > 0) {
      console.log("Using CCFI data from database for calculation.");
      ccfiCalcData = {
        current_index: parseFloat(result.rows[0].current_index),
        change:
          result.rows[0].change !== null
            ? parseFloat(result.rows[0].change)
            : 0,
        index_date: result.rows[0].index_date.toISOString().split("T")[0],
        source: "database",
      };
    }

    // 2. Если в базе нет или данные старые (старше 1 дня), пытаемся скрапить
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (!ccfiCalcData || new Date(ccfiCalcData.index_date) < yesterday) {
      console.log(
        "CCFI data in DB is missing or old, attempting to fetch fresh data..."
      );
      const fetchedDataArray = await fetchCCFIData(); // Эта функция уже сохраняет в базу

      // Ищем композитный индекс в полученных данных
      const compositeData = fetchedDataArray.find((d) =>
        d.route.toLowerCase().includes("composite")
      );

      if (compositeData) {
        console.log("Using freshly fetched CCFI data for calculation.");
        ccfiCalcData = {
          current_index: compositeData.currentIndex,
          change: compositeData.change,
          index_date: compositeData.indexDate,
          source: "live_fetch",
        };
      } else if (ccfiCalcData) {
        console.warn(
          "Failed to fetch fresh CCFI composite data, using stale data from DB."
        );
        // Используем старые данные из базы, если они есть
      } else {
        console.error(
          "Failed to fetch fresh CCFI data and no data in DB. Using mock data."
        );
        // Крайний случай - используем моковые данные (композитный индекс)
        const mock = await fetchMockCCFIData();
        const compositeMock = mock.find((d) =>
          d.route.toLowerCase().includes("composite")
        );
        if (compositeMock) {
          ccfiCalcData = {
            current_index: compositeMock.currentIndex,
            change: compositeMock.change,
            index_date: compositeMock.indexDate,
            source: "mock_fallback",
          };
        }
      }
    }

    // Нормализация данных перед возвратом
    if (ccfiCalcData) {
      return normalizeIndexData(ccfiCalcData);
    }

    return null; // Возвращаем null, если данные так и не получены
  } catch (error) {
    console.error("Error getting CCFI data for calculation:", error);
    // В случае серьезной ошибки, возвращаем моковые данные
    console.error("Returning mock CCFI data due to error.");
    const mock = await fetchMockCCFIData();
    const compositeMock = mock.find((d) =>
      d.route.toLowerCase().includes("composite")
    );
    if (compositeMock) {
      return normalizeIndexData({
        current_index: compositeMock.currentIndex,
        change: compositeMock.change,
        index_date: compositeMock.indexDate,
        source: "error_mock_fallback",
      });
    }
    return null;
  }
}

// Экспорт функций
module.exports = {
  fetchCCFIData,
  getCCFIDataForCalculation,
};




// Запуск скрапера, если файл выполняется напрямую (для тестирования)
if (require.main === module) {
  console.log("\n=== ЗАПУСК CCFI СКРАПЕРА НАПРЯМУЮ ДЛЯ ТЕСТИРОВАНИЯ ===");
  fetchCCFIData()
    .then(data => {
      console.log("\nCCFI Scraper executed successfully via direct run.");
      console.log(`Fetched ${data ? data.length : 0} records.`);
      // console.log("Fetched data:", data); // Можно раскомментировать для детального вывода данных
    })
    .catch(error => {
      console.error("\nCCFI Scraper failed during direct run:", error);
    })
    .finally(() => {
        console.log("\n=== ТЕСТИРОВАНИЕ CCFI СКРАПЕРА ЗАВЕРШЕНО ===");
        // Закрываем пул соединений, чтобы скрипт завершился корректно
        pool.end(() => console.log("Database pool closed."));
    });
}

