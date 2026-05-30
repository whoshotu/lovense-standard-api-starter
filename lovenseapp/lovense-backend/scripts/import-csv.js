// Import CSV into PostgreSQL
// Usage: node scripts/import-csv.js [path-to-csv] [limit-rows]
// Example: node scripts/import-csv.js data/pornhub.com-db.csv 1000000

require('dotenv').config({ path: __dirname + '/../.env' });
const fs = require('fs');
const readline = require('readline');
const path = require('path');
const { Pool } = require('pg');

const csvPath = process.argv[2] || path.join(__dirname, '..', 'data', 'pornhub.com-db.csv');
const maxRows = parseInt(process.argv[3]) || 1000000;

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL env var not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('render.com') ? { rejectUnauthorized: false } : false,
});

async function run() {
  console.log(`Importing from: ${csvPath}`);
  console.log(`Max rows: ${maxRows}`);

  // Create table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS videos (
      id SERIAL PRIMARY KEY,
      embed TEXT,
      thumbnail TEXT,
      title TEXT,
      tags TEXT,
      categories TEXT,
      pornstar TEXT,
      duration INTEGER,
      views INTEGER,
      rating REAL
    );
  `);
  console.log('Table ready');

  // Clear existing data
  await pool.query('TRUNCATE videos');
  console.log('Table truncated');

  // Stream CSV
  const rl = readline.createInterface({ input: fs.createReadStream(csvPath), crlfDelay: Infinity });
  let count = 0;
  let batch = [];

  const insertBatch = async () => {
    if (batch.length === 0) return;
    const values = batch.map((_, i) =>
      `($${i * 9 + 1}, $${i * 9 + 2}, $${i * 9 + 3}, $${i * 9 + 4}, $${i * 9 + 5}, $${i * 9 + 6}, $${i * 9 + 7}, $${i * 9 + 8}, $${i * 9 + 9})`
    ).join(',');
    const flatParams = batch.flat();
    await pool.query(
      `INSERT INTO videos (embed, thumbnail, title, tags, categories, pornstar, duration, views, rating) VALUES ${values}`,
      flatParams
    );
    batch = [];
  };

  for await (const line of rl) {
    const cols = line.split('|');
    batch.push([
      cols[0] || '',
      (cols[1] || '').split(';')[0],
      cols[3] || '',
      cols[4] || '',
      cols[5] || '',
      cols[6] || '',
      parseInt(cols[7]) || 0,
      parseInt(cols[8]) || 0,
      parseFloat(cols[9]) || 0,
    ]);
    count++;

    if (batch.length >= 500) {
      await insertBatch();
      if (count % 5000 === 0) console.log(`  imported ${count} rows...`);
    }

    if (count >= maxRows) break;
  }

  if (batch.length > 0) await insertBatch();

  // Create indexes
  console.log('Creating indexes...');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_videos_title ON videos (title text_pattern_ops)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_videos_views ON videos (views DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_videos_rating ON videos (rating DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_videos_duration ON videos (duration)');

  console.log(`Done! Imported ${count} rows`);
  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });