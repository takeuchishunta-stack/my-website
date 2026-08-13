/**
 * note.com の公開検索データを読み取るクライアント。
 *
 * - 公開ページが叩いているのと同じ公開エンドポイントを、低頻度で読むだけ。
 *   ログインもスクレイピングもせず、書き込みも一切しない。
 * - note には公式の公開APIが無いため、レスポンス構造は予告なく変わりうる。
 *   構造が変わっても落ちないよう、取れたフィールドだけ拾う実装にしている。
 * - リクエスト間隔は NOTEKIT_RATE_LIMIT_MS（既定1500ms）。短くしないこと。
 */

// テスト時にモックサーバへ向けられるようにしている。通常は変更しない。
const base = () => process.env.NOTEKIT_NOTE_API_BASE || "https://note.com/api";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rateLimitMs = () => Number(process.env.NOTEKIT_RATE_LIMIT_MS || 1500);

let lastRequestAt = 0;
async function throttle() {
  const wait = lastRequestAt + rateLimitMs() - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

async function getJson(url, { retries = 2 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    await throttle();
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          await sleep(2000 * 2 ** attempt);
          continue;
        }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.json();
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(2000 * 2 ** attempt);
    }
  }
  throw new Error(`リクエストに失敗しました: ${url}`);
}

/** レスポンスの入れ子が変わっても記事配列を取り出せるようにする */
function pickNotes(json) {
  const candidates = [
    json?.data?.notes?.contents,
    json?.data?.notes,
    json?.data?.contents,
    json?.data,
    json?.notes,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function pickTotal(json, fallback) {
  const candidates = [
    json?.data?.notes?.total_count,
    json?.data?.total_count,
    json?.data?.totalCount,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "number") return candidate;
  }
  return fallback;
}

function normalizeNote(raw) {
  const user = raw?.user ?? {};
  const price = Number(raw?.price ?? 0) || 0;
  const key = raw?.key ?? raw?.id ?? null;
  const urlname = user?.urlname ?? null;
  return {
    key,
    title: raw?.name ?? raw?.title ?? null,
    url:
      raw?.noteUrl ??
      (key && urlname ? `https://note.com/${urlname}/n/${key}` : null),
    price,
    isPaid: price > 0,
    likeCount: Number(raw?.likeCount ?? raw?.like_count ?? 0) || 0,
    publishAt: raw?.publishAt ?? raw?.publish_at ?? null,
    author: urlname,
    authorName: user?.nickname ?? user?.name ?? null,
    followerCount: Number(user?.followerCount ?? user?.follower_count ?? 0) || 0,
  };
}

/**
 * キーワードで記事を検索する。
 * @param {string} query
 * @param {{size?: number, start?: number, sort?: "popular"|"new"}} opts
 */
export async function searchNotes(query, { size = 20, start = 0, sort = "popular" } = {}) {
  const url = `${base()}/v3/searchs?context=note&q=${encodeURIComponent(query)}&size=${size}&start=${start}&sort=${sort}`;
  const json = await getJson(url);
  const rawNotes = pickNotes(json);
  return {
    query,
    sort,
    start,
    total: pickTotal(json, rawNotes.length),
    notes: rawNotes.map(normalizeNote).filter((note) => note.title),
    raw: json,
  };
}

/**
 * 1キーワードを複数ページ取得する。
 * @param {string} query
 * @param {{pages?: number, size?: number, sort?: "popular"|"new"}} opts
 */
export async function searchNotesPaged(query, { pages = 2, size = 20, sort = "popular" } = {}) {
  const notes = [];
  let total = 0;
  const raws = [];
  for (let page = 0; page < pages; page += 1) {
    const result = await searchNotes(query, { size, start: page * size, sort });
    total = result.total;
    raws.push(result.raw);
    notes.push(...result.notes);
    if (result.notes.length < size) break;
  }
  const seen = new Set();
  const unique = notes.filter((note) => {
    const id = note.key ?? note.url ?? note.title;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { query, sort, total, notes: unique, raw: raws };
}

const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

/** 検索結果を「売れ筋の傾向」に集計する */
export function summarize(result) {
  const { notes } = result;
  const paid = notes.filter((note) => note.isPaid);
  const prices = paid.map((note) => note.price);
  const likes = notes.map((note) => note.likeCount);

  const authors = new Map();
  for (const note of notes) {
    if (!note.author) continue;
    const entry = authors.get(note.author) ?? {
      author: note.author,
      authorName: note.authorName,
      followerCount: note.followerCount,
      count: 0,
      paidCount: 0,
      likeSum: 0,
    };
    entry.count += 1;
    if (note.isPaid) entry.paidCount += 1;
    entry.likeSum += note.likeCount;
    authors.set(note.author, entry);
  }

  return {
    query: result.query,
    fetchedAt: new Date().toISOString(),
    totalHits: result.total,
    sampled: notes.length,
    paidCount: paid.length,
    paidRatio: notes.length ? Number((paid.length / notes.length).toFixed(3)) : 0,
    priceMedian: median(prices),
    priceMin: prices.length ? Math.min(...prices) : 0,
    priceMax: prices.length ? Math.max(...prices) : 0,
    priceBuckets: {
      "300円以下": prices.filter((p) => p <= 300).length,
      "301-500円": prices.filter((p) => p > 300 && p <= 500).length,
      "501-1000円": prices.filter((p) => p > 500 && p <= 1000).length,
      "1001円以上": prices.filter((p) => p > 1000).length,
    },
    likeMedian: median(likes),
    topPaidNotes: [...paid]
      .sort((a, b) => b.likeCount - a.likeCount)
      .slice(0, 10)
      .map(({ title, price, likeCount, url, author }) => ({ title, price, likeCount, url, author })),
    topFreeNotes: [...notes.filter((n) => !n.isPaid)]
      .sort((a, b) => b.likeCount - a.likeCount)
      .slice(0, 10)
      .map(({ title, likeCount, url, author }) => ({ title, likeCount, url, author })),
    topAuthors: [...authors.values()]
      .sort((a, b) => b.likeSum - a.likeSum)
      .slice(0, 8),
  };
}
