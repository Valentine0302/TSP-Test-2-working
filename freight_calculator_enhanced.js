// Модуль для агрегации данных из различных источников и расчета ставок фрахта
// Усовершенствованная версия, использующая все доступные индексы и факторы

import { Pool } from 'pg';
import dotenv from 'dotenv';

// Импорт всех модулей скраперов
import scfiScraper from './scfi_scraper.js';
import fbxScraper from './fbx_scraper.js';
import wciScraper from './wci_scraper.js';
import bdiScraper from './bdi_scraper.js';
import ccfiScraper from './ccfi_scraper.js';
import harpexScraper from './harpex_scraper.js';
import contexScraper from './contex_scraper.js'; // Assuming this is New ConTex
import istfixScraper from './istfix_scraper.js';
import ctsScraper from './cts_scraper.js';

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
  const variance = squaredDifferencesSum / (n - 1); // Используем sample standard deviation (n-1)
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

    const result = {
      rate: baseRate,
      minRate: Math.round(baseRate * 0.9),
      maxRate: Math.round(baseRate * 1.1),
      reliability: 0.7,
      sourceCount: 0,
      sourcesUsed: ['Base calculation fallback'],
      finalRate: baseRate
    };
    step.result = result;
    step.status = 'Success (using fallback)';
    debugLog.push(step);
    return result;
  } catch (error) {
    step.status = 'Error';
    step.error = error.message;
    debugLog.push(step);
    console.error('Error calculating base rate:', error);
    // Совсем крайний случай - вернуть фиксированное значение
    return {
      rate: 2000, minRate: 1800, maxRate: 2200, reliability: 0.5, sourceCount: 0, sourcesUsed: ['Error Fallback'], finalRate: 2000
    };
  }
}

// Вспомогательная функция для определения региона порта по его ID
async function getPortRegionById(portId) {
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
    debugLog.push({ stage: 'Start Calculation', inputs: { originPortId, destinationPortId, containerType, weight: 20000 }, timestamp: new Date().toISOString() });
  }

  try {
    // 1. Получение данных из всех источников параллельно
    const fetchStep = { stage: 'Fetch Index Data', sources: {} };
    const indexPromises = {
      SCFI: scfiScraper.getSCFIDataForCalculation(), // Предполагаем, что эта функция есть и возвращает { current_index, change, index_date }
      FBX: scraperAdapters.getFBXDataForCalculationAdapter(),   // Используем адаптер
      WCI: scraperAdapters.getWCIDataForCalculationAdapter(),   // Используем адаптер
      CCFI: scraperAdapters.getCCFIDataForCalculationAdapter(), // Используем адаптер
      Harpex: harpexScraper.getHarpexDataForCalculation(), // Аналогично
      NewConTex: contexScraper.getContexDataForCalculation(), // Аналогично
      BDI: bdiScraper.getBDIDataForCalculation(),       // Аналогично
      CTS: ctsScraper.getCTSDataForCalculation(),         // Аналогично
      ISTFIX: istfixScraper.getISTFIXDataForCalculation() // Аналогично
    };

    const indexResults = await Promise.allSettled(Object.values(indexPromises));
    const indexData = {};
    const sourceKeys = Object.keys(indexPromises);

    for (let i = 0; i < sourceKeys.length; i++) {
      const key = sourceKeys[i];
      const result = indexResults[i];

      if (result.status === 'fulfilled' && result.value) {
        indexData[key] = result.value;
        fetchStep.sources[key] = { status: 'Success', value: indexData[key] };
      } else {
        // Primary fetch failed, try web search fallback
        console.log(`[Fallback] Primary fetch for ${key} failed. Reason: ${result.reason?.message || 'No data returned'}. Trying web search...`);
        try {
          // Use await inside the async loop
          const webSearchResult = await webSearchIndices.searchIndexValue(key);
          if (webSearchResult && webSearchResult.value) {
            indexData[key] = {
              current_index: webSearchResult.value,
              index_date: webSearchResult.date,
              source: 'web_search' // Mark data as coming from web search
            };
            fetchStep.sources[key] = { status: 'Success (Web Search Fallback)', value: indexData[key] };
            console.log(`[Fallback] Web search for ${key} successful.`);
          } else {
            indexData[key] = null;
            fetchStep.sources[key] = { status: 'Failed (Fallback Failed)', reason: 'Web search did not return valid data' };
            console.log(`[Fallback] Web search for ${key} failed.`);
          }
        } catch (webSearchError) {
          indexData[key] = null;
          fetchStep.sources[key] = { status: 'Failed (Fallback Error)', reason: webSearchError.message };
          console.error(`[Fallback] Error during web search for ${key}:`, webSearchError);
        }
      }
    }
    if (debugMode) debugLog.push(fetchStep);

    // 2. Расчет базовой ставки на основе основных индексов
    const coreRateStep = { stage: 'Calculate Core Rate', inputs: {}, sourcesUsed: [], totalWeight: 0, weightedSum: 0 };
    const coreSourcesData = [];
    for (const sourceName of ['SCFI', 'FBX', 'WCI', 'CCFI']) {
      if (indexData[sourceName] && indexData[sourceName].current_index) {
        const weight = CORE_SOURCE_WEIGHTS[sourceName] || 1.0;
        coreSourcesData.push({
          source: sourceName,
          rate: indexData[sourceName].current_index,
          weight: weight
        });
        coreRateStep.inputs[sourceName] = { rate: indexData[sourceName].current_index, weight: weight };
        coreRateStep.weightedSum += indexData[sourceName].current_index * weight;
        coreRateStep.totalWeight += weight;
      }
    }

    let calculatedRate;
    if (coreRateStep.totalWeight > 0) {
      calculatedRate = Math.round(coreRateStep.weightedSum / coreRateStep.totalWeight);
      coreRateStep.result = calculatedRate;
      coreRateStep.status = 'Success';
      coreRateStep.sourcesUsed = coreSourcesData.map(d => d.source);
    } else {
      // Если нет данных от основных источников, используем базовый расчет
      if (debugMode) debugLog.push({ stage: 'Core Rate Calculation', status: 'Failed', reason: 'No data from core indices (SCFI, FBX, WCI, CCFI). Falling back to base calculation.' });
      const baseResult = calculateBaseRate(originPortId, destinationPortId, containerType, debugLog);
      // Логирование базового расчета уже внутри calculateBaseRate
      return { ...baseResult, debugLog: debugMode ? debugLog : undefined };
    }
    if (debugMode) debugLog.push(coreRateStep);

    // 3. Расчет и применение модификаторов
    let modifiedRate = calculatedRate;
    const modifierStep = { stage: 'Apply Modifiers', initialRate: calculatedRate, modifiersApplied: {}, finalRate: null };

    // 3.1 Модификатор фрахтования (Harpex, NewConTex)
    let charterModifier = 1.0;
    let charterSources = 0;
    if (indexData.Harpex && indexData.Harpex.current_index) {
      // Простая логика: если выше базового, увеличиваем, если ниже - уменьшаем
      charterModifier *= (1 + MODIFIER_WEIGHTS.Harpex * (indexData.Harpex.current_index - MODIFIER_BASELINES.Harpex) / MODIFIER_BASELINES.Harpex);
      charterSources++;
      modifierStep.modifiersApplied.Harpex = { value: indexData.Harpex.current_index, baseline: MODIFIER_BASELINES.Harpex, weight: MODIFIER_WEIGHTS.Harpex };
    }
    if (indexData.NewConTex && indexData.NewConTex.current_index) {
      charterModifier *= (1 + MODIFIER_WEIGHTS.NewConTex * (indexData.NewConTex.current_index - MODIFIER_BASELINES.NewConTex) / MODIFIER_BASELINES.NewConTex);
      charterSources++;
      modifierStep.modifiersApplied.NewConTex = { value: indexData.NewConTex.current_index, baseline: MODIFIER_BASELINES.NewConTex, weight: MODIFIER_WEIGHTS.NewConTex };
    }
    if (charterSources > 0) {
      charterModifier = Math.max(0.8, Math.min(1.2, charterModifier)); // Ограничиваем модификатор +/- 20%
      modifiedRate *= charterModifier;
      modifierStep.modifiersApplied.Charter = { factor: charterModifier.toFixed(3), rateAfter: Math.round(modifiedRate) };
    }

    // 3.2 Модификатор спроса (BDI, CTS)
    let demandModifier = 1.0;
    let demandSources = 0;
    if (indexData.BDI && indexData.BDI.current_index) {
      demandModifier *= (1 + MODIFIER_WEIGHTS.BDI * (indexData.BDI.current_index - MODIFIER_BASELINES.BDI) / MODIFIER_BASELINES.BDI);
      demandSources++;
      modifierStep.modifiersApplied.BDI = { value: indexData.BDI.current_index, baseline: MODIFIER_BASELINES.BDI, weight: MODIFIER_WEIGHTS.BDI };
    }
    if (indexData.CTS && indexData.CTS.current_index) { // Предполагаем, что CTS возвращает current_index
      demandModifier *= (1 + MODIFIER_WEIGHTS.CTS * (indexData.CTS.current_index - MODIFIER_BASELINES.CTS) / MODIFIER_BASELINES.CTS);
      demandSources++;
      modifierStep.modifiersApplied.CTS = { value: indexData.CTS.current_index, baseline: MODIFIER_BASELINES.CTS, weight: MODIFIER_WEIGHTS.CTS };
    }
     if (demandSources > 0) {
      demandModifier = Math.max(0.9, Math.min(1.1, demandModifier)); // Ограничиваем модификатор +/- 10%
      modifiedRate *= demandModifier;
      modifierStep.modifiersApplied.Demand = { factor: demandModifier.toFixed(3), rateAfter: Math.round(modifiedRate) };
    }

    // 3.3 Модификатор ISTFIX (Intra-Asia)
    const originRegion = await getPortRegionById(originPortId);
    const destinationRegion = await getPortRegionById(destinationPortId);
    const isIntraAsia = (originRegion === 'Asia' || originRegion === 'China') && (destinationRegion === 'Asia' || destinationRegion === 'China');
    modifierStep.modifiersApplied.ISTFIX_Check = { isIntraAsia, originRegion, destinationRegion };

    if (isIntraAsia && indexData.ISTFIX && indexData.ISTFIX.current_index) {
      // Для Intra-Asia можно использовать ISTFIX с большим весом или даже заменить им core rate
      // Пример: смешиваем core rate и ISTFIX
      const istfixWeight = MODIFIER_WEIGHTS.ISTFIX;
      const coreWeight = 1.0; // Вес для уже рассчитанной ставки
      modifiedRate = (modifiedRate * coreWeight + indexData.ISTFIX.current_index * istfixWeight) / (coreWeight + istfixWeight);
      modifierStep.modifiersApplied.ISTFIX = { applied: true, value: indexData.ISTFIX.current_index, weight: istfixWeight, rateAfter: Math.round(modifiedRate) };
    } else if (isIntraAsia) {
       modifierStep.modifiersApplied.ISTFIX = { applied: false, reason: 'No ISTFIX data available' };
    } else {
       modifierStep.modifiersApplied.ISTFIX = { applied: false, reason: 'Not an Intra-Asia route' };
    }

    modifiedRate = Math.round(modifiedRate);
    modifierStep.finalRate = modifiedRate;
    if (debugMode) debugLog.push(modifierStep);

    // 4. Применение сезонности
    const seasonalityStep = { stage: 'Apply Seasonality', initialRate: modifiedRate, factor: 1.0, finalRate: null };
    try {
      const currentMonth = new Date().getMonth() + 1; // 1-12
      const seasonalityData = await seasonalityAnalyzer.getSeasonalityFactor(originRegion, destinationRegion, currentMonth);
      if (seasonalityData && seasonalityData.factor) {
        seasonalityStep.factor = seasonalityData.factor;
        modifiedRate *= seasonalityData.factor;
        seasonalityStep.details = `Fetched factor for ${originRegion}-${destinationRegion}, Month ${currentMonth}. Confidence: ${seasonalityData.confidence}.`;
      } else {
        seasonalityStep.details = `No seasonality factor found for ${originRegion}-${destinationRegion}, Month ${currentMonth}. Using 1.0.`;
      }
    } catch (error) {
      seasonalityStep.status = 'Error fetching/applying seasonality';
      seasonalityStep.error = error.message;
      console.error('Error applying seasonality:', error);
    }
    modifiedRate = Math.round(modifiedRate);
    seasonalityStep.finalRate = modifiedRate;
    if (debugMode) debugLog.push(seasonalityStep);

    // 5. Добавление топливной надбавки
    const fuelSurchargeStep = { stage: 'Add Fuel Surcharge', initialRate: modifiedRate, surcharge: 0, finalRate: null };
    let finalRateWithSurcharge = modifiedRate;
    try {
      // Используем ID портов напрямую
      const surchargeData = await fuelSurchargeCalculator.calculateFuelSurcharge(originPortId, destinationPortId, containerType);
      if (surchargeData && surchargeData.surcharge) {
        fuelSurchargeStep.surcharge = surchargeData.surcharge;
        finalRateWithSurcharge += surchargeData.surcharge;
        fuelSurchargeStep.details = `Calculated surcharge: ${surchargeData.surcharge}. Type: ${surchargeData.fuelType}. Price: ${surchargeData.fuelPrice}.`;
      } else {
         fuelSurchargeStep.details = 'No fuel surcharge calculated or returned.';
      }
    } catch (error) {
      fuelSurchargeStep.status = 'Error fetching/calculating fuel surcharge';
      fuelSurchargeStep.error = error.message;
      console.error('Error adding fuel surcharge:', error);
    }
    finalRateWithSurcharge = Math.round(finalRateWithSurcharge);
    fuelSurchargeStep.finalRate = finalRateWithSurcharge;
    if (debugMode) debugLog.push(fuelSurchargeStep);

    // 6. Расчет диапазона и надежности (улучшенный)
    const finalCalcStep = { stage: 'Final Calculation', baseRate: modifiedRate, finalRateWithSurcharge: finalRateWithSurcharge, minRate: 0, maxRate: 0, reliability: 0, sourcesUsed: [], sourceCount: 0 };

    const allSourcesUsed = [];
    const allRatesUsed = [];

    // Добавляем основные источники
    coreSourcesData.forEach(d => {
      allSourcesUsed.push(d.source);
      allRatesUsed.push(d.rate);
    });

    // Добавляем информацию о модификаторах, если они применялись
    if (modifierStep.modifiersApplied.Charter) allSourcesUsed.push('Charter Modifier');
    if (modifierStep.modifiersApplied.Demand) allSourcesUsed.push('Demand Modifier');
    if (modifierStep.modifiersApplied.ISTFIX?.applied) allSourcesUsed.push('ISTFIX');
    if (seasonalityStep.factor !== 1.0) allSourcesUsed.push('Seasonality');
    if (fuelSurchargeStep.surcharge > 0) allSourcesUsed.push('Fuel Surcharge');

    finalCalcStep.sourcesUsed = allSourcesUsed;
    finalCalcStep.sourceCount = allSourcesUsed.length; // Считаем все использованные источники после добавления всех источников

    // Расчет диапазона на основе стандартного отклонения *основных* индексов
    const coreStdDev = calculateStandardDeviation(coreSourcesData.map(d => d.rate));
    // Используем 'modifiedRate' (до топливной надбавки) как основу для диапазона
    finalCalcStep.minRate = Math.round(Math.max(modifiedRate - coreStdDev, modifiedRate * 0.85));
    finalCalcStep.maxRate = Math.round(Math.min(modifiedRate + coreStdDev, modifiedRate * 1.15));

    // Расчет надежности: база 0.7 + бонус за количество основных источников + бонус за согласованность
    const maxCoreSources = Object.keys(CORE_SOURCE_WEIGHTS).length;
    const sourceRatio = coreSourcesData.length / maxCoreSources;
    const cv = calculatedRate > 0 ? coreStdDev / calculatedRate : 0; // Коэфф. вариации основных индексов
    // Надежность от 0.7 до 1.0
    finalCalcStep.reliability = Math.round(Math.min(1.0, (0.7 + 0.15 * sourceRatio + 0.15 * (1 - Math.min(cv, 1.0)))) * 100) / 100;

    if (debugMode) debugLog.push(finalCalcStep);

    const endTime = Date.now();
    if (debugMode) {
       debugLog.push({ stage: 'End Calculation', durationMs: endTime - startTime, timestamp: new Date().toISOString() });
    }

    // Формирование итогового результата
    return {
      rate: modifiedRate, // Ставка до топливной надбавки
      minRate: finalCalcStep.minRate,
      maxRate: finalCalcStep.maxRate,
      fuelSurcharge: fuelSurchargeStep.surcharge,
      finalRate: finalRateWithSurcharge, // Итоговая ставка с надбавкой
      reliability: finalCalcStep.reliability,
      sourceCount: finalCalcStep.sourceCount, // Только основные источники
      sourcesUsed: finalCalcStep.sourcesUsed, // Все факторы
      debugLog: debugMode ? debugLog : undefined
    };

  } catch (error) {
    console.error('Critical error in calculateFreightRate:', error);
    if (debugMode) {
      debugLog.push({ stage: 'Critical Error', error: error.message, stack: error.stack });
    }
    // Возвращаем базовый расчет при критической ошибке
    const baseResult = calculateBaseRate(originPortId, destinationPortId, containerType, debugLog);
    return { ...baseResult, debugLog: debugMode ? debugLog : undefined };
  }
}

// Функция для обновления данных из всех источников (дополненная)
async function updateAllSourcesData() {
  console.log('Updating data from all sources...');
  const results = {};
  const sources = {
    SCFI: scfiScraper.fetchSCFIData,
    FBX: fbxScraper.fetchFBXData,
    WCI: wciScraper.fetchWCIData,
    BDI: bdiScraper.fetchBDIData,
    CCFI: ccfiScraper.fetchCCFIData,
    Harpex: harpexScraper.fetchHarpexData,
    NewConTex: contexScraper.fetchContexData,
    ISTFIX: istfixScraper.fetchISTFIXData,
    CTS: ctsScraper.fetchCTSData,
    FuelPrices: fuelSurchargeCalculator.fetchCurrentFuelPrices, // Обновляем и топливо
    Seasonality: seasonalityAnalyzer.analyzeSeasonalityFactors // И сезонность
  };

  const promises = Object.entries(sources).map(async ([name, fetchFunction]) => {
    try {
      const data = await fetchFunction();
      results[name] = { success: true, count: Array.isArray(data) ? data.length : (typeof data === 'object' ? Object.keys(data).length : 1) };
      console.log(`Successfully updated ${name}`);
    } catch (error) {
      results[name] = { success: false, error: error.message };
      console.error(`Error updating ${name}:`, error.message);
    }
  });

  await Promise.all(promises);
  console.log('All sources data update attempt finished.');
  return results;
}

// Экспорт функций
export default {
  calculateFreightRate,
  updateAllSourcesData
};
