#!/usr/bin/env node
// =============================================
// IMPORT CSV DATA INTO ORACLE AUTONOMOUS DB
// =============================================
// Usage: node scripts/import-oracle.js
//
// Requires ORACLE_CONNECTION_STRING, ORACLE_USER, ORACLE_PASSWORD in .env
// Get these from Oracle Cloud → ATP → DB Connection

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const oracledb = require('oracledb');
const fs = require('fs');
const readline = require('readline');
const path = require('path');

const CSV_PATH = fs.existsSync(path.join(__dirname, '..', 'data', 'pornhub.com-db.csv'))
  ? path.join(__dirname, '..', 'data', 'pornhub.com-db.csv')
  : path.join(__dirname, '..', 'data', 'pornhub.com-db.sample.csv');

async function main() {
  console.log('=============================================');
  console.log(' Oracle Database Import');
  console.log('=============================================');
  console.log(` CSV: ${CSV_PATH}`);
  console.log(` Oracle: ${process.env.ORACLE_CONNECTION_STRING}`);
  console.log('');

  const pool = await oracledb.createPool({
    connectString: process.env.ORACLE_CONNECTION_STRING,
    user: process.env.ORACLE_USER || 'admin',
    password: process.env.ORACLE_PASSWORD,
    poolMin: 1,
    poolMax: 3,
  });

  const conn = await pool.getConnection();

  try {
    // Drop existing table (ignore error if not exists)
    try {
      await conn.execute('DROP TABLE videos');
      console.log('Dropped existing videos table');
    } catch (e) {
      if (e.errorNum !== 942) throw e; // ORA-00942: table or view does not exist
    }

    // Create table
    await conn.execute(`
      CREATE TABLE videos (
        embed CLOB,
        thumbnail CLOB,
        thumbnails CLOB,
        title VARCHAR2(2000),
        tags CLOB,
        categories VARCHAR2(2000),
        pornstar VARCHAR2(500),
        duration NUMBER DEFAULT 0,
        views NUMBER DEFAULT 0,
        rating NUMBER DEFAULT 0
      )
    `);
    console.log('Created videos table');

    // Read CSV
    const rl = readline.createInterface({
      input: fs.createReadStream(CSV_PATH),
      crlfDelay: Infinity,
    });

    let count = 0;
    const BATCH = 50;
    let batch = [];

    for await (const line of rl) {
      const cols = line.split('|');
      batch.push([
        cols[0] || '',
        (cols[1] || '').split(';')[0],
        (cols[1] || '').split(';').filter(Boolean).join(';'),
        cols[3] || '',
        (cols[4] || '').split(';').filter(Boolean).join(';'),
        cols[5] || '',
        cols[6] || '',
        parseInt(cols[7]) || 0,
        parseInt(cols[8]) || 0,
        parseFloat(cols[9]) || 0,
      ]);

      if (batch.length >= BATCH) {
        await insertBatch(conn, batch);
        count += batch.length;
        process.stdout.write(`\r  Inserted ${count} rows...`);
        batch = [];
      }
    }

    if (batch.length > 0) {
      await insertBatch(conn, batch);
      count += batch.length;
    }

    console.log(`\n\nDone! Total rows: ${count}`);
  } finally {
    await conn.close();
    await pool.close();
  }
}

async function insertBatch(conn, rows) {
  const sql = `INSERT INTO videos (embed, thumbnail, thumbnails, title, tags, categories, pornstar, duration, views, rating)
               VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, :10)`;
  for (const row of rows) {
    await conn.execute(sql, row);
  }
  await conn.commit();
}

main().catch(e => {
  console.error('\nImport failed:', e.message);
  process.exit(1);
});
