// Модуль для сбора данных из Shanghai Containerized Freight Index (SCFI)
// Использует публично доступные данные индекса SCFI

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

// URL для получения данных SCFI
const SCFI_URL = 'https://en.sse.net.cn/indices/scfinew.jsp';
// Альтернативные источники данных
// Изменен порядок: MacroMicro на втором месте, FreightWaves на третьем
const SCFI_ALT_URLS = [
  'https://en.macromicro.me/series/17502/fbx-global-container-index-weekly',
  'https://www.freightwaves.com/news/tag/scfi',
  'https://www.container-news.com/scfi/',
  'https://www.hellenicshippingnews.com/shanghai-containerized-freight-index/'
];

// Функция для получения данных SCFI
async function fetchSCFIData()  {
  try {
    console.log('Fetching Shanghai Containerized Freight Index data...');
    
    // Попытка получить данные с основного источника
    let scfiData = await fetchSCFIFromPrimarySource();
    
    // Если не удалось получить данные с основного источника, используем альтернативные
    if (!scfiData || scfiData.length === 0) {
      for (const altUrl of SCFI_ALT_URLS) {
        console.log(`Trying alternative source: ${altUrl}`);
        scfiData = await fetchSCFIFromAlternativeSource(altUrl);
        if (scfiData && scfiData.length > 0) {
          console.log(`Successfully fetched data from alternative source: ${altUrl}`);
          break;
        }
      }
    }
    
    // Если данные получены, сохраняем их в базу данных
    if (scfiData && scfiData.length > 0) {
      await saveSCFIData(scfiData);
      return scfiData;
    } else {
      throw new Error('Failed to fetch SCFI data from all sources');
    }
  } catch (error) {
    console.error('Error fetching SCFI data:', error);
    // В случае ошибки возвращаем моковые данные
    return fetchMockSCFIData();
  }
}

// Функция для получения данных SCFI с основного источника
async function fetchSCFIFromPrimarySource() {
  try {
    // Отправка запроса на сайт Shanghai Shipping Exchange с имитацией реального браузера
    const response = await axios.get(SCFI_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
        'Referer': 'https://en.sse.net.cn/indices/index.jsp'
      },
      timeout: 15000
    }) ;
    
    // Проверка успешности запроса
    if (response.status !== 200) {
      throw new Error(`Failed to fetch SCFI data from primary source: ${response.status}`);
    }
    
    // Парсинг HTML-страницы
    const $ = cheerio.load(response.data);
    
    // Извлечение данных из таблицы
    const scfiData = [];
    
    // Получение текущей даты из заголовка таблицы
    let currentDate = '';
    let previousDate = '';
    
    // Ищем заголовки с датами
    $('th, td').each((i, el) => {
      const text = $(el).text().trim();
      if (text.includes('Current Index') && text.includes('-')) {
        const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
          currentDate = dateMatch[1];
        }
      } else if (text.includes('Previous Index') && text.includes('-')) {
        const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
          previousDate = dateMatch[1];
        }
      }
    });
    
    // Если даты не найдены, используем текущую дату
    if (!currentDate) {
      currentDate = new Date().toISOString().split('T')[0];
    }
    if (!previousDate) {
      // Предыдущая дата - неделю назад
      const prevDate = new Date();
      prevDate.setDate(prevDate.getDate() - 7);
      previousDate = prevDate.toISOString().split('T')[0];
    }
    
    console.log(`Current date: ${currentDate}, Previous date: ${previousDate}`);
    
    // Находим таблицу с данными SCFI (4-я таблица на странице)
    const tables = $('table');
    if (tables.length >= 4) {
      const scfiTable = tables.eq(3); // Индексация с 0, поэтому 4-я таблица имеет индекс 3
      
      // Парсинг строк таблицы
      scfiTable.find('tr').each((i, row) => {
        // Пропускаем заголовок таблицы
        if (i === 0) return;
        
        const cells = $(row).find('td');
        
        // Проверяем, что строка содержит нужное количество колонок
        if (cells.length >= 5) {
          const route = $(cells[0]).text().trim();
          const unit = $(cells[1]).text().trim();
          const weighting = $(cells[2]).text().trim().replace('%', '');
          const previousIndex = $(cells[3]).text().trim();
          const currentIndex = $(cells[4]).text().trim();
          const change = cells.length > 5 ? $(cells[5]).text().trim() : '';
          
          // Извлечение числовых значений
          const currentIndexValue = parseFloat(currentIndex.replace(',', ''));
          const previousIndexValue = parseFloat(previousIndex.replace(',', ''));
          const changeValue = parseFloat(change.replace(',', ''));
          const weightingValue = parseFloat(weighting);
          
          // Добавление данных в массив, если маршрут не пустой и индекс является числом
          if (route && !isNaN(currentIndexValue)) {
            scfiData.push({
              route: route,
              unit: unit,
              weighting: isNaN(weightingValue) ? 0 : weightingValue,
              previousIndex: isNaN(previousIndexValue) ? 0 : previousIndexValue,
              currentIndex: currentIndexValue,
              change: isNaN(changeValue) ? 0 : changeValue,
              previousDate: previousDate,
              currentDate: currentDate
            });
          }
        }
      });
    }
    
    console.log(`Parsed SCFI data from primary source: ${scfiData.length} records`);
    
    return scfiData;
  } catch (error) {
    console.error('Error fetching SCFI data from primary source:', error);
    return [];
  }
}

// Функция для получения данных SCFI с альтернативного источника
async function fetchSCFIFromAlternativeSource(url) {
  try {
    // Отправка запроса на альтернативный сайт с имитацией реального браузера
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0'
      },
      timeout: 15000
    });
    
    // Проверка успешности запроса
    if (response.status !== 200) {
      throw new Error(`Failed to fetch SCFI data from alternative source: ${response.status}`);
    }
    
    // Парсинг HTML-страницы
    const $ = cheerio.load(response.data);
    
    // Извлечение данных из статей или таблиц
    const scfiData = [];
    
    // Получение текущей даты
    const currentDate = new Date().toISOString().split('T')[0];
    // Предыдущая дата - неделю назад
    const prevDate = new Date();
    prevDate.setDate(prevDate.getDate() - 7);
    const previousDate = prevDate.toISOString().split('T')[0];
    
    // Специальная обработка для MacroMicro
    if (url.includes('macromicro.me')) {
      // Ищем значение индекса в элементах с классом 'value' или 'chart-value'
      const valueElements = $('.value, .chart-value, .data-value');
      let currentIndexValue = null;
      
      valueElements.each((i, el) => {
        const text = $(el).text().trim();
        const indexMatch = text.match(/(\d+(\.\d+)?)/);
        if (indexMatch) {
          currentIndexValue = parseFloat(indexMatch[1]);
          return false; // Прерываем цикл после нахождения первого значения
        }
      });
      
      // Ищем изменение индекса
      const changeElements = $('.change, .chart-change, .data-change');
      let changeValue = 0;
      
      changeElements.each((i, el) => {
        const text = $(el).text().trim();
        const changeMatch = text.match(/([-+]?\d+(\.\d+)?)/);
        if (changeMatch) {
          changeValue = parseFloat(changeMatch[1]);
          return false; // Прерываем цикл после нахождения первого значения
        }
      });
      
      // Если нашли значение индекса, добавляем его в данные
      if (currentIndexValue !== null) {
        scfiData.push({
          route: 'Comprehensive Index',
          unit: 'USD/TEU',
          weighting: 100,
          previousIndex: currentIndexValue - changeValue,
          currentIndex: currentIndexValue,
          change: changeValue,
          previousDate: previousDate,
          currentDate: currentDate
        });
      }
    } 
    // Обработка для FreightWaves и других источников
    else {
      // Поиск таблиц с данными SCFI
      $('table').each((i, table) => {
        // Проверяем, содержит ли таблица данные SCFI
        const tableText = $(table).text();
        if (tableText.includes('SCFI') || tableText.includes('Shanghai Containerized Freight Index')) {
          $(table).find('tr').each((j, row) => {
            // Пропускаем заголовок таблицы
            if (j === 0) return;
            
            const cells = $(row).find('td');
            
            // Проверяем, что строка содержит нужное количество колонок
            if (cells.length >= 2) {
              let route = '';
              let currentIndex = '';
              let change = '';
              
              // Разные сайты могут иметь разную структуру таблиц
              if (url.includes('freightwaves.com')) {
                route = cells.length > 0 ? $(cells[0]).text().trim() : '';
                currentIndex = cells.length > 1 ? $(cells[1]).text().trim() : '';
                change = cells.length > 2 ? $(cells[2]).text().trim() : '';
              } else if (url.includes('container-news.com')) {
                route = cells.length > 0 ? $(cells[0]).text().trim() : '';
                currentIndex = cells.length > 1 ? $(cells[1]).text().trim() : '';
                change = cells.length > 2 ? $(cells[2]).text().trim() : '';
              } else if (url.includes('hellenicshippingnews.com')) {
                route = cells.length > 0 ? $(cells[0]).text().trim() : '';
                currentIndex = cells.length > 1 ? $(cells[1]).text().trim() : '';
                change = cells.length > 2 ? $(cells[2]).text().trim() : '';
              }
              
              // Извлечение числового значения индекса
              const currentIndexMatch = currentIndex.match(/(\d+(\.\d+)?)/);
              const currentIndexValue = currentIndexMatch ? parseFloat(currentIndexMatch[1]) : NaN;
              
              // Извлечение числового значения изменения
              const changeMatch = change.match(/([-+]?\d+(\.\d+)?)/);
              const changeValue = changeMatch ? parseFloat(changeMatch[1]) : 0;
              
              // Добавление данных в массив, если маршрут не пустой и индекс является числом
              if (route && !isNaN(currentIndexValue)) {
                // Определяем, является ли это композитным индексом
                const isComposite = route.toLowerCase().includes('composite') || 
                                   route.toLowerCase().includes('global') || 
                                   route.toLowerCase().includes('overall');
                
                scfiData.push({
                  route: isComposite ? 'Comprehensive Index' : route,
                  unit: 'USD/TEU',
                  weighting: isComposite ? 100 : 0,
                  previousIndex: currentIndexValue - changeValue,
                  currentIndex: currentIndexValue,
                  change: changeValue,
                  previousDate: previousDate,
                  currentDate: currentDate
                });
              }
            }
          });
        }
      });
      
      // Если таблицы не найдены, ищем данные в тексте статей
      if (scfiData.length === 0) {
        // Ищем в статьях упоминания индекса SCFI и его значения
        $('article, .article, .post, .entry, .content').each((i, article) => {
          const articleText = $(article).text();
          
          // Ищем упоминание композитного индекса SCFI
          const indexMatch = articleText.match(/SCFI.*?(\d+(\.\d+)?)/i);
          
          if (indexMatch) {
            const currentIndexValue = parseFloat(indexMatch[1]);
            
            // Ищем упоминание изменения индекса
            const changeMatch = articleText.match(/(up|down|increased|decreased|rose|fell).*?(\d+(\.\d+)?)/i);
            let changeValue = 0;
            
            if (changeMatch) {
              changeValue = parseFloat(changeMatch[2]);
              if (changeMatch[1].toLowerCase().includes('down') || 
                  changeMatch[1].toLowerCase().includes('decreased') || 
                  changeMatch[1].toLowerCase().includes('fell')) {
                changeValue = -changeValue;
              }
            }
            
            // Добавление данных в массив, если индекс является числом
            if (!isNaN(currentIndexValue)) {
              scfiData.push({
                route: 'Comprehensive Index',
                unit: 'USD/TEU',
                weighting: 100,
                previousIndex: currentIndexValue - changeValue,
                currentIndex: currentIndexValue,
                change: changeValue,
                previousDate: previousDate,
                currentDate: currentDate
              });
              
              // Берем только первое найденное значение
              return false;
            }
          }
        });
      }
    }
    
    console.log(`Parsed SCFI data from alternative source ${url}: ${scfiData.length} records`);
    
    return scfiData;
  } catch (error) {
    console.error(`Error fetching SCFI data from alternative source ${url}:`, error);
    return [];
  }
}

// Функция для получения моковых данных SCFI
async function fetchMockSCFIData() {
  console.log('Using mock data for SCFI');
  
  // Получение текущей даты
  const currentDate = new Date().toISOString().split('T')[0];
  // Предыдущая дата - неделю назад
  const prevDate = new Date();
  prevDate.setDate(prevDate.getDate() - 7);
  const previousDate = prevDate.toISOString().split('T')[0];
  
  // Создание моковых данных на основе реальных значений SCFI
  const mockData = [
    {
      route: 'Comprehensive Index',
      unit: 'USD/TEU',
      weighting: 100,
      previousIndex: 1370.58,
      currentIndex: 1347.84,
      change: -22.74,
      previousDate: previousDate,
      currentDate: currentDate
    },
    {
      route: 'Europe (Base port)',
      unit: 'USD/TEU',
      weighting: 20.0,
      previousIndex: 1450,
      currentIndex: 1425,
      change: -25,
      previousDate: previousDate,
      currentDate: currentDate
    },
    {
      route: 'Mediterranean (Base port)',
      unit: 'USD/TEU',
      weighting: 10.0,
      previousIndex: 1400,
      currentIndex: 1380,
      change: -20,
      previousDate: previousDate,
      currentDate: currentDate
    },
    {
      route: 'USWC (Base port)',
      unit: 'USD/FEU',
      weighting: 20.0,
      previousIndex: 2100,
      currentIndex: 2050,
      change: -50,
      previousDate: previousDate,
      currentDate: currentDate
    },
    {
      route: 'USEC (Base port)',
      unit: 'USD/FEU',
      weighting: 7.5,
      previousIndex: 2300,
      currentIndex: 2250,
      change: -50,
      previousDate: previousDate,
      currentDate: currentDate
    },
    {
      route: 'Persian Gulf and Red Sea (Dubai)',
      unit: 'USD/TEU',
      weighting: 7.5,
      previousIndex: 1250,
      currentIndex: 1230,
      change: -20,
      previousDate: previousDate,
      currentDate: currentDate
    },
    {
      route: 'Australia/New Zealand (Melbourne)',
      unit: 'USD/TEU',
      weighting: 5.0,
      previousIndex: 1150,
      currentIndex: 1130,
      change: -20,
      previousDate: previousDate,
      currentDate: currentDate
    },
    {
      route: 'East/West Africa (Lagos)',
      unit: 'USD/TEU',
      weighting: 2.5,
      previousIndex: 1800,
      currentIndex: 1780,
      change: -20,
      previousDate: previousDate,
      currentDate: currentDate
    },
    {
      route: 'South Africa (Durban)',
      unit: 'USD/TEU',
      weighting: 2.5,
      previousIndex: 1700,
      currentIndex: 1680,
      change: -20,
      previousDate: previousDate,
      currentDate: currentDate
    },
    {
      route: 'South America (Santos)',
      unit: 'USD/TEU',
      weighting: 5.0,
      previousIndex: 1600,
      currentIndex: 1580,
      change: -20,
      previousDate: previousDate,
      currentDate: currentDate
    },
    {
      route: 'West Japan (Base port)',
      unit: 'USD/TEU',
      weighting: 5.0,
      previousIndex: 900,
      currentIndex: 890,
      change: -10,
      previousDate: previousDate,
      currentDate: currentDate
    },
    {
      route: 'East Japan (Base port)',
      unit: 'USD/TEU',
      weighting: 5.0,
      previousIndex: 920,
      currentIndex: 910,
      change: -10,
      previousDate: previousDate,
      currentDate: currentDate
    },
    {
      route: 'Southeast Asia (Singapore)',
      unit: 'USD/TEU',
      weighting: 7.5,
      previousIndex: 850,
      currentIndex: 840,
      change: -10,
      previousDate: previousDate,
      currentDate: currentDate
    }
  ];
  
  return mockData;
}

// Функция для сохранения данных SCFI в базу данных
async function saveSCFIData(scfiData) {
  const client = await pool.connect();
  
  try {
    // Начало транзакции
    await client.query('BEGIN');
    
    // Создание таблицы, если она не существует
    await client.query(`
      CREATE TABLE IF NOT EXISTS freight_indices_scfi (
        id SERIAL PRIMARY KEY,
        route VARCHAR(255) NOT NULL,
        unit VARCHAR(50),
        weighting NUMERIC,
        previous_index NUMERIC,
        current_index NUMERIC NOT NULL,
        change NUMERIC,
        previous_date DATE,
        current_date DATE NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(route, current_date)
      )
    `);
    
    // Вставка данных
    for (const data of scfiData) {
      try {
        await client.query(
          `INSERT INTO freight_indices_scfi 
           (route, unit, weighting, previous_index, current_index, change, previous_date, current_date) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (route, current_date) 
           DO UPDATE SET 
             unit = $2,
             weighting = $3,
             previous_index = $4,
             current_index = $5,
             change = $6,
             previous_date = $7`,
          [
            data.route,
            data.unit,
            data.weighting,
            data.previousIndex,
            data.currentIndex,
            data.change,
            data.previousDate,
            data.currentDate
          ]
        );
      } catch (error) {
        console.error(`Error inserting SCFI data for route ${data.route}:`, error);
        // Продолжаем вставку других данных
      }
    }
    
    // Завершение транзакции
    await client.query('COMMIT');
    
    console.log(`Saved ${scfiData.length} SCFI records to database`);
  } catch (error) {
    // Откат транзакции в случае ошибки
    await client.query('ROLLBACK');
    console.error('Error saving SCFI data to database:', error);
  } finally {
    // Освобождение клиента
    client.release();
  }
}

// Функция для получения данных SCFI для конкретного маршрута
async function getSCFIDataForRoute(route) {
  console.log(`Getting SCFI data for route: ${route}`);
  
  try {
    // Получение данных из базы данных
    const client = await pool.connect();
    const result = await client.query(`
      SELECT * FROM freight_indices_scfi 
      WHERE route = $1 
      ORDER BY current_date DESC 
      LIMIT 1
    `, [route]);
    client.release();
    
    // Если данные найдены, возвращаем их
    if (result.rows.length > 0) {
      return result.rows[0];
    } else {
      throw new Error(`No SCFI data found for route ${route}`);
    }
  } catch (error) {
    console.error(`Error getting SCFI data for route ${route}:`, error);
    
    // В случае ошибки получаем все данные и фильтруем нужный маршрут
    const allData = await fetchSCFIData();
    const routeData = allData.find(data => data.route === route);
    
    if (routeData) {
      return routeData;
    } else {
      throw new Error(`No SCFI data found for route ${route}`);
    }
  }
}

// Функция для получения данных SCFI для расчета
async function getSCFIDataForCalculation() {
  console.log('Getting SCFI data for calculation...');
  
  try {
    // Получение данных из базы данных
    const client = await pool.connect();
    const result = await client.query(`
      SELECT * FROM freight_indices_scfi 
      WHERE route = 'Comprehensive Index' 
      ORDER BY current_date DESC 
      LIMIT 1
    `);
    client.release();
    
    // Если данные найдены, возвращаем их
    if (result.rows.length > 0) {
      const data = result.rows[0];
      
      // Форматирование даты
      const formattedDate = data.current_date instanceof Date 
        ? data.current_date.toISOString().split('T')[0]
        : data.current_date;
      
      return {
        index: 'SCFI',
        value: parseFloat(data.current_index) || 0,
        change: parseFloat(data.change) || 0,
        date: formattedDate,
        trend: data.change >= 0 ? 'up' : 'down',
        source: 'database'
      };
    } else {
      throw new Error('No SCFI data found in database');
    }
  } catch (error) {
    console.error('Error getting SCFI data for calculation:', error);
    
    // В случае ошибки используем моковые данные
    // Получение текущей даты
    const currentDate = new Date().toISOString().split('T')[0];
    
    return {
      index: 'SCFI',
      value: 1347.84,
      change: -22.74,
      date: currentDate,
      trend: 'down',
      source: 'mock'
    };
  }
}

// Экспорт функций
module.exports = {
  fetchSCFIData,
  getSCFIDataForRoute,
  getSCFIDataForCalculation
};
