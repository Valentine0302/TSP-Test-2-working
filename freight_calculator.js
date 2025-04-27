// Модуль для агрегации данных из различных источников и расчета ставок фрахта
// Объединяет данные из SCFI, FBX, WCI и других источников
const { Pool } = require('pg');
const dotenv = require('dotenv');
const scfiScraper = require('./scfi_scraper.js');
const fbxScraper = require('./fbx_scraper.js');
const wciScraper = require('./wci_scraper.js');

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

// Весовые коэффициенты источников данных
const SOURCE_WEIGHTS = {
  'SCFI': 1.2,
  'Freightos FBX': 1.2,
  'Drewry WCI': 1.2,
  'Xeneta XSI': 1.2,
  'S&P Global Platts': 1.2,
  'Container Trades Statistics': 1.0,
  'Alphaliner': 1.0,
};

// Функция для получения актуальных данных SCFI для конкретного маршрута
async function getUpdatedSCFIDataForRoute(origin, destination) {
  try {
    console.log(`Getting updated SCFI data for route: ${origin} to ${destination}`);
    
    // Получение актуальных данных композитного индекса SCFI
    const scfiCompositeData = await scfiScraper.getSCFIDataForCalculation();
    
    if (!scfiCompositeData || !scfiCompositeData.current_index) {
      console.log('Failed to get SCFI composite data, falling back to route-specific data');
      return scfiScraper.getSCFIDataForRoute(origin, destination);
    }
    
    // Получение данных для конкретного маршрута
    const routeData = await scfiScraper.getSCFIDataForRoute(origin, destination);
    
    // Если данные для маршрута получены успешно, используем их
    if (routeData && routeData.current_index) {
      console.log('Using route-specific SCFI data:', routeData);
      return routeData;
    }
    
    // Если данные для маршрута не получены, используем композитный индекс
    // с корректировкой на основе региона
    console.log('No route-specific data available, using adjusted composite index');
    
    // Определение регионов для портов
    const originRegion = await getPortRegionById(origin);
    const destinationRegion = await getPortRegionById(destination);
    
    // Коэффициенты корректировки для разных регионов
    const regionAdjustments = {
      'Europe': 1.05,
      'Mediterranean': 1.0,
      'North America': 1.15,
      'Middle East': 0.95,
      'Oceania': 0.9,
      'Africa': 1.0,
      'South America': 0.95,
      'Asia': 0.85
    };
    
    // Определение коэффициента корректировки
    let adjustmentFactor = 1.0;
    
    if (originRegion === 'Asia' || originRegion === 'China') {
      adjustmentFactor = regionAdjustments[destinationRegion] || 1.0;
    }
    
    // Применение коэффициента к композитному индексу
    const adjustedIndex = Math.round(scfiCompositeData.current_index * adjustmentFactor);
    
    // Создание объекта с данными для маршрута на основе композитного индекса
    const adjustedData = {
      route: `${originRegion} to ${destinationRegion}`,
      current_index: adjustedIndex,
      change: scfiCompositeData.change,
      index_date: scfiCompositeData.index_date
    };
    
    console.log('Created adjusted SCFI data:', adjustedData);
    return adjustedData;
  } catch (error) {
    console.error('Error getting updated SCFI data for route:', error);
    // В случае ошибки возвращаем null, чтобы калькулятор мог использовать другие источники
    return null;
  }
}

// Вспомогательная функция для определения региона порта по его ID
async function getPortRegionById(portId) {
  try {
    const query = `
      SELECT region FROM ports 
      WHERE port_id = $1
    `;
    
    const result = await pool.query(query, [portId]);
    
    if (result.rows.length > 0) {
      return result.rows[0].region;
    } else {
      // Если порт не найден в базе, используем маппинг на основе кода порта
      const regionMap = {
        // Азия
        'CNSHA': 'China',
        'CNYTN': 'China',
        'CNNGB': 'China',
        'CNQIN': 'China',
        'CNDAL': 'China',
        'HKHKG': 'Asia',
        'SGSIN': 'Asia',
        'JPOSA': 'Asia',
        'JPTYO': 'Asia',
        'KRPUS': 'Asia',
        'VNSGN': 'Asia',
        'MYLPK': 'Asia',
        'IDTPP': 'Asia',
        'THBKK': 'Asia',
        'PHMNL': 'Asia',
        
        // Европа
        'DEHAM': 'Europe',
        'NLRTM': 'Europe',
        'GBFXT': 'Europe',
        'FRLEH': 'Europe',
        'BEANR': 'Europe',
        'ESBCN': 'Europe',
        'ITGOA': 'Europe',
        'GRPIR': 'Europe',
        
        // Средиземноморье
        'ITTRS': 'Mediterranean',
        'ESVLC': 'Mediterranean',
        'FRFOS': 'Mediterranean',
        'TRMER': 'Mediterranean',
        'EGPSD': 'Mediterranean',
        
        // Северная Америка
        'USLAX': 'North America',
        'USSEA': 'North America',
        'USNYC': 'North America',
        'USBAL': 'North America',
        'USSAV': 'North America',
        'USHOU': 'North America',
        'CAMTR': 'North America',
        'CAVNC': 'North America',
        
        // Ближний Восток
        'AEJEA': 'Middle East',
        'AEDXB': 'Middle East',
        'SAJED': 'Middle East',
        'IQBSR': 'Middle East',
        'IRBND': 'Middle East',
        
        // Океания
        'AUSYD': 'Oceania',
        'AUMEL': 'Oceania',
        'NZAKL': 'Oceania',
        
        // Африка
        'ZALGS': 'Africa',
        'ZADUR': 'Africa',
        'MAPTM': 'Africa',
        'EGALY': 'Africa',
        'TZDAR': 'Africa',
        'KEMBA': 'Africa',
        
        // Южная Америка
        'BRSSZ': 'South America',
        'ARBUE': 'South America',
        'CLVAP': 'South America',
        'PECLL': 'South America',
        'COBUN': 'South America',
        'ECGYE': 'South America'
      };
      
      return regionMap[portId] || 'Unknown';
    }
  } catch (error) {
    console.error('Error getting port region:', error);
    return 'Unknown';
  }
}

// Функция для расчета ставки фрахта на основе данных из различных источников
async function calculateFreightRate(origin, destination, containerType, weight = 20000) {
  try {
    console.log(`Calculating freight rate for ${origin} to ${destination}, container type: ${containerType}, weight: ${weight}kg`);
    
    // Получение актуальных данных из различных источников
    const scfiData = await getUpdatedSCFIDataForRoute(origin, destination);
    const fbxData = await fbxScraper.getFBXDataForRoute(origin, destination);
    const wciData = await wciScraper.getWCIDataForRoute(origin, destination);
    
    // Массив для хранения данных из всех источников
    const sourcesData = [];
    
    // Добавление данных из SCFI, если они доступны
    if (scfiData && scfiData.current_index) {
      sourcesData.push({
        source: 'SCFI',
        rate: scfiData.current_index,
        weight: SOURCE_WEIGHTS['SCFI'] || 1.0
      });
    }
    
    // Добавление данных из FBX, если они доступны
    if (fbxData && fbxData.current_index) {
      sourcesData.push({
        source: 'Freightos FBX',
        rate: fbxData.current_index,
        weight: SOURCE_WEIGHTS['Freightos FBX'] || 1.0
      });
    }
    
    // Добавление данных из WCI, если они доступны
    if (wciData && wciData.current_index) {
      sourcesData.push({
        source: 'Drewry WCI',
        rate: wciData.current_index,
        weight: SOURCE_WEIGHTS['Drewry WCI'] || 1.0
      });
    }
    
    // Если нет данных ни из одного источника, используем базовый расчет
    if (sourcesData.length === 0) {
      console.log('No data available from any source, using base calculation');
      return calculateBaseRate(origin, destination, containerType, weight);
    }
    
    // Расчет средневзвешенной ставки
    let totalWeight = 0;
    let weightedSum = 0;
    
    sourcesData.forEach(data => {
      weightedSum += data.rate * data.weight;
      totalWeight += data.weight;
    });
    
    const baseRate = Math.round(weightedSum / totalWeight);
    
    // Расчет минимальной и максимальной ставки
    // Используем стандартное отклонение для определения диапазона
    const rates = sourcesData.map(data => data.rate);
    const stdDev = calculateStandardDeviation(rates);
    
    // Минимальная ставка: базовая ставка минус стандартное отклонение, но не менее 80% от базовой
    const minRate = Math.round(Math.max(baseRate - stdDev, baseRate * 0.8));
    
    // Максимальная ставка: базовая ставка плюс стандартное отклонение, но не более 120% от базовой
    const maxRate = Math.round(Math.min(baseRate + stdDev, baseRate * 1.2));
    
    // Расчет надежности на основе количества источников и их согласованности
    // Чем больше источников и меньше стандартное отклонение, тем выше надежность
    const sourceCount = sourcesData.length;
    const maxPossibleSources = 3; // SCFI, FBX, WCI
    const sourceRatio = sourceCount / maxPossibleSources;
    
    // Коэффициент вариации (CV) - отношение стандартного отклонения к среднему
    const cv = baseRate > 0 ? stdDev / baseRate : 0;
    
    // Надежность: от 0.7 до 1.0, зависит от количества источников и их согласованности
    const reliability = Math.round((0.7 + 0.3 * sourceRatio * (1 - Math.min(cv, 0.5) / 0.5)) * 100) / 100;
    
    // Применение корректировки на основе веса
    const weightAdjustedRate = adjustRateByWeight(baseRate, weight, containerType);
    
    // Формирование результата
    const result = {
      rate: weightAdjustedRate,
      minRate: Math.round(minRate * (weightAdjustedRate / baseRate)),
      maxRate: Math.round(maxRate * (weightAdjustedRate / baseRate)),
      reliability: reliability,
      sourceCount: sourceCount,
      sources: sourcesData.map(data => data.source),
      finalRate: weightAdjustedRate // Добавляем для совместимости с API
    };
    
    console.log('Calculation result:', result);
    return result;
  } catch (error) {
    console.error('Error calculating freight rate:', error);
    // В случае ошибки используем базовый расчет
    return calculateBaseRate(origin, destination, containerType, weight);
  }
}

// Функция для корректировки ставки на основе веса
function adjustRateByWeight(baseRate, weight, containerType) {
  try {
    // Стандартные веса для разных типов контейнеров (в кг)
    const standardWeights = {
      '20DV': 20000, // 20 тонн для 20-футового контейнера
      '40DV': 25000, // 25 тонн для 40-футового контейнера
      '40HC': 25000, // 25 тонн для 40-футового high cube
      '45HC': 27000  // 27 тонн для 45-футового high cube
    };
    
    // Если тип контейнера неизвестен, используем стандартный вес 20 тонн
    const standardWeight = standardWeights[containerType] || 20000;
    
    // Если вес не указан или меньше 1000 кг, используем стандартный вес
    if (!weight || weight < 1000) {
      return baseRate;
    }
    
    // Расчет коэффициента корректировки
    // Если вес меньше стандартного, ставка немного снижается
    // Если вес больше стандартного, ставка увеличивается пропорционально
    let adjustmentFactor = 1.0;
    
    if (weight < standardWeight) {
      // Снижение до 10% для легких грузов
      const weightRatio = weight / standardWeight;
      adjustmentFactor = 0.9 + (0.1 * weightRatio);
    } else if (weight > standardWeight) {
      // Увеличение до 30% для тяжелых грузов
      const excessRatio = Math.min(1.0, (weight - standardWeight) / standardWeight);
      adjustmentFactor = 1.0 + (0.3 * excessRatio);
    }
    
    // Применение коэффициента корректировки
    return Math.round(baseRate * adjustmentFactor);
  } catch (error) {
    console.error('Error adjusting rate by weight:', error);
    // В случае ошибки возвращаем исходную ставку
    return baseRate;
  }
}

// Функция для базового расчета ставки фрахта (используется, если нет данных из источников)
function calculateBaseRate(origin, destination, containerType, weight = 20000) {
  // Используем детерминированный подход вместо случайных чисел
  // Создаем хеш на основе полных названий портов и типа контейнера
  console.log(`Calculating base rate for ${origin} to ${destination}, container type: ${containerType}`);
  
  // Функция для создания простого хеша строки
  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }
  
  // Создаем строку для хеширования, включающую все параметры
  const hashString = `${origin}-${destination}-${containerType}`;
  const hash = simpleHash(hashString);
  
  // Базовая ставка: 1500 + хеш модуло 1500 (диапазон от 1500 до 3000)
  const baseRate = 1500 + (hash % 1500);
  
  console.log(`Generated deterministic base rate for ${hashString}: ${baseRate}`);
  
  // Применение корректировки на основе веса
  const weightAdjustedRate = adjustRateByWeight(baseRate, weight, containerType);
  
  // Формирование результата
  const result = {
    rate: weightAdjustedRate,
    minRate: Math.round(weightAdjustedRate * 0.9),  // -10%
    maxRate: Math.round(weightAdjustedRate * 1.1),  // +10%
    reliability: 0.7,  // Низкая надежность, так как используется базовый расчет
    sourceCount: 0,
    sources: ['Base calculation'],
    finalRate: weightAdjustedRate // Добавляем для совместимости с API
  };
  
  console.log('Base calculation result:', result);
  return result;
}

// Функция для расчета стандартного отклонения
function calculateStandardDeviation(values) {
  const n = values.length;
  if (n === 0) return 0;
  
  // Расчет среднего значения
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  
  // Расчет суммы квадратов отклонений
  const squaredDifferencesSum = values.reduce((sum, value) => {
    const difference = value - mean;
    return sum + (difference * difference);
  }, 0);
  
  // Расчет дисперсии и стандартного отклонения
  const variance = squaredDifferencesSum / n;
  const stdDev = Math.sqrt(variance);
  
  return stdDev;
}

// Функция для обновления данных из всех источников
async function updateAllSourcesData() {
  try {
    console.log('Updating data from all sources...');
    
    // Обновление данных SCFI
    await scfiScraper.fetchSCFIData();
    
    // Обновление данных FBX
    await fbxScraper.fetchFBXData();
    
    // Обновление данных WCI
    await wciScraper.fetchWCIData();
    
    console.log('All sources data updated successfully');
    return true;
  } catch (error) {
    console.error('Error updating sources data:', error);
    return false;
  }
}

// Экспорт функций
module.exports = {
  calculateFreightRate,
  updateAllSourcesData
};
