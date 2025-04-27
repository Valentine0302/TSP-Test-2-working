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

// Функция для расчета ставки фрахта на основе данных из различных источников
async function calculateFreightRate(origin, destination, containerType, weight = 20000) {
  try {
    console.log(`Calculating freight rate for ${origin} to ${destination}, container type: ${containerType}, weight: ${weight}kg`);
    
    // Получение данных из различных источников
    const scfiData = await scfiScraper.getSCFIDataForRoute(origin, destination);
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
