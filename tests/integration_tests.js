// Интеграционные тесты для улучшенного калькулятора ставок фрахта
// Тестирует функциональность расширенной базы данных портов, поиска ближайших портов,
// запросов на добавление портов и верификации email

import assert from 'assert';
import fetch from 'node-fetch';
import dns from 'dns';
import { promisify } from 'util';

// Базовый URL для тестирования
const BASE_URL = 'http://localhost:3000';

// Промисифицированные функции DNS
const resolveMx = promisify(dns.resolveMx);
const lookup = promisify(dns.lookup);

// Тестовые данные
const TEST_DATA = {
  validEmail: 'test@example.com',
  invalidEmail: 'invalid@nonexistentdomain12345.com',
  disposableEmail: 'test@temp-mail.org',
  origin: 'CNSHA', // Shanghai
  destination: 'NLRTM', // Rotterdam
  containerType: '20DV',
  portRequest: {
    portName: 'Test Port',
    country: 'Test Country',
    region: 'Europe',
    requestReason: 'Testing port request functionality',
    userEmail: 'test@example.com'
  },
  coordinates: {
    latitude: 59.4427, // Tallinn coordinates
    longitude: 24.7536
  },
  searchQuery: 'tallinn'
};

// Функция для запуска всех тестов
async function runTests() {
  console.log('Запуск интеграционных тестов...');
  
  try {
    // Тест 1: Проверка доступности API
    await testApiAvailability();
    
    // Тест 2: Проверка расширенной базы данных портов
    await testExpandedPortDatabase();
    
    // Тест 3: Проверка поиска портов
    await testPortSearch();
    
    // Тест 4: Проверка поиска ближайших портов
    await testNearestPortSearch();
    
    // Тест 5: Проверка верификации email
    await testEmailVerification();
    
    // Тест 6: Проверка запроса на добавление порта
    await testPortRequest();
    
    // Тест 7: Проверка расчета ставки фрахта
    await testFreightRateCalculation();
    
    console.log('Все тесты успешно пройдены!');
  } catch (error) {
    console.error('Ошибка при выполнении тестов:', error);
    process.exit(1);
  }
}

// Тест 1: Проверка доступности API
async function testApiAvailability() {
  console.log('Тест 1: Проверка доступности API...');
  
  try {
    const response = await fetch(`${BASE_URL}/api/health`);
    const data = await response.json();
    
    assert.strictEqual(response.status, 200, 'API должен возвращать статус 200');
    assert.strictEqual(data.status, 'operational', 'API должен быть в рабочем состоянии');
    
    console.log('✓ API доступен и работает');
  } catch (error) {
    console.error('✗ Ошибка при проверке доступности API:', error);
    throw error;
  }
}

// Тест 2: Проверка расширенной базы данных портов
async function testExpandedPortDatabase() {
  console.log('Тест 2: Проверка расширенной базы данных портов...');
  
  try {
    const response = await fetch(`${BASE_URL}/api/ports`);
    const ports = await response.json();
    
    assert.strictEqual(response.status, 200, 'API должен возвращать статус 200');
    assert(Array.isArray(ports), 'Ответ должен быть массивом');
    assert(ports.length > 50, 'База данных должна содержать более 50 портов');
    
    // Проверка наличия порта Таллинн
    const tallinn = ports.find(port => port.name === 'Tallinn');
    assert(tallinn, 'В базе данных должен быть порт Таллинн');
    assert.strictEqual(tallinn.country, 'Estonia', 'Порт Таллинн должен быть в Эстонии');
    
    // Проверка наличия географических координат
    assert(tallinn.latitude, 'Порт должен иметь координату широты');
    assert(tallinn.longitude, 'Порт должен иметь координату долготы');
    
    console.log(`✓ База данных содержит ${ports.length} портов, включая Таллинн`);
  } catch (error) {
    console.error('✗ Ошибка при проверке базы данных портов:', error);
    throw error;
  }
}

// Тест 3: Проверка поиска портов
async function testPortSearch() {
  console.log('Тест 3: Проверка поиска портов...');
  
  try {
    const response = await fetch(`${BASE_URL}/api/ports/search?query=${TEST_DATA.searchQuery}`);
    const results = await response.json();
    
    assert.strictEqual(response.status, 200, 'API должен возвращать статус 200');
    assert(Array.isArray(results), 'Результаты поиска должны быть массивом');
    assert(results.length > 0, 'Поиск должен вернуть хотя бы один результат');
    
    // Проверка результатов поиска
    const tallinn = results.find(port => port.name === 'Tallinn');
    assert(tallinn, 'Результаты поиска должны включать порт Таллинн');
    
    console.log(`✓ Поиск портов работает корректно, найдено ${results.length} результатов`);
  } catch (error) {
    console.error('✗ Ошибка при проверке поиска портов:', error);
    throw error;
  }
}

// Тест 4: Проверка поиска ближайших портов
async function testNearestPortSearch() {
  console.log('Тест 4: Проверка поиска ближайших портов...');
  
  try {
    const { latitude, longitude } = TEST_DATA.coordinates;
    const response = await fetch(`${BASE_URL}/api/ports/nearest?latitude=${latitude}&longitude=${longitude}`);
    const results = await response.json();
    
    assert.strictEqual(response.status, 200, 'API должен возвращать статус 200');
    assert(Array.isArray(results), 'Результаты поиска должны быть массивом');
    assert(results.length > 0, 'Поиск должен вернуть хотя бы один результат');
    
    // Проверка, что первый результат - Таллинн (так как мы используем координаты Таллинна)
    assert.strictEqual(results[0].name, 'Tallinn', 'Первый результат должен быть портом Таллинн');
    
    // Проверка, что результаты отсортированы по расстоянию
    assert(results[0].distance < results[1].distance, 'Результаты должны быть отсортированы по расстоянию');
    
    console.log(`✓ Поиск ближайших портов работает корректно, найдено ${results.length} результатов`);
  } catch (error) {
    console.error('✗ Ошибка при проверке поиска ближайших портов:', error);
    throw error;
  }
}

// Тест 5: Проверка верификации email
async function testEmailVerification() {
  console.log('Тест 5: Проверка верификации email...');
  
  try {
    // Тест валидного email
    const validResponse = await fetch(`${BASE_URL}/api/validate-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_DATA.validEmail })
    });
    const validResult = await validResponse.json();
    
    assert.strictEqual(validResponse.status, 200, 'API должен возвращать статус 200');
    assert(validResult.isValid, 'Валидный email должен проходить проверку');
    
    // Тест одноразового email
    const disposableResponse = await fetch(`${BASE_URL}/api/validate-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_DATA.disposableEmail })
    });
    const disposableResult = await disposableResponse.json();
    
    assert.strictEqual(disposableResponse.status, 200, 'API должен возвращать статус 200');
    assert(!disposableResult.isValid, 'Одноразовый email не должен проходить проверку');
    
    console.log('✓ Верификация email работает корректно');
  } catch (error) {
    console.error('✗ Ошибка при проверке верификации email:', error);
    throw error;
  }
}

// Тест 6: Проверка запроса на добавление порта
async function testPortRequest() {
  console.log('Тест 6: Проверка запроса на добавление порта...');
  
  try {
    const response = await fetch(`${BASE_URL}/api/ports/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(TEST_DATA.portRequest)
    });
    const result = await response.json();
    
    assert.strictEqual(response.status, 200, 'API должен возвращать статус 200');
    assert(result.success, 'Запрос должен быть успешно обработан');
    assert(result.requestId, 'Ответ должен содержать ID запроса');
    
    console.log('✓ Запрос на добавление порта работает корректно');
  } catch (error) {
    console.error('✗ Ошибка при проверке запроса на добавление порта:', error);
    throw error;
  }
}

// Тест 7: Проверка расчета ставки фрахта
async function testFreightRateCalculation() {
  console.log('Тест 7: Проверка расчета ставки фрахта...');
  
  try {
    const response = await fetch(`${BASE_URL}/api/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: TEST_DATA.origin,
        destination: TEST_DATA.destination,
        containerType: TEST_DATA.containerType,
        email: TEST_DATA.validEmail
      })
    });
    const result = await response.json();
    
    assert.strictEqual(response.status, 200, 'API должен возвращать статус 200');
    assert(result.rate, 'Результат должен содержать ставку');
    assert(result.min_rate, 'Результат должен содержать минимальную ставку');
    assert(result.max_rate, 'Результат должен содержать максимальную ставку');
    assert(result.currency, 'Результат должен содержать валюту');
    assert(Array.isArray(result.sources), 'Результат должен содержать список источников');
    
    // Проверка диапазона ставок
    assert(result.min_rate <= result.rate, 'Минимальная ставка должна быть меньше или равна средней');
    assert(result.rate <= result.max_rate, 'Средняя ставка должна быть меньше или равна максимальной');
    
    console.log('✓ Расчет ставки фрахта работает корректно');
  } catch (error) {
    console.error('✗ Ошибка при проверке расчета ставки фрахта:', error);
    throw error;
  }
}

// Запуск тестов
runTests();
