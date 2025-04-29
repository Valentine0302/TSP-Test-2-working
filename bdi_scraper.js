// Модуль для сбора данных из Baltic Dry Index (BDI)
// Использует публично доступные данные индекса BDI

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

// URL для получения данных BDI - ИСПРАВЛЕННЫЙ URL
const BDI_URL = 'https://tradingeconomics.com/commodity/baltic'; // Был: 'https://www.balticexchange.com/en/data-services/market-information/dry-index.html' (404)
// Альтернативный источник данных - ИСПРАВЛЕННЫЙ URL
const BDI_ALT_URL = 'https://tradingeconomics.com/commodity/baltic'; // Был: 'https://tradingeconomics.com/commodity/baltic-dry' (нет данных)
// Убрали нерабочий основной источник и дублирующийся альтернативный

// Функция для получения данных BDI
async function fetchBDIData() {
  try {
    console.log('Fetching Baltic Dry Index data...');

    // Попытка получить данные с единственного рабочего источника (Trading Economics)
    let bdiData = await fetchBDIFromTradingEconomics();

    // Если данные получены, сохраняем их в базу данных
    if (bdiData && bdiData.length > 0) {
      await saveBDIData(bdiData);
      return bdiData;
    } else {
      throw new Error('Failed to fetch BDI data from Trading Economics');
    }
  } catch (error) {
    console.error('Error fetching BDI data:', error);
    // В случае ошибки возвращаем моковые данные
    return fetchMockBDIData();
  }
}

// Функция для получения данных BDI с Trading Economics
async function fetchBDIFromTradingEconomics() {
  try {
    // Отправка запроса на сайт Trading Economics
    const response = await axios.get(BDI_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    // Проверка успешности запроса
    if (response.status !== 200) {
      throw new Error(`Failed to fetch BDI data from Trading Economics: ${response.status}`);
    }

    // Парсинг HTML-страницы
    const $ = cheerio.load(response.data);

    // Извлечение данных
    const bdiData = [];

    // Получение текущей даты (или даты с сайта, если доступна)
    let indexDateStr = $('[data-symbol="BDI:IND"] td:last-child').text().trim(); // Попытка найти дату в таблице
    let currentDate;
    if (indexDateStr) {
        // Пример формата: Apr/28. Нужно преобразовать в YYYY-MM-DD
        const parts = indexDateStr.split('/');
        const currentYear = new Date().getFullYear();
        // TODO: Уточнить парсинг даты, если формат другой
        // Пока используем текущую дату как fallback
        try {
            const monthMap = { 'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12' };
            const month = monthMap[parts[0]];
            const day = parts[1].padStart(2, '0');
            if (month && day) {
                currentDate = `${currentYear}-${month}-${day}`;
            } else {
                 currentDate = new Date().toISOString().split('T')[0];
            }
        } catch (dateError) {
            console.warn('Could not parse date from Trading Economics, using current date.', dateError);
            currentDate = new Date().toISOString().split('T')[0];
        }
    } else {
        currentDate = new Date().toISOString().split('T')[0];
    }


    // Поиск значения BDI и изменения на странице
    // Селекторы основаны на структуре Trading Economics на момент написания
    const bdiValueStr = $('#aspnetForm > div.container > div > div > div.col-lg-8.col-md-9 > div:nth-child(6) > div > table > tbody > tr:nth-child(1) > td:nth-child(2)').text().trim();
    // Альтернативный селектор, если первый не сработает
    // const bdiValueStr = $('td#p').text().trim();
    const bdiChangeStr = $('#aspnetForm > div.container > div > div > div.col-lg-8.col-md-9 > div:nth-child(6) > div > table > tbody > tr:nth-child(1) > td:nth-child(3)').text().trim();
    // const bdiChangeStr = $('td#pch').text().trim();

    console.log(`Raw BDI Value String: '${bdiValueStr}'`);
    console.log(`Raw BDI Change String: '${bdiChangeStr}'`);

    // Извлечение числового значения индекса
    const currentIndex = parseFloat(bdiValueStr.replace(/,/g, ''));

    // Извлечение числового значения изменения
    const change = parseFloat(bdiChangeStr.replace(/,/g, ''));

    console.log(`Parsed BDI Value: ${currentIndex}`);
    console.log(`Parsed BDI Change: ${change}`);

    // Добавление данных в массив, если индекс является числом
    if (!isNaN(currentIndex)) {
      bdiData.push({
        route: 'Baltic Dry Index (BDI)',
        currentIndex,
        change: isNaN(change) ? 0 : change, // Если изменение не парсится, ставим 0
        indexDate: currentDate
      });
    } else {
        console.error('Could not parse BDI value from Trading Economics.');
    }

    console.log(`Parsed BDI data from Trading Economics: ${bdiData.length} records`);

    return bdiData;
  } catch (error) {
    console.error('Error fetching BDI data from Trading Economics:', error);
    return [];
  }
}

// Функция для получения моковых данных BDI
async function fetchMockBDIData() {
  console.log('Using mock data for BDI');

  // Получение текущей даты
  const currentDate = new Date().toISOString().split('T')[0];

  // Создание моковых данных на основе реальных значений BDI
  const mockData = [
    {
      route: 'Baltic Dry Index (BDI)',
      currentIndex: 1403, // Значение на 2025-04-29
      change: 30,     // Значение на 2025-04-29
      indexDate: currentDate
    }
  ];

  // Сохранение моковых данных в базу данных (опционально, можно убрать для моков)
  // await saveBDIData(mockData);

  return mockData;
}

// Функция для сохранения данных BDI в базу данных
async function saveBDIData(bdiData) {
  const client = await pool.connect();

  try {
    // Начало транзакции
    await client.query('BEGIN');

    // Создание таблицы, если она не существует
    await client.query(`
      CREATE TABLE IF NOT EXISTS freight_indices_bdi (
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
    for (const data of bdiData) {
      // Проверка, что данные валидны перед вставкой
      if (data.route && !isNaN(data.currentIndex) && data.indexDate) {
        await client.query(
          `INSERT INTO freight_indices_bdi
           (route, current_index, change, index_date)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (route, index_date)
           DO UPDATE SET
             current_index = EXCLUDED.current_index,
             change = EXCLUDED.change`,
          [
            data.route,
            data.currentIndex,
            isNaN(data.change) ? null : data.change, // Сохраняем null, если изменение не число
            data.indexDate
          ]
        );
      } else {
        console.warn('Skipping invalid BDI data record:', data);
      }
    }

    // Завершение транзакции
    await client.query('COMMIT');

    console.log(`Saved ${bdiData.length} valid BDI records to database`);
  } catch (error) {
    // Откат транзакции в случае ошибки
    await client.query('ROLLBACK');
    console.error('Error saving BDI data to database:', error);
    throw error;
  } finally {
    // Освобождение клиента
    client.release();
  }
}

// Функция для получения данных BDI для расчета ставок
// Возвращает объект { current_index, change, index_date } или null
async function getBDIDataForCalculation() {
  let bdiCalcData = null;
  try {
    // 1. Попытка получить последние данные BDI из базы данных
    const query = `
      SELECT current_index, change, index_date
      FROM freight_indices_bdi
      ORDER BY index_date DESC
      LIMIT 1
    `;
    const result = await pool.query(query);

    if (result.rows.length > 0) {
        console.log('Using BDI data from database for calculation.');
        bdiCalcData = {
            current_index: parseFloat(result.rows[0].current_index),
            change: result.rows[0].change ? parseFloat(result.rows[0].change) : 0,
            index_date: result.rows[0].index_date.toISOString().split('T')[0],
            source: 'database'
        };
    }

    // 2. Если в базе нет или данные старые (старше 1 дня), пытаемся скрапить
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (!bdiCalcData || new Date(bdiCalcData.index_date) < yesterday) {
        console.log('BDI data in DB is missing or old, attempting to fetch fresh data...');
        const fetchedData = await fetchBDIData(); // Эта функция уже сохраняет в базу
        if (fetchedData && fetchedData.length > 0) {
            console.log('Using freshly fetched BDI data for calculation.');
            const latestData = fetchedData[0]; // fetchBDIData возвращает массив
            bdiCalcData = {
                current_index: latestData.currentIndex,
                change: latestData.change,
                index_date: latestData.indexDate,
                source: 'live_fetch'
            };
        } else if (bdiCalcData) {
            console.warn('Failed to fetch fresh BDI data, using stale data from DB.');
            // Используем старые данные из базы, если они есть
        } else {
            console.error('Failed to fetch fresh BDI data and no data in DB. Using mock data.');
            // Крайний случай - используем моковые данные
            const mock = await fetchMockBDIData();
            const latestMock = mock[0];
             bdiCalcData = {
                current_index: latestMock.currentIndex,
                change: latestMock.change,
                index_date: latestMock.indexDate,
                source: 'mock_fallback'
            };
        }
    }

    return bdiCalcData;

  } catch (error) {
    console.error('Error getting BDI data for calculation:', error);
    // В случае серьезной ошибки, возвращаем моковые данные
     console.error('Returning mock BDI data due to error.');
     const mock = await fetchMockBDIData();
     const latestMock = mock[0];
     return {
        current_index: latestMock.currentIndex,
        change: latestMock.change,
        index_date: latestMock.indexDate,
        source: 'error_mock_fallback'
    };
  }
}

// Экспорт функций
module.exports = {
  fetchBDIData,
  getBDIDataForCalculation
};

