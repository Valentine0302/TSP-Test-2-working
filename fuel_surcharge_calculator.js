// Модуль расчета топливной надбавки для улучшения точности калькулятора фрахтовых ставок
// Рассчитывает топливную надбавку на основе текущих цен на топливо и расстояния между портами

const { Pool } = require('pg');
const axios = require('axios');
const cheerio = require('cheerio');
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

// URL для получения данных о ценах на бункерное топливо
const BUNKER_PRICE_URL = 'https://shipandbunker.com/prices/av/global/av-g20-global-20-ports-average';
// Альтернативный источник данных
const BUNKER_PRICE_ALT_URL = 'https://www.bunkerindex.com/prices/bixfree.php';

// Базовая цена на топливо в USD за тонну
const BASE_FUEL_PRICE = 400;

// Функция для инициализации таблиц для расчета топливной надбавки
async function initializeFuelSurchargeTables() {
  const client = await pool.connect();
  
  try {
    // Начало транзакции
    await client.query('BEGIN');
    
    // Создание таблицы цен на топливо, если она не существует
    await client.query(`
      CREATE TABLE IF NOT EXISTS fuel_prices (
        id SERIAL PRIMARY KEY,
        price NUMERIC NOT NULL,
        date DATE NOT NULL,
        fuel_type VARCHAR(50) NOT NULL,
        source VARCHAR(255),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(date, fuel_type)
      )
    `);
    
    // Создание таблицы расстояний между портами, если она не существует
    await client.query(`
      CREATE TABLE IF NOT EXISTS port_distances (
        id SERIAL PRIMARY KEY,
        origin_port_id INTEGER NOT NULL,
        destination_port_id INTEGER NOT NULL,
        distance NUMERIC NOT NULL,
        route_type VARCHAR(50) DEFAULT 'sea',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(origin_port_id, destination_port_id, route_type),
        FOREIGN KEY (origin_port_id) REFERENCES ports(id),
        FOREIGN KEY (destination_port_id) REFERENCES ports(id)
      )
    `);
    
    // Завершение транзакции
    await client.query('COMMIT');
    
    console.log('Fuel surcharge tables initialized');
  } catch (error) {
    // Откат транзакции в случае ошибки
    await client.query('ROLLBACK');
    console.error('Error initializing fuel surcharge tables:', error);
    throw error;
  } finally {
    // Освобождение клиента
    client.release();
  }
}

// Функция для получения текущих цен на бункерное топливо
async function fetchCurrentFuelPrices() {
  try {
    console.log('Fetching current bunker fuel prices...');
    
    // Попытка получить данные с основного источника
    let fuelPrices = await fetchFuelPricesFromPrimarySource();
    
    // Если не удалось получить данные с основного источника, используем альтернативный
    if (!fuelPrices || Object.keys(fuelPrices).length === 0) {
      fuelPrices = await fetchFuelPricesFromAlternativeSource();
    }
    
    // Если данные получены, сохраняем их в базу данных
    if (fuelPrices && Object.keys(fuelPrices).length > 0) {
      await saveFuelPrices(fuelPrices);
      return fuelPrices;
    } else {
      throw new Error('Failed to fetch fuel prices from all sources');
    }
  } catch (error) {
    console.error('Error fetching fuel prices:', error);
    // В случае ошибки возвращаем моковые данные
    return fetchMockFuelPrices();
  }
}

// Функция для получения цен на топливо с основного источника
async function fetchFuelPricesFromPrimarySource() {
  try {
    // Отправка запроса на сайт с ценами на бункерное топливо
    const response = await axios.get(BUNKER_PRICE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    // Проверка успешности запроса
    if (response.status !== 200) {
      throw new Error(`Failed to fetch fuel prices from primary source: ${response.status}`);
    }
    
    // Парсинг HTML-страницы
    const $ = cheerio.load(response.data);
    
    // Извлечение данных о ценах на различные типы топлива
    const fuelPrices = {};
    
    // Получение текущей даты
    const currentDate = new Date().toISOString().split('T')[0];
    
    // Поиск таблицы с ценами на топливо
    const priceTable = $('.price-table, table:contains("VLSFO"), table:contains("IFO380")');
    
    // Парсинг строк таблицы
    priceTable.find('tr').each((i, row) => {
      const columns = $(row).find('td');
      
      // Проверяем, что строка содержит нужное количество колонок
      if (columns.length >= 2) {
        const fuelType = $(columns[0]).text().trim();
        const priceText = $(columns[1]).text().trim();
        
        // Извлечение числового значения цены
        const priceMatch = priceText.match(/(\d+(\.\d+)?)/);
        const price = priceMatch ? parseFloat(priceMatch[1]) : null;
        
        // Добавление данных в объект, если тип топлива не пустой и цена является числом
        if (fuelType && price && !isNaN(price)) {
          fuelPrices[fuelType] = {
            price,
            date: currentDate,
            source: 'shipandbunker.com'
          };
        }
      }
    });
    
    // Если не удалось найти данные в таблице, ищем в тексте
    if (Object.keys(fuelPrices).length === 0) {
      // Поиск цены на VLSFO (Very Low Sulphur Fuel Oil)
      const vlsfoText = $('p:contains("VLSFO"), div:contains("VLSFO")').text();
      const vlsfoMatch = vlsfoText.match(/VLSFO.*?(\d+(\.\d+)?)/i);
      
      if (vlsfoMatch) {
        fuelPrices['VLSFO'] = {
          price: parseFloat(vlsfoMatch[1]),
          date: currentDate,
          source: 'shipandbunker.com'
        };
      }
      
      // Поиск цены на HSFO (High Sulphur Fuel Oil) или IFO380
      const hsfoText = $('p:contains("HSFO"), p:contains("IFO380"), div:contains("HSFO"), div:contains("IFO380")').text();
      const hsfoMatch = hsfoText.match(/(HSFO|IFO380).*?(\d+(\.\d+)?)/i);
      
      if (hsfoMatch) {
        fuelPrices['HSFO'] = {
          price: parseFloat(hsfoMatch[2]),
          date: currentDate,
          source: 'shipandbunker.com'
        };
      }
      
      // Поиск цены на MGO (Marine Gas Oil)
      const mgoText = $('p:contains("MGO"), div:contains("MGO")').text();
      const mgoMatch = mgoText.match(/MGO.*?(\d+(\.\d+)?)/i);
      
      if (mgoMatch) {
        fuelPrices['MGO'] = {
          price: parseFloat(mgoMatch[1]),
          date: currentDate,
          source: 'shipandbunker.com'
        };
      }
    }
    
    console.log(`Parsed fuel prices from primary source: ${Object.keys(fuelPrices).length} types`);
    
    return fuelPrices;
  } catch (error) {
    console.error('Error fetching fuel prices from primary source:', error);
    return {};
  }
}

// Функция для получения цен на топливо с альтернативного источника
async function fetchFuelPricesFromAlternativeSource() {
  try {
    // Отправка запроса на альтернативный сайт
    const response = await axios.get(BUNKER_PRICE_ALT_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    // Проверка успешности запроса
    if (response.status !== 200) {
      throw new Error(`Failed to fetch fuel prices from alternative source: ${response.status}`);
    }
    
    // Парсинг HTML-страницы
    const $ = cheerio.load(response.data);
    
    // Извлечение данных о ценах на различные типы топлива
    const fuelPrices = {};
    
    // Получение текущей даты
    const currentDate = new Date().toISOString().split('T')[0];
    
    // Поиск таблицы с ценами на топливо
    const priceTable = $('table:contains("380cst"), table:contains("VLSFO"), table:contains("MGO")');
    
    // Парсинг строк таблицы
    priceTable.find('tr').each((i, row) => {
      const columns = $(row).find('td');
      
      // Проверяем, что строка содержит нужное количество колонок
      if (columns.length >= 2) {
        let fuelType = $(columns[0]).text().trim();
        const priceText = $(columns[1]).text().trim();
        
        // Преобразование типов топлива к стандартным обозначениям
        if (fuelType.includes('380') || fuelType.includes('380cst')) {
          fuelType = 'HSFO';
        } else if (fuelType.includes('VLSFO') || fuelType.includes('0.5%')) {
          fuelType = 'VLSFO';
        } else if (fuelType.includes('MGO') || fuelType.includes('Gasoil')) {
          fuelType = 'MGO';
        }
        
        // Извлечение числового значения цены
        const priceMatch = priceText.match(/(\d+(\.\d+)?)/);
        const price = priceMatch ? parseFloat(priceMatch[1]) : null;
        
        // Добавление данных в объект, если тип топлива не пустой и цена является числом
        if (fuelType && price && !isNaN(price)) {
          fuelPrices[fuelType] = {
            price,
            date: currentDate,
            source: 'bunkerindex.com'
          };
        }
      }
    });
    
    console.log(`Parsed fuel prices from alternative source: ${Object.keys(fuelPrices).length} types`);
    
    return fuelPrices;
  } catch (error) {
    console.error('Error fetching fuel prices from alternative source:', error);
    return {};
  }
}

// Функция для получения моковых данных о ценах на топливо
async function fetchMockFuelPrices() {
  console.log('Using mock data for fuel prices');
  
  // Получение текущей даты
  const currentDate = new Date().toISOString().split('T')[0];
  
  // Создание моковых данных о ценах на топливо
  const mockPrices = {
    'VLSFO': {
      price: 550,
      date: currentDate,
      source: 'mock'
    },
    'HSFO': {
      price: 450,
      date: currentDate,
      source: 'mock'
    },
    'MGO': {
      price: 650,
      date: currentDate,
      source: 'mock'
    }
  };
  
  // Сохранение моковых данных в базу данных
  await saveFuelPrices(mockPrices);
  
  return mockPrices;
}

// Функция для сохранения цен на топливо в базу данных
async function saveFuelPrices(fuelPrices) {
  const client = await pool.connect();
  
  try {
    // Начало транзакции
    await client.query('BEGIN');
    
    // Вставка данных о ценах на топливо
    for (const fuelType in fuelPrices) {
      const { price, date, source } = fuelPrices[fuelType];
      
      await client.query(
        `INSERT INTO fuel_prices 
         (price, date, fuel_type, source) 
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (date, fuel_type) 
         DO UPDATE SET 
           price = $1,
           source = $4`,
        [
          price,
          date,
          fuelType,
          source
        ]
      );
    }
    
    // Завершение транзакции
    await client.query('COMMIT');
    
    console.log(`Saved ${Object.keys(fuelPrices).length} fuel prices to database`);
  } catch (error) {
    // Откат транзакции в случае ошибки
    await client.query('ROLLBACK');
    console.error('Error saving fuel prices to database:', error);
    throw error;
  } finally {
    // Освобождение клиента
    client.release();
  }
}

// Функция для получения текущей цены на топливо
async function getCurrentFuelPrice(fuelType = 'VLSFO') {
  try {
    // Запрос последней цены на указанный тип топлива
    const query = `
      SELECT price, date FROM fuel_prices 
      WHERE fuel_type = $1 
      ORDER BY date DESC 
      LIMIT 1
    `;
    
    const result = await pool.query(query, [fuelType]);
    
    // Если цена найдена, возвращаем ее
    if (result.rows.length > 0) {
      return {
        price: parseFloat(result.rows[0].price),
        date: result.rows[0].date
      };
    }
    
    // Если цена не найдена, получаем актуальные данные
    const fuelPrices = await fetchCurrentFuelPrices();
    
    // Если удалось получить цену для указанного типа топлива, возвращаем ее
    if (fuelPrices[fuelType]) {
      return {
        price: fuelPrices[fuelType].price,
        date: fuelPrices[fuelType].date
      };
    }
    
    // Если не удалось получить цену, возвращаем значение по умолчанию
    return {
      price: fuelType === 'VLSFO' ? 550 : 
             fuelType === 'HSFO' ? 450 : 
             fuelType === 'MGO' ? 650 : 550,
      date: new Date().toISOString().split('T')[0]
    };
  } catch (error) {
    console.error('Error getting current fuel price:', error);
    // В случае ошибки возвращаем значение по умолчанию
    return {
      price: fuelType === 'VLSFO' ? 550 : 
             fuelType === 'HSFO' ? 450 : 
             fuelType === 'MGO' ? 650 : 550,
      date: new Date().toISOString().split('T')[0]
    };
  }
}

// Функция для инициализации таблицы расстояний между портами
async function initializePortDistances() {
  const client = await pool.connect();
  
  try {
    console.log('Initializing port distances');
    
    // Начало транзакции
    await client.query('BEGIN');
    
    // Проверка, есть ли уже данные в таблице
    const checkResult = await client.query('SELECT COUNT(*) FROM port_distances');
    
    // Если таблица пуста, заполняем ее приблизительными расстояниями
    if (parseInt(checkResult.rows[0].count) === 0) {
      console.log('Generating approximate port distances');
      
      // Получение списка всех портов
      const portsResult = await client.query('SELECT id, name, latitude, longitude FROM ports');
      const ports = portsResult.rows;
      
      // Для каждой пары портов рассчитываем приблизительное расстояние
      for (let i = 0; i < ports.length; i++) {
        for (let j = i + 1; j < ports.length; j++) {
          const originPort = ports[i];
          const destinationPort = ports[j];
          
          // Расчет расстояния по координатам
          const distance = calculateDistance(
            originPort.latitude, originPort.longitude,
            destinationPort.latitude, destinationPort.longitude
          );
          
          // Вставка расстояния в обоих направлениях
          await client.query(
            `INSERT INTO port_distances 
             (origin_port_id, destination_port_id, distance, route_type) 
             VALUES ($1, $2, $3, 'sea')
             ON CONFLICT (origin_port_id, destination_port_id, route_type) 
             DO NOTHING`,
            [
              originPort.id,
              destinationPort.id,
              distance
            ]
          );
          
          await client.query(
            `INSERT INTO port_distances 
             (origin_port_id, destination_port_id, distance, route_type) 
             VALUES ($1, $2, $3, 'sea')
             ON CONFLICT (origin_port_id, destination_port_id, route_type) 
             DO NOTHING`,
            [
              destinationPort.id,
              originPort.id,
              distance
            ]
          );
        }
      }
    }
    
    // Завершение транзакции
    await client.query('COMMIT');
    
    console.log('Port distances initialization completed');
  } catch (error) {
    // Откат транзакции в случае ошибки
    await client.query('ROLLBACK');
    console.error('Error initializing port distances:', error);
    throw error;
  } finally {
    // Освобождение клиента
    client.release();
  }
}

// Функция для расчета расстояния между портами по координатам
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Радиус Земли в км
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c;
  
  // Учитываем, что морской путь обычно длиннее прямой линии
  return Math.round(distance * 1.4);
}

// Вспомогательная функция для перевода градусов в радианы
function deg2rad(deg) {
  return deg * (Math.PI/180);
}

// Функция для получения расстояния между портами
async function getPortDistance(originPortId, destinationPortId) {
  try {
    // Запрос расстояния из базы данных
    const query = `
      SELECT distance FROM port_distances 
      WHERE origin_port_id = $1 AND destination_port_id = $2
    `;
    
    const result = await pool.query(query, [originPortId, destinationPortId]);
    
    // Если расстояние найдено, возвращаем его
    if (result.rows.length > 0) {
      return parseFloat(result.rows[0].distance);
    }
    
    // Если расстояние не найдено, получаем координаты портов и рассчитываем расстояние
    const portsQuery = `
      SELECT id, latitude, longitude FROM ports 
      WHERE id IN ($1, $2)
    `;
    
    const portsResult = await pool.query(portsQuery, [originPortId, destinationPortId]);
    
    if (portsResult.rows.length === 2) {
      const originPort = portsResult.rows.find(port => port.id === originPortId);
      const destinationPort = portsResult.rows.find(port => port.id === destinationPortId);
      
      // Расчет расстояния по координатам
      const distance = calculateDistance(
        originPort.latitude, originPort.longitude,
        destinationPort.latitude, destinationPort.longitude
      );
      
      // Сохранение расстояния в базу данных
      await pool.query(
        `INSERT INTO port_distances 
         (origin_port_id, destination_port_id, distance, route_type) 
         VALUES ($1, $2, $3, 'sea')
         ON CONFLICT (origin_port_id, destination_port_id, route_type) 
         DO NOTHING`,
        [
          originPortId,
          destinationPortId,
          distance
        ]
      );
      
      return distance;
    }
    
    // Если не удалось получить координаты портов, возвращаем приблизительное значение
    return 10000; // Приблизительное значение по умолчанию
  } catch (error) {
    console.error('Error getting port distance:', error);
    // В случае ошибки возвращаем приблизительное значение
    return 10000;
  }
}

// Функция для расчета топливной надбавки
async function calculateFuelSurcharge(originPortId, destinationPortId, containerType, fuelType = 'VLSFO') {
  try {
    console.log(`Calculating fuel surcharge for route ${originPortId} to ${destinationPortId}, container type: ${containerType}`);
    
    // Получение текущей цены на топливо
    const { price: currentFuelPrice } = await getCurrentFuelPrice(fuelType);
    
    // Получение расстояния между портами
    const distance = await getPortDistance(originPortId, destinationPortId);
    
    // Коэффициент для расчета надбавки в зависимости от типа контейнера
    const containerFactor = containerType === '40HC' ? 1.2 : 
                           containerType === '40DC' ? 1.0 : 
                           containerType === '20DC' ? 0.6 : 1.0;
    
    // Расчет топливной надбавки
    // Формула: (текущая цена - базовая цена) * коэффициент * (расстояние / 1000)
    const fuelDifference = Math.max(0, currentFuelPrice - BASE_FUEL_PRICE);
    const surcharge = fuelDifference * containerFactor * (distance / 1000) * 0.15;
    
    // Округление до целого числа
    const roundedSurcharge = Math.round(surcharge);
    
    console.log(`Calculated fuel surcharge: ${roundedSurcharge} USD`);
    
    return {
      surcharge: roundedSurcharge,
      fuelPrice: currentFuelPrice,
      baseFuelPrice: BASE_FUEL_PRICE,
      distance,
      containerFactor
    };
  } catch (error) {
    console.error('Error calculating fuel surcharge:', error);
    // В случае ошибки возвращаем приблизительную надбавку
    return {
      surcharge: containerType === '40HC' ? 300 : 
                containerType === '40DC' ? 250 : 
                containerType === '20DC' ? 150 : 250,
      fuelPrice: 550,
      baseFuelPrice: BASE_FUEL_PRICE,
      distance: 10000,
      containerFactor: containerType === '40HC' ? 1.2 : 
                      containerType === '40DC' ? 1.0 : 
                      containerType === '20DC' ? 0.6 : 1.0
    };
  }
}

// Функция для получения истории цен на топливо
async function getFuelPriceHistory(fuelType = 'VLSFO', months = 12) {
  try {
    const query = `
      SELECT price, date FROM fuel_prices 
      WHERE fuel_type = $1 
      AND date >= NOW() - INTERVAL '${months} months'
      ORDER BY date
    `;
    
    const result = await pool.query(query, [fuelType]);
    
    return result.rows;
  } catch (error) {
    console.error('Error getting fuel price history:', error);
    throw error;
  }
}

// Функция для инициализации и обновления всех данных для расчета топливной надбавки
async function initializeAndUpdateFuelSurchargeData() {
  try {
    console.log('Initializing and updating fuel surcharge data');
    
    // Инициализация таблиц
    await initializeFuelSurchargeTables();
    
    // Получение текущих цен на топливо
    await fetchCurrentFuelPrices();
    
    // Инициализация таблицы расстояний между портами
    await initializePortDistances();
    
    console.log('Fuel surcharge data initialization and update completed');
  } catch (error) {
    console.error('Error initializing and updating fuel surcharge data:', error);
    throw error;
  }
}

// Экспорт функций
module.exports = {
  initializeAndUpdateFuelSurchargeData,
  calculateFuelSurcharge,
  getCurrentFuelPrice,
  getFuelPriceHistory,
  getPortDistance
};
