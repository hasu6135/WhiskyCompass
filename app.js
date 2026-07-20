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
const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID;
const RAKUTEN_ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY;
const RAKUTEN_AFFILIATE_ID = process.env.RAKUTEN_AFFILIATE_ID;
const AMAZON_TAG = process.env.AMAZON_TAG || 'yourtag-22';
const AI_MODEL_NAME = process.env.LM_STUDIO_MODEL || undefined;

function required(value, name) {
  if (!value) throw new Error(`${name} is not set. See the comment at the top of app.js.`);
  return value;
}

function cleanTitle(value = '') {
  return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
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
    hits: '12',
    page: '1',
    sort,
    availability: '1',
    imageFlag: '1',
    hasReviewFlag: '1',
    format: 'json',
    formatVersion: '2',
    elements: 'itemName,itemPrice,itemCaption,itemUrl,affiliateUrl,mediumImageUrls,reviewCount,reviewAverage,shopName,genreId,availability'
  });
  const response = await fetch(`${RAKUTEN_ENDPOINT}?${params}`);
  if (!response.ok) throw new Error(`Rakuten API ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return Array.isArray(data.items) ? data.items : [];
}

function isBottle(item) {
  const text = `${item.itemName} ${item.itemCaption || ''}`;
  return !/グラス|タンブラー|チョコ|ケーキ|ハイボール缶|セット.*グラス|ソーダ|本|漫画|くじ/i.test(text);
}

function normaliseRakutenItem(item, source, index) {
  const title = cleanTitle(item.itemName);
  const image = item.mediumImageUrls?.[0]?.imageUrl || '';
  return {
    id: `rakuten-${item.itemCode || `${source}-${index}`}`.replace(/[^a-zA-Z0-9_-]/g, '-'),
    name: title,
    origin: `${source === 'popular' ? 'POPULAR ON RAKUTEN' : 'NEW ON RAKUTEN'} / ${item.shopName || 'Rakuten'}`,
    score: Number(item.reviewAverage || 0).toFixed(1),
    price: Number(item.itemPrice || 0),
    flavor: tagsFor(title, item.itemCaption),
    style: styleFor(title),
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
  const seen = new Set();
  const products = [...popularRaw.map(x => [x, 'popular']), ...latestRaw.map(x => [x, 'latest'])]
    .filter(([item]) => isBottle(item))
    .map(([item, source], index) => normaliseRakutenItem(item, source, index))
    .filter(item => item.name && item.price > 0 && !seen.has(item.name) && seen.add(item.name))
    .slice(0, 12);

  for (const item of products) item.note = await createReview(item);
  const payload = `// Generated by ../app.js at ${new Date().toISOString()}. Do not edit manually.\nwindow.WHISKY_DATA = ${JSON.stringify(products, null, 2)};\n`;
  await fs.writeFile(OUTPUT_FILE, payload, 'utf8');
  console.log(`Published ${products.length} Rakuten product reviews to ${OUTPUT_FILE}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
