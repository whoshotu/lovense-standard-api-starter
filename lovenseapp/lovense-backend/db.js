const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
        ? { rejectUnauthorized: false }
        : false,
      max: 5,
    });
  }
  return pool;
}

async function query(text, params) {
  const p = getPool();
  if (!p) return null;
  try {
    const res = await p.query(text, params);
    return res;
  } catch (e) {
    console.error('[db] query error:', e.message);
    return null;
  }
}

async function getVideos({ page = 1, limit = 20, search, sort, order, category }) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (search) {
    conditions.push(`LOWER(title) LIKE $${idx}`);
    params.push(`%${search.toLowerCase()}%`);
    idx++;
  }
  if (category) {
    conditions.push(`LOWER(categories) LIKE $${idx}`);
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

  const countRes = await query(`SELECT COUNT(*) FROM videos ${where}`, params);
  const total = countRes ? parseInt(countRes.rows[0].count) : 0;

  const dataRes = await query(
    `SELECT * FROM videos ${where} ${orderClause} LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset]
  );

  return { videos: dataRes ? dataRes.rows : [], total, hasMore: offset + limit < total };
}

async function getCategories() {
  const res = await query('SELECT DISTINCT categories FROM videos WHERE categories IS NOT NULL AND categories != \'\' ORDER BY categories');
  if (!res) return [];
  const cats = new Set();
  res.rows.forEach(r => {
    (r.categories || '').split(';').forEach(c => { const t = c.trim(); if (t) cats.add(t); });
  });
  return Array.from(cats).sort();
}

module.exports = { query, getVideos, getCategories, getPool };