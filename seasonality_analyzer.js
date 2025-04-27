// Модуль для анализа сезонности ставок фрахта
// Создает и анализирует базу исторических данных для выявления сезонных паттернов

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

// Функция для инициализации таблиц для анализа сезонности
async function initializeSeasonalityTables() {
  const client = await pool.connect();
  
  try {
    // Начало транзакции
    await client.query('BEGIN');
    
    // Удаление проблемных таблиц, если они существуют
    await client.query('DROP TABLE IF EXISTS historical_rates CASCADE');
    await client.query('DROP TABLE IF EXISTS seasonality_factors CASCADE');
    
    // Создание таблицы для хранения исторических данных о ставках
    await client.query(`
      CREATE TABLE IF NOT EXISTS historical_rates (
        id SERIAL PRIMARY KEY,
        origin_port VARCHAR(10) NOT NULL,
        destination_port VARCHAR(10) NOT NULL,
        origin_region VARCHAR(50),
        destination_region VARCHAR(50),
        container_type VARCHAR(10) NOT NULL,
        rate NUMERIC NOT NULL,
        date DATE NOT NULL,
        source VARCHAR(50),
        UNIQUE(origin_port, destination_port, container_type, date, source)
      )
    `);
    
    // Создание таблицы для хранения коэффициентов сезонности
    await client.query(`
      CREATE TABLE IF NOT EXISTS seasonality_factors (
        id SERIAL PRIMARY KEY,
        origin_region VARCHAR(50) NOT NULL,
        destination_region VARCHAR(50) NOT NULL,
        month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
        seasonality_factor NUMERIC NOT NULL,
        confidence NUMERIC NOT NULL,
        last_updated TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(origin_region, destination_region, month)
      )
    `);
    
    // Создание таблицы для хранения цен на топливо
    await client.query(`
      CREATE TABLE IF NOT EXISTS fuel_prices (
        id SERIAL PRIMARY KEY,
        price NUMERIC NOT NULL,
        date DATE NOT NULL,
        source VARCHAR(50),
        UNIQUE(date, source)
      )
    `);
    
    // Создание таблицы для хранения расстояний между портами
    await client.query(`
      CREATE TABLE IF NOT EXISTS port_distances (
        id SERIAL PRIMARY KEY,
        origin_port VARCHAR(10) NOT NULL,
        destination_port VARCHAR(10) NOT NULL,
        distance NUMERIC NOT NULL,
        UNIQUE(origin_port, destination_port)
      )
    `);
    
    // Завершение транзакции
    await client.query('COMMIT');
    
    console.log('Seasonality tables initialized successfully');
  } catch (error) {
    // Откат транзакции в случае ошибки
    await client.query('ROLLBACK');
    console.error('Error initializing seasonality tables:', error);
    // Не пробрасываем ошибку дальше, чтобы не прерывать инициализацию
    console.log('Continuing initialization despite error in table creation');
  } finally {
    // Освобождение клиента
    client.release();
  }
}

// Функция для импорта исторических данных о ставках
async function importHistoricalRates() {
  try {
    console.log('Importing historical rates data...');
    
    // Проверка наличия данных в таблице
    const countQuery = 'SELECT COUNT(*) FROM historical_rates';
    const countResult = await pool.query(countQuery);
    
    if (parseInt(countResult.rows[0].count) > 0) {
      console.log('Historical rates data already exists');
      return;
    }
    
    // Импорт данных из таблицы calculation_history
    await importHistoricalDataFromCalculationHistory();
    
    // Проверка, достаточно ли данных для анализа
    const checkQuery = 'SELECT COUNT(*) FROM historical_rates';
    const checkResult = await pool.query(checkQuery);
    
    if (parseInt(checkResult.rows[0].count) < 100) {
      console.log('Not enough historical data, generating synthetic data...');
      await generateSyntheticHistoricalData();
    }
  } catch (error) {
    console.error('Error importing historical rates:', error);
    // Не пробрасываем ошибку дальше, чтобы не прерывать инициализацию
    console.log('Continuing initialization despite error in historical rates import');
  }
}

// Функция для импорта исторических данных из таблицы calculation_history
async function importHistoricalDataFromCalculationHistory() {
  const client = await pool.connect();
  
  try {
    console.log('Importing historical data from calculation_history');
    
    // Проверка существования таблицы calculation_history
    const tableCheckQuery = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'calculation_history'
      )
    `;
    
    const tableExists = await client.query(tableCheckQuery);
    if (!tableExists.rows[0].exists) {
      console.log('Table calculation_history does not exist, skipping import');
      return;
    }
    
    // Проверка структуры таблицы calculation_history
    const columnsCheckQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'calculation_history'
    `;
    
    const columnsResult = await client.query(columnsCheckQuery);
    const columns = columnsResult.rows.map(row => row.column_name);
    
    // Проверка наличия необходимых колонок
    const hasOriginPort = columns.includes('origin_port');
    const hasDestinationPort = columns.includes('destination_port');
    const hasOriginPortId = columns.includes('origin_port_id');
    const hasDestinationPortId = columns.includes('destination_port_id');
    
    if ((!hasOriginPort && !hasOriginPortId) || (!hasDestinationPort && !hasDestinationPortId)) {
      console.log('Table calculation_history does not have required columns, skipping import');
      return;
    }
    
    // Начало транзакции
    await client.query('BEGIN');
    
    // Формирование запроса в зависимости от доступных колонок
    let historyQuery;
    if (hasOriginPortId && hasDestinationPortId) {
      historyQuery = `
        SELECT 
          origin_port_id as origin_port, 
          destination_port_id as destination_port, 
          container_type, 
          rate, 
          created_at,
          sources
        FROM calculation_history
        ORDER BY created_at
      `;
    } else {
      historyQuery = `
        SELECT 
          origin_port, 
          destination_port, 
          container_type, 
          rate, 
          created_at,
          sources
        FROM calculation_history
        ORDER BY created_at
      `;
    }
    
    const historyResult = await client.query(historyQuery);
    
    // Получение регионов для портов
    const portsQuery = 'SELECT id, region FROM ports';
    const portsResult = await client.query(portsQuery);
    
    // Создание карты портов и их регионов
    const portRegions = {};
    for (const port of portsResult.rows) {
      portRegions[port.id] = port.region;
    }
    
    // Импорт данных в таблицу historical_rates
    for (const record of historyResult.rows) {
      // Определение регионов портов
      const originRegion = portRegions[record.origin_port] || 'Unknown';
      const destinationRegion = portRegions[record.destination_port] || 'Unknown';
      
      // Преобразование даты
      const date = new Date(record.created_at).toISOString().split('T')[0];
      
      // Определение источника данных
      const source = record.sources ? JSON.parse(record.sources)[0] || 'unknown' : 'unknown';
      
      // Вставка данных в таблицу historical_rates
      await client.query(
        `INSERT INTO historical_rates 
         (origin_port, destination_port, origin_region, destination_region, container_type, rate, date, source) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (origin_port, destination_port, container_type, date, source) 
         DO NOTHING`,
        [
          record.origin_port,
          record.destination_port,
          originRegion,
          destinationRegion,
          record.container_type,
          record.rate,
          date,
          source
        ]
      );
    }
    
    // Завершение транзакции
    await client.query('COMMIT');
    
    console.log(`Imported ${historyResult.rows.length} historical rates from calculation_history`);
  } catch (error) {
    // Откат транзакции в случае ошибки
    await client.query('ROLLBACK');
    console.error('Error importing historical rates from calculation_history:', error);
    // Не пробрасываем ошибку дальше, чтобы не прерывать инициализацию
    console.log('Continuing initialization despite error in historical data import');
  } finally {
    // Освобождение клиента
    client.release();
  }
}

// Функция для генерации синтетических исторических данных
async function generateSyntheticHistoricalData() {
  const client = await pool.connect();
  
  try {
    console.log('Generating synthetic historical data...');
    
    // Начало транзакции
    await client.query('BEGIN');
    
    // Получение списка портов
    const portsQuery = 'SELECT id, name, region FROM ports';
    const portsResult = await client.query(portsQuery);
    
    if (portsResult.rows.length === 0) {
      console.log('No ports found, cannot generate synthetic data');
      return;
    }
    
    // Получение списка типов контейнеров
    const containerTypesQuery = 'SELECT id FROM container_types';
    const containerTypesResult = await client.query(containerTypesQuery);
    
    if (containerTypesResult.rows.length === 0) {
      console.log('No container types found, cannot generate synthetic data');
      return;
    }
    
    // Создание массивов портов и типов контейнеров
    const ports = portsResult.rows;
    const containerTypes = containerTypesResult.rows.map(row => row.id);
    
    // Определение временного диапазона (последние 3 года)
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setFullYear(endDate.getFullYear() - 3);
    
    // Массив для хранения сгенерированных данных
    const syntheticData = [];
    
    // Генерация данных для каждой пары портов и типа контейнера
    for (let i = 0; i < ports.length; i++) {
      for (let j = 0; j < ports.length; j++) {
        // Пропуск, если порты совпадают
        if (i === j) continue;
        
        const originPort = ports[i];
        const destinationPort = ports[j];
        
        for (const containerType of containerTypes) {
          // Базовая ставка для пары портов (зависит от расстояния)
          const baseRate = 500 + Math.random() * 1500;
          
          // Генерация данных для каждого месяца в диапазоне
          let currentDate = new Date(startDate);
          
          while (currentDate <= endDate) {
            // Расчет сезонного коэффициента
            const month = currentDate.getMonth() + 1;
            const seasonalFactor = getSeasonalFactorForMonth(month);
            
            // Расчет годового тренда (рост ставок со временем)
            const yearsSinceStart = (currentDate - startDate) / (365 * 24 * 60 * 60 * 1000);
            const trendFactor = 1 + yearsSinceStart * 0.1; // 10% рост в год
            
            // Добавление случайной вариации
            const randomFactor = 0.9 + Math.random() * 0.2; // ±10% случайная вариация
            
            // Расчет итоговой ставки
            const rate = Math.round(baseRate * seasonalFactor * trendFactor * randomFactor);
            
            // Форматирование даты
            const date = currentDate.toISOString().split('T')[0];
            
            // Добавление данных в массив
            syntheticData.push({
              origin_port: originPort.id,
              destination_port: destinationPort.id,
              origin_region: originPort.region,
              destination_region: destinationPort.region,
              container_type: containerType,
              rate,
              date,
              source: 'synthetic'
            });
            
            // Переход к следующему месяцу
            currentDate.setMonth(currentDate.getMonth() + 1);
          }
        }
      }
    }
    
    // Ограничение количества записей (случайная выборка)
    const maxRecords = 10000;
    if (syntheticData.length > maxRecords) {
      syntheticData.sort(() => Math.random() - 0.5);
      syntheticData.length = maxRecords;
    }
    
    // Сохранение сгенерированных данных в базу данных
    for (const data of syntheticData) {
      // Вставка данных в таблицу historical_rates
      await client.query(
        `INSERT INTO historical_rates 
         (origin_port, destination_port, origin_region, destination_region, container_type, rate, date, source) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (origin_port, destination_port, container_type, date, source) 
         DO NOTHING`,
        [
          data.origin_port,
          data.destination_port,
          data.origin_region,
          data.destination_region,
          data.container_type,
          data.rate,
          data.date,
          data.source
        ]
      );
    }
    
    // Завершение транзакции
    await client.query('COMMIT');
    
    console.log(`Generated and saved ${syntheticData.length} synthetic historical rates`);
  } catch (error) {
    // Откат транзакции в случае ошибки
    await client.query('ROLLBACK');
    console.error('Error generating synthetic historical data:', error);
    // Не пробрасываем ошибку дальше, чтобы не прерывать инициализацию
    console.log('Continuing initialization despite error in synthetic data generation');
  } finally {
    // Освобождение клиента
    client.release();
  }
}

// Функция для получения сезонного коэффициента для месяца
function getSeasonalFactorForMonth(month) {
  // Сезонные коэффициенты по месяцам
  const seasonalFactors = {
    1: 1.05,  // Январь
    2: 1.00,  // Февраль
    3: 0.95,  // Март
    4: 0.90,  // Апрель
    5: 0.95,  // Май
    6: 1.00,  // Июнь
    7: 1.05,  // Июль
    8: 1.10,  // Август
    9: 1.15,  // Сентябрь
    10: 1.10, // Октябрь
    11: 1.05, // Ноябрь
    12: 1.00  // Декабрь
  };
  
  return seasonalFactors[month] || 1.0;
}

// Функция для анализа сезонности ставок
async function analyzeSeasonality() {
  const client = await pool.connect();
  
  try {
    console.log('Analyzing seasonality patterns...');
    
    // Получение уникальных пар регионов из исторических данных
    const regionsQuery = `
      SELECT DISTINCT origin_region, destination_region 
      FROM historical_rates 
      WHERE origin_region IS NOT NULL 
        AND destination_region IS NOT NULL
    `;
    
    const regionsResult = await client.query(regionsQuery);
    
    if (regionsResult.rows.length === 0) {
      console.log('No region pairs found in historical data');
      return;
    }
    
    // Анализ сезонности для каждой пары регионов
    for (const regionPair of regionsResult.rows) {
      const originRegion = regionPair.origin_region;
      const destinationRegion = regionPair.destination_region;
      
      try {
        // Анализ сезонности для каждого месяца
        for (let month = 1; month <= 12; month++) {
          try {
            // Получение данных для текущего месяца
            const monthQuery = `
              SELECT rate 
              FROM historical_rates 
              WHERE origin_region = $1 
                AND destination_region = $2 
                AND EXTRACT(MONTH FROM date) = $3
            `;
            
            const monthResult = await client.query(monthQuery, [originRegion, destinationRegion, month]);
            
            if (monthResult.rows.length === 0) {
              console.log(`No data for ${originRegion} → ${destinationRegion} in month ${month}`);
              continue;
            }
            
            // Получение данных для всех месяцев
            const allMonthsQuery = `
              SELECT rate 
              FROM historical_rates 
              WHERE origin_region = $1 
                AND destination_region = $2
            `;
            
            const allMonthsResult = await client.query(allMonthsQuery, [originRegion, destinationRegion]);
            
            if (allMonthsResult.rows.length === 0) {
              console.log(`No data for ${originRegion} → ${destinationRegion}`);
              continue;
            }
            
            // Расчет средней ставки для текущего месяца
            const monthRates = monthResult.rows.map(row => parseFloat(row.rate));
            const monthAvg = monthRates.reduce((sum, rate) => sum + rate, 0) / monthRates.length;
            
            // Расчет средней ставки для всех месяцев
            const allRates = allMonthsResult.rows.map(row => parseFloat(row.rate));
            const allAvg = allRates.reduce((sum, rate) => sum + rate, 0) / allRates.length;
            
            // Расчет коэффициента сезонности
            const seasonalityFactor = monthAvg / allAvg;
            
            // Расчет надежности на основе количества данных
            const confidence = Math.min(1.0, monthRates.length / 100);
            
            // Сохранение коэффициента сезонности в базу данных
            await saveSeasonalityFactor(originRegion, destinationRegion, month, seasonalityFactor, confidence);
          } catch (error) {
            console.error(`Error analyzing seasonality for ${originRegion} → ${destinationRegion}, month ${month}:`, error);
            // Продолжаем анализ для других месяцев
          }
        }
      } catch (error) {
        console.error(`Error analyzing seasonality for ${originRegion} → ${destinationRegion}:`, error);
        // Продолжаем анализ для других пар регионов
      }
    }
    
    console.log('Seasonality analysis completed');
  } catch (error) {
    console.error('Error analyzing seasonality:', error);
    // Не пробрасываем ошибку дальше, чтобы не прерывать инициализацию
    console.log('Continuing initialization despite error in seasonality analysis');
  } finally {
    // Освобождение клиента
    client.release();
  }
}

// Функция для сохранения коэффициента сезонности в базу данных
async function saveSeasonalityFactor(originRegion, destinationRegion, month, seasonalityFactor, confidence) {
  try {
    console.log(`Saving seasonality factor for ${originRegion} → ${destinationRegion}, month ${month}`);
    
    // Округление коэффициента до двух знаков после запятой
    const roundedFactor = Math.round(seasonalityFactor * 100) / 100;
    
    // Вставка или обновление коэффициента в базе данных
    const query = `
      INSERT INTO seasonality_factors 
      (origin_region, destination_region, month, seasonality_factor, confidence, last_updated) 
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (origin_region, destination_region, month) 
      DO UPDATE SET 
        seasonality_factor = $4,
        confidence = $5,
        last_updated = NOW()
    `;
    
    await pool.query(query, [
      originRegion,
      destinationRegion,
      month,
      roundedFactor,
      confidence
    ]);
    
    console.log(`Seasonality factor saved for ${originRegion} → ${destinationRegion}, month ${month}`);
  } catch (error) {
    console.error(`Error saving seasonality factor for ${originRegion} → ${destinationRegion}, month ${month}:`, error);
    // Не пробрасываем ошибку дальше, чтобы не прерывать инициализацию
    console.log('Continuing initialization despite error in saving seasonality factor');
  }
}

// Функция для получения коэффициента сезонности для конкретного маршрута и месяца
async function getSeasonalityFactor(originPort, destinationPort, month) {
  try {
    // Получение регионов портов
    const portRegionsQuery = `
      SELECT 
        (SELECT region FROM ports WHERE id = $1) as origin_region,
        (SELECT region FROM ports WHERE id = $2) as destination_region
    `;
    
    const portRegionsResult = await pool.query(portRegionsQuery, [originPort, destinationPort]);
    
    if (!portRegionsResult.rows[0] || !portRegionsResult.rows[0].origin_region || !portRegionsResult.rows[0].destination_region) {
      console.log(`Could not determine regions for ports ${originPort} and ${destinationPort}`);
      return 1.0; // Значение по умолчанию
    }
    
    const originRegion = portRegionsResult.rows[0].origin_region;
    const destinationRegion = portRegionsResult.rows[0].destination_region;
    
    // Получение коэффициента сезонности из базы данных
    const factorQuery = `
      SELECT seasonality_factor 
      FROM seasonality_factors 
      WHERE origin_region = $1 
        AND destination_region = $2 
        AND month = $3
    `;
    
    const factorResult = await pool.query(factorQuery, [originRegion, destinationRegion, month]);
    
    if (factorResult.rows.length === 0) {
      console.log(`No seasonality factor found for ${originRegion} → ${destinationRegion}, month ${month}`);
      return 1.0; // Значение по умолчанию
    }
    
    return parseFloat(factorResult.rows[0].seasonality_factor);
  } catch (error) {
    console.error(`Error getting seasonality factor for ${originPort} → ${destinationPort}, month ${month}:`, error);
    return 1.0; // Значение по умолчанию в случае ошибки
  }
}

// Функция для получения всех коэффициентов сезонности
async function getAllSeasonalityFactors() {
  try {
    const query = `
      SELECT 
        origin_region, 
        destination_region, 
        month, 
        seasonality_factor, 
        confidence,
        last_updated
      FROM seasonality_factors
      ORDER BY origin_region, destination_region, month
    `;
    
    const result = await pool.query(query);
    return result.rows;
  } catch (error) {
    console.error('Error getting all seasonality factors:', error);
    return [];
  }
}

// Функция для получения исторических данных о ставках для визуализации
async function getHistoricalRatesForVisualization(originRegion, destinationRegion, containerType, months) {
  try {
    // Получение данных за указанное количество месяцев
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setMonth(startDate.getMonth() - months);
    
    const query = `
      SELECT 
        date, 
        AVG(rate) as avg_rate,
        COUNT(*) as data_points
      FROM historical_rates 
      WHERE origin_region = $1 
        AND destination_region = $2 
        AND container_type = $3
        AND date >= $4
      GROUP BY date
      ORDER BY date
    `;
    
    const result = await pool.query(query, [
      originRegion,
      destinationRegion,
      containerType,
      startDate.toISOString().split('T')[0]
    ]);
    
    return result.rows;
  } catch (error) {
    console.error('Error getting historical rates for visualization:', error);
    return [];
  }
}

// Функция для инициализации и обновления всех данных для анализа сезонности
async function initializeAndUpdateSeasonalityData() {
  try {
    console.log('Initializing and updating seasonality data...');
    
    // Инициализация таблиц
    await initializeSeasonalityTables();
    
    // Импорт исторических данных о ставках
    await importHistoricalRates();
    
    // Анализ сезонности
    await analyzeSeasonality();
    
    console.log('Seasonality data initialization and update completed');
    return true;
  } catch (error) {
    console.error('Error initializing and updating seasonality data:', error);
    // Не пробрасываем ошибку дальше, чтобы не прерывать инициализацию системы
    console.log('Continuing system initialization despite seasonality data error');
    return false;
  }
}

// Функция для анализа сезонности (публичная, вызывается из API)
async function analyzeSeasonalityFactors() {
  try {
    await analyzeSeasonality();
    return true;
  } catch (error) {
    console.error('Error in analyzeSeasonalityFactors:', error);
    return false;
  }
}

// Экспорт функций
module.exports = {
  initializeAndUpdateSeasonalityData,
  getSeasonalityFactor,
  getAllSeasonalityFactors,
  getHistoricalRatesForVisualization,
  analyzeSeasonalityFactors
};
