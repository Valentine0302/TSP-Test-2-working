// Скрипт для заполнения таблицы портов данными
import pg from 'pg';
import dotenv from 'dotenv';
import EXPANDED_PORTS from './data/expanded_ports.js';

// Загрузка переменных окружения
dotenv.config();

// Подключение к базе данных
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Функция для заполнения таблицы портов
async function populatePorts() {
  try {
    console.log('Начало заполнения таблицы портов...');
    
    // Очистка таблицы портов
    await pool.query('DELETE FROM ports');
    console.log('Таблица портов очищена');
    
    // Вставка расширенного списка портов
    let insertedCount = 0;
    for (const port of EXPANDED_PORTS) {
      try {
        await pool.query(
          `INSERT INTO ports (id, name, country, region, latitude, longitude, popularity) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE 
           SET name = $2, country = $3, region = $4, latitude = $5, longitude = $6, popularity = $7`,
          [
            port.id,
            port.name,
            port.country,
            port.region,
            port.latitude,
            port.longitude,
            port.popularity
          ]
        );
        insertedCount++;
      } catch (error) {
        console.error(`Ошибка при добавлении порта ${port.name}:`, error);
      }
    }
    console.log(`Добавлено ${insertedCount} портов в базу данных`);
    
    // Проверка, что порты действительно добавлены
    const finalPortsResult = await pool.query('SELECT COUNT(*) FROM ports');
    console.log(`Итоговое количество портов в базе данных: ${finalPortsResult.rows[0].count}`);
    
    // Вывод первых 5 портов для проверки
    const samplePorts = await pool.query('SELECT * FROM ports LIMIT 5');
    console.log('Примеры портов в базе данных:');
    console.log(samplePorts.rows);

    console.log('Заполнение таблицы портов завершено успешно');
    return { success: true, message: 'Таблица портов заполнена успешно' };
  } catch (error) {
    console.error('Ошибка при заполнении таблицы портов:', error);
    return { success: false, error: error.message };
  } finally {
    // Закрытие соединения с базой данных
    await pool.end();
  }
}

// Запуск заполнения таблицы портов
populatePorts()
  .then(result => {
    console.log(result);
    process.exit(0);
  })
  .catch(error => {
    console.error('Критическая ошибка:', error);
    process.exit(1);
  });
