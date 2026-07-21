/**
 * WhiskyCompass content publisher
 *
 * Usage:
 *   set RAKUTEN_APP_ID=...
 *   set RAKUTEN_ACCESS_KEY=...
 *   set RAKUTEN_AFFILIATE_ID=...
 *   set AMAZON_TAG=yourtag-22
 *   node app.js
 *
 * This program only writes generated product data to public/data/whiskies.js.
 * The credentials stay in environment variables and are never written to public.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const LM_STUDIO_API_URL = 'http://localhost:1234/v1/chat/completions';
const OUTPUT_FILE = path.resolve('public/data/whiskies.js');
const RAKUTEN_ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';
const RAKUTEN_WHISKY_GENRE_ID = '100330';
const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID;
const RAKUTEN_ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY;
const RAKUTEN_AFFILIATE_ID = process.env.RAKUTEN_AFFILIATE_ID;
const RAKUTEN_REFERRER = process.env.RAKUTEN_REFERRER || 'https://whisky-compass.pikumin.workers.dev/';
const RAKUTEN_ORIGIN = new URL(RAKUTEN_REFERRER).origin;
const AMAZON_TAG = process.env.AMAZON_TAG || 'yourtag-22';
const AMAZON_ACCESS_KEY = process.env.AMAZON_ACCESS_KEY;
const AMAZON_SECRET_KEY = process.env.AMAZON_SECRET_KEY;
const AMAZON_REGION = process.env.AMAZON_REGION || 'us-east-1';
const AI_MODEL_NAME = process.env.LM_STUDIO_MODEL || undefined;

function required(value, name) {
  if (!value) throw new Error(`${name} is not set. See the comment at the top of app.js.`);
  return value;
}

function cleanTitle(value = '') {
  return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function slugify(text = '') {
  return cleanTitle(text).toLowerCase().replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function tagsFor(title, caption = '') {
  const text = `${title} ${caption}`.toLowerCase();
  const tags = [];
  if (/アイラ|ラフロイグ|アードベッグ|ボウモア|ピート|スモーキー/.test(text)) tags.push('スモーキー');
  if (/バーボン|メーカーズ|ワイルドターキー/.test(text)) tags.push('バニラ', 'リッチ');
  if (/白州|山崎|余市|宮城峡|響|知多|ジャパニーズ/.test(text)) tags.push('華やか', 'フルーティー');
  if (/シェリー|マッカラン|グレン/.test(text)) tags.push('フルーティー', 'リッチ');
  return [...new Set(tags.length ? tags : ['リッチ', 'フルーティー'])].slice(0, 3);
}

function styleFor(title) {
  if (/バーボン|メーカーズ|ワイルドターキー/.test(title)) return ['バーボン'];
  if (/白州|山崎|余市|宮城峡|響|知多|嘉之助|厚岸/.test(title)) return ['ジャパニーズ', 'ハイボール'];
  return ['スコッチ'];
}

function amazonSearchUrl(title) {
  return `https://www.amazon.co.jp/s?k=${encodeURIComponent(title)}&tag=${encodeURIComponent(AMAZON_TAG)}`;
}

async function rakutenSearch(sort) {
  const params = new URLSearchParams({
    applicationId: required(RAKUTEN_APP_ID, 'RAKUTEN_APP_ID'),
    accessKey: required(RAKUTEN_ACCESS_KEY, 'RAKUTEN_ACCESS_KEY'),
    affiliateId: RAKUTEN_AFFILIATE_ID || '',
    keyword: 'ウイスキー',
    genreId: RAKUTEN_WHISKY_GENRE_ID,
    hits: '30',
    page: '1',
    sort,
    availability: '1',
    imageFlag: '1',
    format: 'json',
    formatVersion: '2',
    elements: 'itemName,itemPrice,itemCaption,itemUrl,affiliateUrl,mediumImageUrls,reviewCount,reviewAverage,shopName,genreId,availability'
  });
  const response = await fetch(`${RAKUTEN_ENDPOINT}?${params}`, {
    headers: {
      Referer: RAKUTEN_REFERRER,
      Origin: RAKUTEN_ORIGIN
    }
  });
  if (!response.ok) throw new Error(`Rakuten API ${response.status}: ${await response.text()}`);
  const data = await response.json();
  // formatVersion=2 is documented as `items`, but retain compatibility with
  // older response wrappers so a valid response is never silently discarded.
  const items = Array.isArray(data.items)
    ? data.items
    : Array.isArray(data.Items)
      ? data.Items.map(entry => entry.item || entry.Item || entry)
      : [];
  console.log(`Rakuten search (${sort}): ${items.length} items`);
  return items;
}

function isBottle(item) {
  const title = cleanTitle(item.itemName);
  const text = `${title} ${item.itemCaption || ''}`;
  const whiskyName = /ウイスキー|ウィスキー|whisk(?:e)?y|スコッチ|バーボン|シングルモルト|ピュアモルト|ブレンデッド|竹鶴|山崎|白州|知多|余市|宮城峡|響|角瓶|ニッカ/i;
  const nonWhiskyProduct = /炭酸水|ソーダ|割[り材]|ボールペン|筆記具|ジェットストリーム|スキットル|ウ[ィイ]スキーボトル|水筒|アクセサリー|ピアス|コニャッククォーツ|ハイボール.*缶|缶.*ハイボール|リキュール.*発泡/i;
  if (!whiskyName.test(title) || nonWhiskyProduct.test(text)) return false;
  // Do not use a broad "本" check here: whisky listings commonly say "700ml 1本".
  return !/グラス|タンブラー|チョコ|ケーキ|ハイボール缶|セット.*グラス|ソーダ|文庫|単行本|書籍|漫画|くじ/i.test(text);
}

function normaliseRakutenItem(item, source, index) {
  const title = cleanTitle(item.itemName);
  const image = item.mediumImageUrls?.[0]?.imageUrl || '';
  return {
    id: `rakuten-${item.itemCode || `${source}-${index}`}`.replace(/[^a-zA-Z0-9_-]/g, '-'),
    slug: slugify(title + '-' + (item.itemCode || index)),
    name: title,
    origin: `${source === 'popular' ? 'POPULAR ON RAKUTEN' : 'NEW ON RAKUTEN'} / ${item.shopName || 'Rakuten'}`,
    score: Number(item.reviewAverage || 0).toFixed(1),
    price: Number(item.itemPrice || 0),
    flavor: tagsFor(title, item.itemCaption),
    style: styleFor(title),
    caption: cleanTitle(item.itemCaption || ''),
    note: '',
    label: title.slice(0, 14).toUpperCase(),
    image,
    amazon: amazonSearchUrl(title),
    rakuten: item.affiliateUrl || item.itemUrl,
    source,
    reviewCount: Number(item.reviewCount || 0),
    updatedAt: new Date().toISOString()
  };
}

// --- Amazon Product Advertising API (PA-API v5) helpers ---
import crypto from 'node:crypto';

function sha256Hex(str){return crypto.createHash('sha256').update(str,'utf8').digest('hex')}
function hmac(key, str){return crypto.createHmac('sha256', key).update(str,'utf8').digest()}

function getSigningKey(key, dateStamp, regionName, serviceName){
  const kDate = hmac('AWS4' + key, dateStamp);
  const kRegion = hmac(kDate, regionName);
  const kService = hmac(kRegion, serviceName);
  const kSigning = hmac(kService, 'aws4_request');
  return kSigning;
}

async function amazonSearchPA(keywords, itemCount = 30){
  if(!AMAZON_ACCESS_KEY || !AMAZON_SECRET_KEY) throw new Error('Amazon credentials not set');
  const host = 'webservices.amazon.co.jp';
  const endpoint = `https://${host}/paapi5/searchitems`;
  const service = 'ProductAdvertisingAPI';
  const region = AMAZON_REGION;
  const dt = new Date();
  const amzDate = dt.toISOString().replace(/[:-]|\.\d{3}/g,'') + 'Z';
  const dateStamp = amzDate.slice(0,8);

  const body = JSON.stringify({
    Keywords: keywords,
    SearchIndex: 'All',
    ItemCount: itemCount,
    Resources: ['Images.Primary.Medium','ItemInfo.Title','Offers.Listings.Price','DetailPageURL']
  });

  const method = 'POST';
  const canonicalUri = '/paapi5/searchitems';
  const canonicalQueryString = '';
  const payloadHash = sha256Hex(body);
  const canonicalHeaders = `host:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-date';
  const canonicalRequest = [method, canonicalUri, canonicalQueryString, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [algorithm, amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = getSigningKey(AMAZON_SECRET_KEY, dateStamp, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign,'utf8').digest('hex');
  const authorization = `${algorithm} Credential=${AMAZON_ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Host': host,
    'X-Amz-Date': amzDate,
    'Authorization': authorization,
    'Accept': 'application/json'
  };

  const res = await fetch(endpoint, { method:'POST', headers, body });
  if(!res.ok){ const txt = await res.text(); throw new Error(`PA-API ${res.status}: ${txt}`) }
  const data = await res.json();
  return data;
}

function normaliseAmazonItem(item, source, index){
  const title = item?.ItemInfo?.Title?.DisplayValue || item?.title || '';
  const image = item?.Images?.Primary?.Medium?.URL || '';
  const price = Number(item?.Offers?.Listings?.[0]?.Price?.Amount || 0);
  const detail = item?.DetailPageURL || '';
  const asin = item?.ASIN || `ASIN-${index}`;
  return {
    id: `amazon-${asin}`,
    slug: slugify(title + '-' + asin),
    name: title,
    origin: `AMAZON / ${source}`,
    score: (item?.CustomerReviews?.AverageRating || '0.0').toString(),
    price: price,
    flavor: tagsFor(title, ''),
    style: styleFor(title),
    caption: '',
    note: '',
    label: title.slice(0,14).toUpperCase(),
    image,
    amazon: detail || amazonSearchUrl(title),
    rakuten: '',
    source: source,
    reviewCount: Number(item?.CustomerReviews?.TotalReviewCount || 0),
    updatedAt: new Date().toISOString()
  };
}

async function createArticle(item) {
  // Ask LocalLM to generate a JSON object with title and body.
  const fallbackTitle = `${item.name}`;
  const fallbackBody = item.note || `${item.name} はおすすめのウイスキーです。詳細は販売ページでご確認ください。`;
  try {
    const prompt = `商品情報:\n名前: ${item.name}\n価格: ${item.price || ''}\n説明: ${item.caption || ''}\nタグ: ${(item.flavor||[]).join('、')}\n\n出力形式: JSON で {"title":"...","body":"..."} のみを返してください。タイトルは「ウイスキー名 銘柄名 熟成年数 容量」の形式を優先して短く、本文は120〜300文字の日本語で説明を書くこと。`;
    const res = await fetch(LM_STUDIO_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'system', content: 'あなたは日本語の編集者です。出力は必ずJSONのみで返してください。' }, { role: 'user', content: prompt }], temperature: 0.4 }) });
    if (!res.ok) throw new Error(`LocalLM ${res.status}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    // Try to extract JSON from response
    const jsonMatch = content.trim().match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    return {
      title: (parsed && parsed.title) ? parsed.title : fallbackTitle,
      body: (parsed && parsed.body) ? parsed.body : fallbackBody
    };
  } catch (err) {
    console.warn('createArticle failed:', err.message);
    return { title: fallbackTitle, body: fallbackBody };
  }
}

async function createReview(item) {
  const fallback = `${item.name}は${item.flavor.join('・')}の印象を楽しみたい方に向く候補です。販売ページで容量・度数・価格をご確認ください。`;
  try {
    const response = await fetch(LM_STUDIO_API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(AI_MODEL_NAME ? { model: AI_MODEL_NAME } : {}), temperature: 0.35,
        messages: [
          { role: 'system', content: 'あなたは日本のウイスキー編集者です。与えられた販売情報だけを根拠に、断定・受賞歴・在庫の主張をせず、80〜120字の中立な紹介文を日本語で作成してください。HTMLは不要です。' },
          { role: 'user', content: `商品名: ${item.name}\n商品説明: ${item.caption || 'なし'}\n価格: ${item.price}円\nレビュー平均: ${item.score}\n想定タグ: ${item.flavor.join('、')}` }
        ]
      })
    });
    if (!response.ok) throw new Error(`LocalLM ${response.status}`);
    const data = await response.json();
    return String(data.choices?.[0]?.message?.content || fallback).replace(/<[^>]*>/g, '').trim().slice(0, 260);
  } catch (error) {
    console.warn(`LocalLM review skipped for ${item.name}: ${error.message}`);
    return fallback;
  }
}

async function main() {
  await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  if (!RAKUTEN_APP_ID || !RAKUTEN_ACCESS_KEY) {
    console.warn('Rakuten credentials are not set; preserving the built-in review cards.');
    process.exitCode = 0;
    return;
  }

  const [popularRaw, latestRaw] = await Promise.all([rakutenSearch('-reviewCount'), rakutenSearch('-updateTimestamp')]);
  // If Amazon credentials are set, fetch Amazon search results (popular and new-ish)
  let amazonRawPopular = null, amazonRawLatest = null;
  if (AMAZON_ACCESS_KEY && AMAZON_SECRET_KEY) {
    try {
      const [ap, al] = await Promise.all([
        amazonSearchPA('ウイスキー', 30),
        amazonSearchPA('新着 ウイスキー', 30)
      ]);
      amazonRawPopular = ap?.SearchResult?.Items || ap?.ItemsResult?.Items || [];
      amazonRawLatest = al?.SearchResult?.Items || al?.ItemsResult?.Items || [];
      console.log(`Amazon search: popular ${amazonRawPopular.length} items, latest ${amazonRawLatest.length} items`);
    } catch (err) {
      console.warn('Amazon PA-API fetch failed:', err.message);
    }
  }
  const seen = new Set();
  const candidates = [
    ...popularRaw.map(x => [x, 'popular', 'rakuten']),
    ...latestRaw.map(x => [x, 'latest', 'rakuten'])
  ];
  if (amazonRawPopular) candidates.push(...amazonRawPopular.map(x => [x, 'popular', 'amazon']));
  if (amazonRawLatest) candidates.push(...amazonRawLatest.map(x => [x, 'latest', 'amazon']));

  const products = candidates
    .filter(([item, ,source]) => {
      if (source === 'rakuten') return isBottle(item);
      // For Amazon items, basic filtering by title presence
      const title = (item?.ItemInfo?.Title?.DisplayValue || item?.title || '').trim();
      return !!title;
    })
    .map(([item, source, which], index) => {
      if (which === 'rakuten') return normaliseRakutenItem(item, source, index);
      return normaliseAmazonItem(item, source, index);
    })
    .filter(item => item.name && !seen.has(item.name) && seen.add(item.name))
    .slice(0, 60);

  if (products.length === 0) {
    throw new Error(`No publishable whisky products found (popular: ${popularRaw.length}, latest: ${latestRaw.length}). Existing public data was kept.`);
  }

  console.log('\nSelected whisky products:');
  products.forEach((item, index) => {
    console.log(`${String(index + 1).padStart(2, '0')}. [${item.source}] ${item.name} — ¥${item.price.toLocaleString('ja-JP')}`);
  });

  for (const item of products) {
    item.note = await createReview(item);
    const article = await createArticle(item);
    item.articleTitle = article.title;
    item.articleBody = article.body;
  }
  const payload = `// Generated by ../app.js at ${new Date().toISOString()}. Do not edit manually.\nwindow.WHISKY_DATA = ${JSON.stringify(products, null, 2)};\n`;
  await fs.writeFile(OUTPUT_FILE, payload, 'utf8');
  console.log(`Published ${products.length} Rakuten product reviews to ${OUTPUT_FILE}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
