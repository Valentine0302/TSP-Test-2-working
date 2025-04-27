// Модуль для автоматического добавления портов при запуске сервера
// Этот файл должен быть импортирован в основной server.js

import fs from 'fs';
import { Pool } from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function addPorts() {
  try {
    console.log('Начало добавления портов...');
    const sqlFile = path.join(__dirname, 'add_ports.sql');
    
    if (fs.existsSync(sqlFile)) {
      const sql = fs.readFileSync(sqlFile, 'utf8');
      await pool.query(sql);
      console.log('Порты успешно добавлены');
    } else {
      console.log('Файл add_ports.sql не найден');
    }
  } catch (error) {
    console.error('Ошибка при добавлении портов:', error);
  }
}

export default addPorts;
