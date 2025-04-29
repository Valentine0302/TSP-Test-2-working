// Модуль для агрегации данных из различных источников и расчета ставок фрахта
// Усовершенствованная версия, использующая все доступные индексы и факторы

import { Pool } from 'pg';
import dotenv from 'dotenv';

// Импорт всех модулей скраперов
// Используем исправленные/предпочтительные версии скраперов
import scfiScraper from '/home/ubuntu/TSP-Test-2-repo/scfi_scraper.js'; // Используем версию из репозитория
import fbxScraper from './fbx_scraper.js'; // Оставляем как есть, предполагая рабочим
import wciScraper from './wci_scraper.js'; // Оставляем как есть, предполагая рабочим
import bdiScraper from '/home/ubuntu/bdi_scraper_fixed.js'; // Используем исправленную версию
import ccfiScraper from '/home/ubuntu/ccfi_scraper_fixed.js'; // Используем исправленную версию
import harpexScraper from './harpex_scraper.js'; // Оставляем как есть, предполагая рабочим
import contexScraper from './contex_scraper.js'; // Assuming this is New ConTex
import istfixScraper from './istfix_scraper.js'; // Оставляем как есть, предполагая рабочим
import ctsScraper from './cts_scraper.js'; // Оставляем как есть, предполагая рабочим

import scraperAdapters from './scraper_adapters.js';
import seasonalityAnalyzer from './seasonality_analyzer.js';
import fuelSurchargeCalculator from './fuel_surcharge_calculator.js';
import webSearchIndices from './web_search_indices.js'; // Import web search module

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

// Весовые коэффициенты для основных индексов спотовых ставок
const CORE_SOURCE_WEIGHTS = {
  'SCFI': 1.2,
  'Freightos FBX': 1.2,
  'Drewry WCI': 1.1,
  'CCFI': 1.0,
};

// Веса для модификаторов (можно настроить)
const MODIFIER_WEIGHTS = {
  'Harpex': 0.4,
  'NewConTex': 0.4,
  'BDI': 0.1,
  'CTS': 0.2,
  'ISTFIX': 1.5 // Используется только для Intra-Asia
};

// Placeholder для базовых значений модификаторов (в идеале - из исторических данных)
const MODIFIER_BASELINES = {
  'Harpex': 1000, // Примерное значение
  'NewConTex': 500, // Примерное значение
  'BDI': 1500, // Примерное значение
  'CTS': 100 // Примерное значение (индекс)
};

// --- Вспомогательные функции ---

// Функция для расчета стандартного отклонения
function calculateStandardDeviation(values) {
  const n = values.length;
  if (n <= 1) return 0; // Стандартное отклонение не определено для 0 или 1 значения

  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const squaredDifferencesSum = values.reduce((sum, value) => {
    const difference = value - mean;
    return sum + (difference * difference);
  }, 0);
  // Используем sample standard deviation (n-1) для несмещенной оценки
  const variance = n > 1 ? squaredDifferencesSum / (n - 1) : 0;
  return Math.sqrt(variance);
}

// Функция для базового расчета ставки фрахта (если нет данных из источников)
function calculateBaseRate(origin, destination, containerType, debugLog = []) {
  const step = { stage: 'Base Rate Calculation (Fallback)', inputs: { origin, destination, containerType } };
  try {
    function simpleHash(str) {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return Math.abs(hash);
    }

    const hashString = `${origin}-${destination}-${containerType}`;
    const hash = simpleHash(hashString);
    const baseRate = 1500 + (hash % 1500); // Детерминированная ставка 1500-3000
    step.details = `Generated hash for '${hashString}': ${hash}. Base rate: 1500 + (${hash} % 1500) = ${baseRate}.`;

    // ВАЖНО: Fallback не включает топливо, оно будет добавлено позже, если возможно
    const result = {
        rate: baseRate, // Это базовая ставка БЕЗ топлива
        minRate: Math.round(baseRate * 0.9),
        maxRate: Math.round(baseRate * 1.1),
        reliability: 0.7, // Низкая надежность для fallback
        sourceCount: 0,
        sourcesUsed: ['Base calculation fallback'],
        // finalRate будет рассчитан позже с добавлением топлива
    };
    step.result = { baseRate: result.rate }; // Логируем только базовую ставку здесь
    step.status = 'Success (using fallback)';
    debugLog.push(step);
    return result;
  } catch (error) {
    step.status = 'Error';
    step.error = error.message;
    debugLog.push(step);
    console.error('Error calculating base rate:', error);
    // Совсем крайний случай - вернуть фиксированное значение БЕЗ топлива
    return {
      rate: 2000, minRate: 1800, maxRate: 2200, reliability: 0.5, sourceCount: 0, sourcesUsed: ['Error Fallback'],
    };
  }
}

// Вспомогательная функция для определения региона порта по его ID
async function getPortRegionById(portId) {
  // ... (код без изменений) ...
  try {
    const query = `SELECT region FROM ports WHERE id = $1`; // Используем id, а не port_id
    const result = await pool.query(query, [portId]);
    if (result.rows.length > 0) {
      return result.rows[0].region;
    } else {
      // Fallback map (может быть неполным)
      const regionMap = {
        'CNSHA': 'China', 'CNYTN': 'China', 'CNNGB': 'China', 'CNQIN': 'China', 'CNDAL': 'China',
        'HKHKG': 'Asia', 'SGSIN': 'Asia', 'JPOSA': 'Asia', 'JPTYO': 'Asia', 'KRPUS': 'Asia', 'VNSGN': 'Asia', 'MYLPK': 'Asia', 'IDTPP': 'Asia', 'THBKK': 'Asia', 'PHMNL': 'Asia',
        'DEHAM': 'Europe', 'NLRTM': 'Europe', 'GBFXT': 'Europe', 'FRLEH': 'Europe', 'BEANR': 'Europe', 'ESBCN': 'Europe', 'ITGOA': 'Europe', 'GRPIR': 'Europe',
        'ITTRS': 'Mediterranean', 'ESVLC': 'Mediterranean', 'FRFOS': 'Mediterranean', 'TRMER': 'Mediterranean', 'EGPSD': 'Mediterranean',
        'USLAX': 'North America', 'USSEA': 'North America', 'USNYC': 'North America', 'USBAL': 'North America', 'USSAV': 'North America', 'USHOU': 'North America', 'CAMTR': 'North America', 'CAVNC': 'North America',
        'AEJEA': 'Middle East', 'AEDXB': 'Middle East', 'SAJED': 'Middle East', 'IQBSR': 'Middle East', 'IRBND': 'Middle East',
        'AUSYD': 'Oceania', 'AUMEL': 'Oceania', 'NZAKL': 'Oceania',
        'ZALGS': 'Africa', 'ZADUR': 'Africa', 'MAPTM': 'Africa', 'EGALY': 'Africa', 'TZDAR': 'Africa', 'KEMBA': 'Africa',
        'BRSSZ': 'South America', 'ARBUE': 'South America', 'CLVAP': 'South America', 'PECLL': 'South America', 'COBUN': 'South America', 'ECGYE': 'South America'
      };
      return regionMap[portId] || 'Unknown';
    }
  } catch (error) {
    console.error(`Error getting region for port ${portId}:`, error);
    return 'Unknown';
  }
}

// --- Основная функция расчета --- 

async function calculateFreightRate(originPortId, destinationPortId, containerType, weight = 20000, debugMode = false) {
  const debugLog = [];
  const startTime = Date.now();

  if (debugMode) {
    debugLog.push({ stage: 'Start Calculation', inputs: { originPortId, destinationPortId, containerType, weight }, timestamp: new Date().toISOString() });
  }

  let baseOceanFreight = 0; // Ставка без топлива
  let reliabilityScore = 0.5; // Начальная надежность
  let sourcesUsedCount = 0;
  let sourcesUsedList = [];
  let calculationStatus = 'Incomplete';

  try {
    // 1. Получение данных из всех источников параллельно
    const fetchStep = { stage: 'Fetch Index Data', sources: {} };
    const indexPromises = {
      // Основные индексы
      SCFI: scfiScraper.getSCFIDataForCalculation(),
      FBX: scraperAdapters.getFBXDataForCalculationAdapter(),
      WCI: scraperAdapters.getWCIDataForCalculationAdapter(),
      CCFI: ccfiScraper.getCCFIDataForCalculation(), // Используем прямой вызов исправленного
      // Модификаторы
      Harpex: harpexScraper.getHarpexDataForCalculation(),
      NewConTex: contexScraper.getContexDataForCalculation(),
      BDI: bdiScraper.getBDIDataForCalculation(),
      CTS: ctsScraper.getCTSDataForCalculation(),
      ISTFIX: istfixScraper.getISTFIXDataForCalculation()
    };

    const indexResults = await Promise.allSettled(Object.values(indexPromises));
    const indexData = {};
    const sourceKeys = Object.keys(indexPromises);

    for (let i = 0; i < sourceKeys.length; i++) {
      const key = sourceKeys[i];
      const result = indexResults[i];

      if (result.status === 'fulfilled' && result.value && result.value.current_index !== undefined) {
        indexData[key] = result.value;
        fetchStep.sources[key] = { status: 'Success', value: indexData[key] };
      } else {
        const reason = result.reason?.message || (result.value === null ? 'No data returned' : 'Invalid data format');
        console.log(`[Fallback] Primary fetch for ${key} failed. Reason: ${reason}. Trying web search...`);
        fetchStep.sources[key] = { status: 'Failed (Primary)', reason };
        try {
          const webSearchResult = await webSearchIndices.searchIndexValue(key);
          if (webSearchResult && webSearchResult.value !== undefined) {
            indexData[key] = {
              current_index: webSearchResult.value,
              index_date: webSearchResult.date,
              change: webSearchResult.change, // Добавляем изменение, если есть
              source: 'web_search'
            };
            fetchStep.sources[key] = { status: 'Success (Web Search Fallback)', value: indexData[key] };
            console.log(`[Fallback] Web search for ${key} successful.`);
          } else {
            indexData[key] = null;
            fetchStep.sources[key].status = 'Failed (Fallback Failed)';
            fetchStep.sources[key].fallback_reason = 'Web search did not return valid data';
            console.log(`[Fallback] Web search for ${key} failed.`);
          }
        } catch (webSearchError) {
          indexData[key] = null;
          fetchStep.sources[key].status = 'Failed (Fallback Error)';
          fetchStep.sources[key].fallback_reason = webSearchError.message;
          console.error(`[Fallback] Error during web search for ${key}:`, webSearchError);
        }
      }
    }
    if (debugMode) debugLog.push(fetchStep);

    // 2. Расчет базовой ставки (Ocean Freight) на основе основных индексов
    const coreRateStep = { stage: 'Calculate Core Ocean Freight', inputs: {}, sourcesUsed: [], totalWeight: 0, weightedSum: 0, rates: [] };
    const coreSourcesData = [];
    for (const sourceName of ['SCFI', 'FBX', 'WCI', 'CCFI']) {
      if (indexData[sourceName] && indexData[sourceName].current_index !== undefined) {
        const rateValue = parseFloat(indexData[sourceName].current_index);
        if (!isNaN(rateValue)) {
            const weight = CORE_SOURCE_WEIGHTS[sourceName] || 1.0;
            coreSourcesData.push({
                source: sourceName + (indexData[sourceName].source === 'web_search' ? ' (Web)' : ''),
                rate: rateValue,
                weight: weight
            });
            coreRateStep.inputs[sourceName] = { rate: rateValue, weight: weight, source_type: indexData[sourceName].source || 'primary' };
            coreRateStep.weightedSum += rateValue * weight;
            coreRateStep.totalWeight += weight;
            coreRateStep.rates.push(rateValue);
        }
      }
    }

    if (coreRateStep.totalWeight > 0) {
      baseOceanFreight = Math.round(coreRateStep.weightedSum / coreRateStep.totalWeight);
      coreRateStep.result = baseOceanFreight;
      coreRateStep.status = 'Success';
      coreRateStep.sourcesUsed = coreSourcesData.map(d => d.source);
      sourcesUsedList = coreSourcesData.map(d => d.source);
      sourcesUsedCount = coreSourcesData.length;

      // Расчет надежности на основе количества источников и стандартного отклонения
      const stdDev = calculateStandardDeviation(coreRateStep.rates);
      const relativeStdDev = baseOceanFreight > 0 ? stdDev / baseOceanFreight : 0;
      // Примерная формула надежности: больше источников -> выше, больше разброс -> ниже
      reliabilityScore = 0.7 + (sourcesUsedCount * 0.05) - (relativeStdDev * 0.5);
      reliabilityScore = Math.max(0.5, Math.min(0.95, reliabilityScore)); // Ограничение 0.5 - 0.95
      coreRateStep.reliability = { score: reliabilityScore.toFixed(2), stdDev: stdDev.toFixed(2), relativeStdDev: relativeStdDev.toFixed(2) };
      calculationStatus = 'Core Rate Calculated';

    } else {
      // Если нет данных от основных источников, используем базовый расчет
      if (debugMode) debugLog.push({ stage: 'Core Ocean Freight Calculation', status: 'Failed', reason: 'No data from core indices (SCFI, FBX, WCI, CCFI). Falling back to base calculation.' });
      const baseResult = calculateBaseRate(originPortId, destinationPortId, containerType, debugLog);
      baseOceanFreight = baseResult.rate;
      reliabilityScore = baseResult.reliability;
      sourcesUsedList = baseResult.sourcesUsed;
      sourcesUsedCount = baseResult.sourceCount;
      // Логирование базового расчета уже внутри calculateBaseRate
      calculationStatus = 'Fallback Rate Used';
    }
    if (debugMode) debugLog.push(coreRateStep);

    // 3. Расчет и применение модификаторов к baseOceanFreight
    let modifiedOceanFreight = baseOceanFreight;
    const modifierStep = { stage: 'Apply Modifiers to Ocean Freight', initialRate: baseOceanFreight, modifiersApplied: {}, finalRate: null };

    const originRegion = await getPortRegionById(originPortId);
    const destinationRegion = await getPortRegionById(destinationPortId);
    modifierStep.routeInfo = { originRegion, destinationRegion };

    // 3.1 Модификатор фрахтования (Harpex, NewConTex)
    let charterModifier = 1.0;
    let charterSources = 0;
    if (indexData.Harpex && indexData.Harpex.current_index !== undefined) {
      const value = parseFloat(indexData.Harpex.current_index);
      const baseline = MODIFIER_BASELINES.Harpex;
      if (!isNaN(value) && baseline) {
          charterModifier *= (1 + MODIFIER_WEIGHTS.Harpex * (value - baseline) / baseline);
          charterSources++;
          modifierStep.modifiersApplied.Harpex = { value, baseline, weight: MODIFIER_WEIGHTS.Harpex, source_type: indexData.Harpex.source || 'primary' };
      }
    }
     if (indexData.NewConTex && indexData.NewConTex.current_index !== undefined) {
      const value = parseFloat(indexData.NewConTex.current_index);
      const baseline = MODIFIER_BASELINES.NewConTex;
       if (!isNaN(value) && baseline) {
          charterModifier *= (1 + MODIFIER_WEIGHTS.NewConTex * (value - baseline) / baseline);
          charterSources++;
          modifierStep.modifiersApplied.NewConTex = { value, baseline, weight: MODIFIER_WEIGHTS.NewConTex, source_type: indexData.NewConTex.source || 'primary' };
       }
    }
    if (charterSources > 0) {
      charterModifier = Math.max(0.8, Math.min(1.2, charterModifier)); // Ограничиваем модификатор +/- 20%
      modifiedOceanFreight *= charterModifier;
      modifierStep.modifiersApplied.Charter = { factor: charterModifier.toFixed(3), rateAfter: Math.round(modifiedOceanFreight) };
    }

    // 3.2 Модификатор спроса (BDI, CTS)
    let demandModifier = 1.0;
    let demandSources = 0;
    if (indexData.BDI && indexData.BDI.current_index !== undefined) {
      const value = parseFloat(indexData.BDI.current_index);
      const baseline = MODIFIER_BASELINES.BDI;
       if (!isNaN(value) && baseline) {
          demandModifier *= (1 + MODIFIER_WEIGHTS.BDI * (value - baseline) / baseline);
          demandSources++;
          modifierStep.modifiersApplied.BDI = { value, baseline, weight: MODIFIER_WEIGHTS.BDI, source_type: indexData.BDI.source || 'primary' };
       }
    }
    if (indexData.CTS && indexData.CTS.current_index !== undefined) {
      const value = parseFloat(indexData.CTS.current_index);
      const baseline = MODIFIER_BASELINES.CTS;
       if (!isNaN(value) && baseline) {
          demandModifier *= (1 + MODIFIER_WEIGHTS.CTS * (value - baseline) / baseline);
          demandSources++;
          modifierStep.modifiersApplied.CTS = { value, baseline, weight: MODIFIER_WEIGHTS.CTS, source_type: indexData.CTS.source || 'primary' };
       }
    }
     if (demandSources > 0) {
      demandModifier = Math.max(0.9, Math.min(1.1, demandModifier)); // Ограничиваем модификатор +/- 10%
      modifiedOceanFreight *= demandModifier;
      modifierStep.modifiersApplied.Demand = { factor: demandModifier.toFixed(3), rateAfter: Math.round(modifiedOceanFreight) };
    }

    // 3.3 Модификатор ISTFIX (Intra-Asia)
    const isIntraAsia = (originRegion === 'Asia' || originRegion === 'China') && (destinationRegion === 'Asia' || destinationRegion === 'China');
    modifierStep.modifiersApplied.ISTFIX_Check = { isIntraAsia };

    if (isIntraAsia && indexData.ISTFIX && indexData.ISTFIX.current_index !== undefined) {
      const value = parseFloat(indexData.ISTFIX.current_index);
      if (!isNaN(value)) {
          const istfixWeight = MODIFIER_WEIGHTS.ISTFIX;
          const coreWeight = 1.0; // Вес для уже рассчитанной ставки
          modifiedOceanFreight = (modifiedOceanFreight * coreWeight + value * istfixWeight) / (coreWeight + istfixWeight);
          modifierStep.modifiersApplied.ISTFIX = { applied: true, value, weight: istfixWeight, rateAfter: Math.round(modifiedOceanFreight), source_type: indexData.ISTFIX.source || 'primary' };
      } else {
          modifierStep.modifiersApplied.ISTFIX = { applied: false, reason: 'Invalid ISTFIX data' };
      }
    } else if (isIntraAsia) {
       modifierStep.modifiersApplied.ISTFIX = { applied: false, reason: 'No ISTFIX data available' };
    } else {
       modifierStep.modifiersApplied.ISTFIX = { applied: false, reason: 'Not an Intra-Asia route' };
    }

    modifiedOceanFreight = Math.round(modifiedOceanFreight);
    modifierStep.finalRate = modifiedOceanFreight;
    if (debugMode) debugLog.push(modifierStep);
    calculationStatus = 'Modifiers Applied';

    // 4. Применение сезонности к modifiedOceanFreight
    let seasonalOceanFreight = modifiedOceanFreight;
    const seasonalityStep = { stage: 'Apply Seasonality to Ocean Freight', initialRate: modifiedOceanFreight, factor: 1.0, finalRate: null };
    try {
      const currentMonth = new Date().getMonth() + 1; // 1-12
      const seasonalityData = await seasonalityAnalyzer.getSeasonalityFactor(originRegion, destinationRegion, currentMonth);
      if (seasonalityData && seasonalityData.factor) {
        seasonalityStep.factor = seasonalityData.factor;
        seasonalOceanFreight *= seasonalityData.factor;
        seasonalityStep.details = `Fetched factor for ${originRegion}-${destinationRegion}, Month ${currentMonth}. Confidence: ${seasonalityData.confidence}.`;
      } else {
        seasonalityStep.details = `No seasonality factor found for ${originRegion}-${destinationRegion}, Month ${currentMonth}. Using 1.0.`;
      }
    } catch (error) {
      seasonalityStep.status = 'Error fetching/applying seasonality';
      seasonalityStep.error = error.message;
      console.error('Error applying seasonality:', error);
    }
    seasonalOceanFreight = Math.round(seasonalOceanFreight);
    seasonalityStep.finalRate = seasonalOceanFreight;
    if (debugMode) debugLog.push(seasonalityStep);
    calculationStatus = 'Seasonality Applied';

    // 5. Расчет топливной надбавки (Fuel Surcharge / BAF)
    // Рассчитываем всегда и добавляем к seasonalOceanFreight
    const fuelSurchargeStep = { stage: 'Calculate Fuel Surcharge', surcharge: 0, details: 'Not calculated yet' };
    let fuelSurcharge = 0;
    try {
      // Получаем тип топлива (например, VLSFO) и цену
      // TODO: Определить, какой тип топлива использовать? Пока захардкодим VLSFO
      const fuelType = 'VLSFO';
      const fuelPriceData = await fuelSurchargeCalculator.getLatestFuelPrice(fuelType);

      if (fuelPriceData && fuelPriceData.price) {
        // Рассчитываем надбавку
        // Нужны расстояние или время в пути. Пока используем заглушку.
        // TODO: Реализовать получение расстояния/времени для маршрута
        const distanceNM = 5000; // Примерное расстояние в морских милях
        fuelSurcharge = fuelSurchargeCalculator.calculateSurcharge(fuelPriceData.price, distanceNM, containerType);
        fuelSurchargeStep.surcharge = fuelSurcharge;
        fuelSurchargeStep.details = `Calculated surcharge based on ${fuelType} price ${fuelPriceData.price} (Date: ${fuelPriceData.price_date}) for distance ${distanceNM} NM.`;
        fuelSurchargeStep.status = 'Success';
      } else {
        fuelSurchargeStep.details = `Could not get latest fuel price for ${fuelType}. Surcharge set to 0.`;
        fuelSurchargeStep.status = 'Failed (No Fuel Price)';
        console.warn(`Could not get fuel price for ${fuelType}, fuel surcharge will be 0.`);
      }
    } catch (error) {
      fuelSurchargeStep.status = 'Error';
      fuelSurchargeStep.error = error.message;
      fuelSurchargeStep.details = `Error calculating fuel surcharge. Surcharge set to 0.`;
      console.error('Error calculating fuel surcharge:', error);
    }
    if (debugMode) debugLog.push(fuelSurchargeStep);
    calculationStatus = 'Fuel Surcharge Calculated';

    // 6. Финальный расчет ставки (Rate = Seasonal Ocean Freight + Fuel Surcharge)
    const finalRate = seasonalOceanFreight + fuelSurcharge;
    const finalStep = { stage: 'Final Rate Calculation', seasonalOceanFreight, fuelSurcharge, finalRate };
    if (debugMode) debugLog.push(finalStep);

    // 7. Расчет Min/Max для администратора на основе finalRate
    // Используем разброс, зависящий от надежности
    const spreadFactor = 0.1 + (1 - reliabilityScore) * 0.1; // От 10% до 15% в зависимости от надежности
    const minRate = Math.round(finalRate * (1 - spreadFactor));
    const maxRate = Math.round(finalRate * (1 + spreadFactor));
    const rangeStep = { stage: 'Calculate Min/Max Range', finalRate, reliabilityScore: reliabilityScore.toFixed(2), spreadFactor: spreadFactor.toFixed(2), minRate, maxRate };
    if (debugMode) debugLog.push(rangeStep);

    const endTime = Date.now();
    const duration = endTime - startTime;
    if (debugMode) debugLog.push({ stage: 'End Calculation', durationMs: duration, finalResult: { rate: finalRate, minRate, maxRate } });
    calculationStatus = 'Completed';

    // Возвращаем результат
    return {
      rate: finalRate, // Единая ставка для пользователя
      minRate: minRate, // Минимальная ставка для админа
      maxRate: maxRate, // Максимальная ставка для админа
      reliability: parseFloat(reliabilityScore.toFixed(2)),
      sourceCount: sourcesUsedCount,
      sourcesUsed: sourcesUsedList,
      calculationTimeMs: duration,
      debugLog: debugMode ? debugLog : undefined // Включаем лог только в debugMode
    };

  } catch (error) {
    console.error('Unhandled error during freight rate calculation:', error);
    const endTime = Date.now();
    const duration = endTime - startTime;
    if (debugMode) {
        debugLog.push({ stage: 'Unhandled Error', error: error.message, stack: error.stack });
        debugLog.push({ stage: 'End Calculation (Error)', durationMs: duration });
    }
    // Возвращаем ошибку или fallback
    // Можно вернуть базовый расчет как fallback при серьезной ошибке
     const fallbackResult = calculateBaseRate(originPortId, destinationPortId, containerType, debugLog);
     // Попытаемся добавить топливо к fallback, если возможно
     let finalFallbackRate = fallbackResult.rate;
     try {
        const fuelType = 'VLSFO';
        const fuelPriceData = await fuelSurchargeCalculator.getLatestFuelPrice(fuelType);
        if (fuelPriceData && fuelPriceData.price) {
            const distanceNM = 5000; // Пример
            const surcharge = fuelSurchargeCalculator.calculateSurcharge(fuelPriceData.price, distanceNM, containerType);
            finalFallbackRate += surcharge;
            if (debugMode) debugLog.push({ stage: 'Fallback Fuel Surcharge', surcharge, finalFallbackRate });
        }
     } catch (fuelError) {
         if (debugMode) debugLog.push({ stage: 'Fallback Fuel Surcharge Error', error: fuelError.message });
     }

    return {
      rate: finalFallbackRate,
      minRate: Math.round(finalFallbackRate * 0.85),
      maxRate: Math.round(finalFallbackRate * 1.15),
      reliability: 0.4, // Очень низкая надежность при ошибке
      sourceCount: 0,
      sourcesUsed: ['Error Fallback'],
      calculationTimeMs: duration,
      error: error.message, // Добавляем сообщение об ошибке
      debugLog: debugMode ? debugLog : undefined
    };
  }
}

// Экспорт основной функции
export default {
  calculateFreightRate
};

// Для совместимости с require в других модулях (если нужно)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calculateFreightRate
  };
}

