const oracledb = require('oracledb');

let oraclePool = null;
let pgPool = null;

function getDbType() {
  if (process.env.ORACLE_CONNECTION_STRING) return 'oracle';
  if (process.env.DATABASE_URL) return 'postgresql';
  return null;
}

async function getOraclePool() {
  if (!oraclePool && process.env.ORACLE_CONNECTION_STRING) {
    oraclePool = await oracledb.createPool({
      connectString: process.env.ORACLE_CONNECTION_STRING,
      user: process.env.ORACLE_USER || 'admin',
      password: process.env.ORACLE_PASSWORD,
      poolMin: 1,
      poolMax: 5,
      poolIncrement: 1,
    });
    console.log('[db] Oracle pool created');
  }
  return oraclePool;
}

function getPgPool() {
  if (!pgPool && process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('render.com')
        ? { rejectUnauthorized: false }
        : false,
      max: 5,
    });
  }
  return pgPool;
}

async function query(sql, params = []) {
  const dbType = getDbType();

  if (dbType === 'oracle') {
    const pool = await getOraclePool();
    if (!pool) return null;
    try {
      let oracleSql = sql;
      let idx = 1;
      while (oracleSql.includes('$' + idx)) {
        oracleSql = oracleSql.replace('$' + idx, ':' + idx);
        idx++;
      }
      const result = await pool.execute(oracleSql, params, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        autoCommit: true,
      });
      const rows = (result.rows || []).map(row => {
        if (typeof row === 'object' && !Array.isArray(row)) return row;
        const obj = {};
        (result.metaData || []).forEach((col, i) => { obj[col.name.toLowerCase()] = row[i]; });
        return obj;
      });
      return { rows };
    } catch (e) {
      console.error('[db] oracle query error:', e.message);
      return null;
    }
  }

  if (dbType === 'postgresql') {
    const pool = getPgPool();
    if (!pool) return null;
    try {
      return await pool.query(sql, params);
    } catch (e) {
      console.error('[db] pg query error:', e.message);
      return null;
    }
  }

  return null;
}

async function getVideos({ page = 1, limit = 20, search, sort, order, category }) {
  const dbType = getDbType();
  const conditions = [];
  const params = [];
  let idx = 1;

  if (search) {
    conditions.push(`LOWER(title) LIKE :${idx}`);
    params.push(`%${search.toLowerCase()}%`);
    idx++;
  }
  if (category) {
    conditions.push(`LOWER(categories) LIKE :${idx}`);
    params.push(`%${category.toLowerCase()}%`);
    idx++;
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  let orderClause = 'ORDER BY views DESC';
  if (sort === 'views') orderClause = `ORDER BY views ${order === 'asc' ? 'ASC' : 'DESC'}`;
  else if (sort === 'rating') orderClause = `ORDER BY rating ${order === 'asc' ? 'ASC' : 'DESC'}`;
  else if (sort === 'duration') orderClause = `ORDER BY duration ${order === 'asc' ? 'ASC' : 'DESC'}`;
  else if (sort === 'title') orderClause = `ORDER BY title ${order === 'asc' ? 'ASC' : 'DESC'}`;

  const offset = (page - 1) * limit;

  let countSql;
  if (dbType === 'oracle') {
    countSql = `SELECT COUNT(*) as cnt FROM videos ${where}`;
  } else {
    countSql = `SELECT COUNT(*) as cnt FROM videos ${where}`;
  }

  const countRes = await query(countSql, params);
  const total = countRes && countRes.rows[0] ? parseInt(countRes.rows[0].cnt) : 0;

  let dataSql;
  if (dbType === 'oracle') {
    dataSql = `SELECT * FROM videos ${where} ${orderClause} OFFSET :${idx} ROWS FETCH NEXT :${idx + 1} ROWS ONLY`;
    const dataRes = await query(dataSql, [...params, offset, limit]);
    return { videos: dataRes ? dataRes.rows : [], total, hasMore: offset + limit < total };
  } else {
    dataSql = `SELECT * FROM videos ${where} ${orderClause} LIMIT $${idx} OFFSET $${idx + 1}`;
    const dataRes = await query(dataSql, [...params, limit, offset]);
    return { videos: dataRes ? dataRes.rows : [], total, hasMore: offset + limit < total };
  }
}

async function getCategories() {
  const res = await query(`SELECT DISTINCT categories FROM videos WHERE categories IS NOT NULL AND categories != '' ORDER BY categories`);
  if (!res) return [];
  const cats = new Set();
  res.rows.forEach(r => {
    const val = r.categories || r.CATEGORIES || '';
    val.split(';').forEach(c => { const t = c.trim(); if (t) cats.add(t); });
  });
  return Array.from(cats).sort();
}

module.exports = { query, getVideos, getCategories, getOraclePool, getPgPool, getDbType };
