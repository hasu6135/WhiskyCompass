/**
 * WhiskyCompass content publisher & Static Site Generator
 *
 * Usage:
 *   set RAKUTEN_APP_ID=...
 *   set RAKUTEN_ACCESS_KEY=...
 *   set RAKUTEN_AFFILIATE_ID=...
 *   set AMAZON_TAG=yourtag-22
 *   node app.js
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const HITS = 1;
const LM_STUDIO_API_URL = 'http://localhost:1234/v1/chat/completions';
const OUTPUT_FILE = path.resolve('public/data/whiskies.js');
const PRODUCTS_DIR = path.resolve('public/products'); // HTML出力先
const RAKUTEN_ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';
const RAKUTEN_WHISKY_GENRE_ID = '100330';
const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID;
const RAKUTEN_ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY;
const RAKUTEN_AFFILIATE_ID = process.env.RAKUTEN_AFFILIATE_ID;
const RAKUTEN_REFERRER = process.env.RAKUTEN_REFERRER || 'https://whisky-compass.pikumin.workers.dev/';
const RAKUTEN_ORIGIN = new URL(RAKUTEN_REFERRER).origin;
const AMAZON_TAG = process.env.AMAZON_TAG || 'yourtag-22';
const AI_MODEL_NAME = process.env.LM_STUDIO_MODEL || undefined;

function required(value, name) {
  if (!value) throw new Error(`${name} is not set. See the comment at the top of app.js.`);
  return value;
}

function formatPrice(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '―';
  return Number(n).toLocaleString('ja-JP') + '円';
}

function cleanTitle(value = '') {
  return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function slugify(text = '') {
  return cleanTitle(text).toLowerCase().replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function safeJsonParse(content) {
  if (!content) return null;
  const raw = String(content).trim();
  const candidate = raw.match(/\{[\s\S]*\}/)?.[0] || raw;
  const attempts = [candidate,
    candidate.replace(/[\r\n]+/g, ' ')
             .replace(/[“”]/g, '"')
             .replace(/[‘’]/g, "'")
             .replace(/,\s*([}\]])/g, '$1')
  ];

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch (_) {
      // continue to fallback heuristics
    }
  }

  const cleaned = attempts[1];
  const extracted = {};
  const textMatch = cleaned.match(/["']text["']\s*:\s*["']([^"']*)["']/);
  if (textMatch) extracted.text = textMatch[1].trim();
  const waysMatch = cleaned.match(/["']ways["']\s*:\s*\[([\s\S]*?)\]/);
  if (waysMatch) {
    extracted.ways = Array.from(waysMatch[1].matchAll(/["']([^"']+)["']/g)).map(m => m[1].trim()).filter(Boolean);
  }
  const commentsMatch = cleaned.match(/["']comments["']\s*:\s*\[([\s\S]*)\]\s*$/);
  if (commentsMatch) {
    extracted.comments = Array.from(commentsMatch[1].matchAll(/\{([\s\S]*?)\}/g)).map(match => {
      const objectText = match[1];
      const name = objectText.match(/["']name["']\s*:\s*["']([^"']*)["']/)?.[1]?.trim();
      const role = objectText.match(/["']role["']\s*:\s*["']([^"']*)["']/)?.[1]?.trim();
      const text = objectText.match(/["']text["']\s*:\s*["']([^"']*)["']/)?.[1]?.trim();
      return text ? { name: name || 'ユーザー', role: role || 'ウイスキー好き', text } : null;
    }).filter(Boolean);
  }
  return Object.keys(extracted).length ? extracted : null;
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

function extractOriginFallback(item) {
  const text = cleanTitle(`${item.rawName} ${item.caption || ''} ${item.shopName || ''}`);
  const countryPatterns = [
    {regex: /イギリス産|英国産|スコットランド産|アイラ|スペイサイド|ハイランド|ローランド|スコッチ/i, label: 'イギリス産'},
    {regex: /日本産|国産|日本製|ジャパニーズ|サントリー|ニッカ|竹鶴|山崎|白州|響|知多|余市|宮城峡/i, label: '日本産'},
    {regex: /アメリカ産|米国産|アメリカ|USA|U\.S\.|ケンタッキー|バーボン/i, label: 'アメリカ産'},
    {regex: /カナダ産|カナディア|カナダ/i, label: 'カナダ産'},
    {regex: /アイルランド産|アイルランド|アイリッシュ/i, label: 'アイルランド産'},
    {regex: /フランス産|フランス/i, label: 'フランス産'}
  ];
  const brandPatterns = [
    'サントリー', 'ニッカ', '山崎', '白州', '響', '知多', '余市', '宮城峡', '竹鶴',
    'ザ・マッカラン', 'マッカラン', 'ラフロイグ', 'ボウモア', 'メーカーズマーク',
    'ジャックダニエル', 'バランタイン', 'ボウモア', 'タリスカー', 'ジョニーウォーカー',
    'ヘネシー', 'グレンフィディック', 'グレンリベット', 'アードベッグ', 'カナディアンクラブ'
  ];
  const country = countryPatterns.find(p => p.regex.test(text))?.label || '';
  let brand = '';
  for (const candidate of brandPatterns) {
    const regex = new RegExp(candidate.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
    if (regex.test(text)) {
      brand = candidate;
      break;
    }
  }
  if (!brand && item.shopName && !/rakuten/i.test(item.shopName)) {
    brand = item.shopName;
  }
  if (!country && /ウイスキー|シングルモルト|バーボン|ジャパニーズ|スコッチ/i.test(text)) {
    brand = brand || item.shopName || '';
  }
  return [country || '原産国不明', brand || 'ブランド不明'].join(' / ');
}

async function extractOrigin(item) {
  const fallback = extractOriginFallback(item);
  try {
    const prompt = `商品情報:
名前: ${item.rawName}
説明: ${item.caption || ''}
ショップ名: ${item.shopName || ''}

この商品の原産国または生産国と販売元または生産者名またはブランドを、次の形式で出力してください。
原産国 / ブランド

原産国は～～産とすること。
原産国が判別できない場合は「原産国不明」、ブランドが判別できない場合は「ブランド不明」としてください。
出力は必ずJSONのみで {"origin":"...","brand":"..."} 形式で返してください。`; 
    const response = await fetch(LM_STUDIO_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'あなたは日本語の編集者です。出力は必ずJSONのみで返してください。' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2
      })
    });
    if (!response.ok) throw new Error(`LocalLM ${response.status}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.trim().match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    if (parsed) {
      const originRaw = typeof parsed.origin === 'string' ? parsed.origin.trim() : '';
      const brandRaw = typeof parsed.brand === 'string' ? parsed.brand.trim() : '';
      const originValue = normalizeOriginValue(originRaw || '');
      const brandValue = brandRaw || '';
      if (originValue || brandValue) {
        const originText = originValue || '原産国不明';
        const brandText = brandValue || 'ブランド不明';
        return cleanTitle(`${originText} / ${brandText}`);
      }
    }
  } catch (err) {
    console.warn('extractOrigin failed:', err.message);
  }
  return fallback;
}

function normalizeOriginValue(origin) {
  if (!origin) return '';
  const normalized = origin.trim().replace(/^(日本|日本国)$/, '日本産').replace(/^英国$/, 'イギリス産');
  if (/産$/.test(normalized) || normalized === '原産国不明') {
    return normalized;
  }
  return `${normalized}産`;
}

function amazonSearchUrl(title) {
  return `https://www.amazon.co.jp/s?k=${encodeURIComponent(title)}&tag=${encodeURIComponent(AMAZON_TAG)}`;
}

function canonicalTitle(text = '') {
  return cleanTitle(text).toLowerCase().replace(/\s+/g, ' ');
}

async function loadExistingProducts() {
  try {
    const text = await fs.readFile(OUTPUT_FILE, 'utf8');
    const match = text.match(/window\.WHISKY_DATA\s*=\s*(\[[\s\S]*\]);?/m);
    return match ? JSON.parse(match[1]) : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function rakutenSearch(sort) {
  const params = new URLSearchParams({
    applicationId: required(RAKUTEN_APP_ID, 'RAKUTEN_APP_ID'),
    accessKey: required(RAKUTEN_ACCESS_KEY, 'RAKUTEN_ACCESS_KEY'),
    affiliateId: RAKUTEN_AFFILIATE_ID || '',
    keyword: 'ウイスキー',
    genreId: RAKUTEN_WHISKY_GENRE_ID,
    hits: HITS,
    page: '1',
    sort,
    availability: '1',
    imageFlag: '1',
    format: 'json',
    formatVersion: '2',
    elements: 'itemName,itemPrice,itemCaption,itemUrl,affiliateUrl,mediumImageUrls,reviewCount,reviewAverage,shopName,genreId,availability'
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${RAKUTEN_ENDPOINT}?${params}`, {
      headers: {
        Referer: RAKUTEN_REFERRER,
        Origin: RAKUTEN_ORIGIN
      }
    });
    if (response.ok) {
      const data = await response.json();
      const items = Array.isArray(data.items)
        ? data.items
        : Array.isArray(data.Items)
          ? data.Items.map(entry => entry.item || entry.Item || entry)
          : [];
      console.log(`Rakuten search (${sort}): ${items.length} items`);
      return items;
    }
    const text = await response.text();
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after')) || 1;
      console.warn(`Rakuten rate limited, retrying in ${retryAfter}s (${attempt + 1}/3)`);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      continue;
    }
    throw new Error(`Rakuten API ${response.status}: ${text}`);
  }
  throw new Error('Rakuten API rate limit retry exhausted');
}

function isBottle(item) {
  const title = cleanTitle(item.itemName || '');
  const caption = cleanTitle(item.itemCaption || '');
  const text = `${title} ${caption}`;
  const whiskyName = /ウイスキー|ウィスキー|whisk(?:e)?y|スコッチ|バーボン|シングルモルト|ピュアモルト|ブレンデッド|竹鶴|山崎|白州|知多|余市|宮城峡|響|角瓶|ニッカ|グレンフィディック|マッカラン|ラフロイグ|ボウモア|ジョニーウォーカー/i;
  const nonWhiskyProduct = /炭酸水|ソーダ缶|ボールペン|筆記具|ジェットストリーム|スキットル|ウ[ィイ]スキーボトル|水筒|アクセサリー|ピアス|コニャッククォーツ|ハイボール.*缶|缶.*ハイボール|リキュール.*発泡/i;
  if (!whiskyName.test(title) || nonWhiskyProduct.test(text)) return false;
  return !/グラス|タンブラー|チョコ|ケーキ|ハイボール缶|セット.*グラス|文庫|単行本|書籍|漫画|くじ/i.test(text);
}

function findImageUrl(value) {
  const imagePattern = /^https?:\/\/.+\.(?:jpg|jpeg|png|webp|gif)(?:\?.*)?$/i;
  const containsImagePattern = /https?:\/\/.+\.(?:jpg|jpeg|png|webp|gif)/i;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (imagePattern.test(trimmed)) return trimmed;
    if (containsImagePattern.test(trimmed)) {
      const match = trimmed.match(containsImagePattern);
      return match ? match[0] : '';
    }
    return '';
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const url = findImageUrl(entry);
      if (url) return url;
    }
    return '';
  }

  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const url = findImageUrl(value[key]);
      if (url) return url;
    }
  }

  return '';
}

function normalizeRakutenImageUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return '';
  let normalized = url.trim();
  if (/thumbnail\.image\.rakuten\.co\.jp/.test(normalized)) {
    normalized = normalized.replace(/_ex=\d+x\d+/g, '_ex=512x512');
    if (!/_ex=\d+x\d+/.test(normalized)) {
      normalized += (normalized.includes('?') ? '&' : '?') + '_ex=512x512';
    }
  }
  if (normalized.startsWith('//')) normalized = `https:${normalized}`;
  return normalized;
}

function getRakutenImageUrl(item) {
  const candidates = [
    item.largeImageUrls,
    item.mediumImageUrls,
    item.smallImageUrls,
    item.imageUrls,
    item.imageUrl ? [item] : null
  ];
  for (const list of candidates) {
    if (!Array.isArray(list) || !list.length) continue;
    const imageObj = list[0];
    const url = imageObj?.imageUrl || imageObj?.url || imageObj?.image || '';
    const normalized = normalizeRakutenImageUrl(url);
    if (normalized) return normalized;
  }
  const fallback = item.imageUrl || item.image || '';
  const normalizedFallback = normalizeRakutenImageUrl(fallback);
  if (normalizedFallback) return normalizedFallback;
  const found = findImageUrl(item);
  return normalizeRakutenImageUrl(found);
}

function normaliseRakutenItem(item, source, index) {
  const title = cleanTitle(item.itemName);
  const image = getRakutenImageUrl(item);
  return {
    id: `rakuten-${item.itemCode || `${source}-${index}`}`.replace(/[^a-zA-Z0-9_-]/g, '-'),
    slug: slugify(title + '-' + (item.itemCode || index)),
    rawName: title,
    name: title,
    origin: '',
    shopName: item.shopName || '',
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

function formatArticleTitle(item) {
  const original = cleanTitle(item.rawName || item.name || '');
  const ageMatch = original.match(/\d{1,2}(?:\.\d+)?\s*(?:年|歳|Y|y|yr|yrs|years?)/i);
  const capacityMatch = original.match(/\d+(?:\.\d+)?\s*(?:ml|mL|ML|l|L|リットル|㎖|ℓ)/i);
  const age = ageMatch ? ageMatch[0].replace(/\s+/g, '') : '';
  const capacity = capacityMatch ? capacityMatch[0].replace(/\s+/g, '') : '';
  let title = original;
  if (ageMatch) title = title.replace(ageMatch[0], '');
  if (capacityMatch) title = title.replace(capacityMatch[0], '');
  title = title.replace(/【[^】]*】/g, '');
  title = title.replace(/\([^\)]*\)/g, '');
  title = title.replace(/\[[^\]]*\]/g, '');
  title = title.replace(/(ウイスキー|ウィスキー|シングルモルト|ピュアモルト|ブレンデッド|ブレンデッドモルト|ノンエイジ|NA|箱付|正規品|送料無料|ギフト|セット|限定|新品|未開封|特価|中古)/gi, '');
  title = title.replace(/[×x✕*]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!title) title = original;
  return [title, age, capacity].filter(Boolean).join(' ').replace(/\s+/g, ' ');
}

async function createArticle(item) {
  const fallbackTitle = formatArticleTitle(item);
  const rawName = item.rawName || item.name;
  const fallbackBody = item.note || `${rawName} はおすすめのウイスキーです。詳細は販売ページでご確認ください。`;
  try {
    const prompt = `商品情報:\n名前: ${rawName}\n価格: ${item.price || ''}\n説明: ${item.caption || ''}\nタグ: ${(item.flavor||[]).join('、')}\n\n出力形式: JSON で {"title":"...","body":"..."} のみを返してください。タイトルは「ブランド名 製法分類 熟成年数 容量」の形式を優先して短く、本文は120〜300文字の日本語で説明を書くこと。`;
    const res = await fetch(LM_STUDIO_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'system', content: 'あなたは日本語の編集者です。出力は必ずJSONのみで返してください。' }, { role: 'user', content: prompt }], temperature: 0.4 }) });
    if (!res.ok) throw new Error(`LocalLM ${res.status}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
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

async function createNameSummary(item) {
  const rawName = item.rawName || item.name;
  const fallback = rawName;
  try {
    const prompt = `ウイスキー情報：${item.articleTitle}\n\n出力形式: JSON で {"name":"..."} のみを返してください。このウイスキーを一言で表現する文言を、20〜40文字の日本語で作成してください。`;
    const res = await fetch(LM_STUDIO_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'system', content: 'あなたは日本語のコピーライターです。出力は必ずJSONのみで返してください。' }, { role: 'user', content: prompt }], temperature: 0.4 }) });
    if (!res.ok) throw new Error(`LocalLM ${res.status}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.trim().match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    return (parsed && parsed.name) ? parsed.name : fallback;
  } catch (err) {
    console.warn('createNameSummary failed:', err.message);
    return fallback;
  }
}

async function createReview(item) {
  const rawName = item.rawName || item.name;
  const fallback = `${rawName}は${(item.flavor||[]).join('・') || 'バランスの良い味わい'}の印象を楽しみたい方に向く候補です。販売ページで容量・度数・価格をご確認ください。`;
  console.log(`\nGenerating LocalLM review for ${rawName}...`);
  try {
    const response = await fetch(LM_STUDIO_API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(AI_MODEL_NAME ? { model: AI_MODEL_NAME } : {}), temperature: 0.35,
        messages: [
          { role: 'system', content: 'あなたは日本のウイスキー編集者です。与えられた販売情報だけを根拠に、断定・受賞歴・在庫の主張をせず、この商品についてネットから情報を集め、400字程度の中立な紹介文を日本語で作成してください。HTMLは不要です。特別に重要な単語や大事なポイントには、適宜 <b>太字</b> やハイライト（<mark>文章</mark>）を使って見やすく色付けしてください。' },
          { role: 'user', content: `商品名: ${rawName}\n商品説明: ${item.caption || 'なし'}\n価格: ${item.price}円\nレビュー平均: ${item.score}\n想定タグ: ${(item.flavor||[]).join('、')}` }
        ]
      })
    });
    if (!response.ok) throw new Error(`LocalLM ${response.status}`);
    const data = await response.json();
    return String(data.choices?.[0]?.message?.content || fallback).replace(/\*/g, '').replace(/\n/g, '<br>').trim().slice(0, 260);
  } catch (error) {
    console.warn(`LocalLM review skipped for ${rawName}: ${error.message}`);
    return fallback;
  }
}

async function createAbv(item) {
  const rawName = item.rawName || item.name;
  const fallback = item.abv || '';
  try {
    const prompt = `ウイスキー情報：${item.articleTitle}\n\nこの商品に含まれるアルコール度数を、必ず日本語で「43％」の形式で1つだけ答えてください。出力は必ずJSON形式で {"abv":"..."} のみを返してください。`;
    const response = await fetch(LM_STUDIO_API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(AI_MODEL_NAME ? { model: AI_MODEL_NAME } : {}), temperature: 0.25,
        messages: [
          { role: 'system', content: 'あなたは日本語のウイスキー編集者です。出力は必ずJSONのみで返してください。' },
          { role: 'user', content: prompt }
        ]
      })
    });
    if (!response.ok) throw new Error(`LocalLM ${response.status}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const parsed = safeJsonParse(content);
    const abv = parsed?.abv || parsed?.ABV || parsed?.度数 || '';
    if (abv && typeof abv === 'string') {
      const normalized = abv.trim().replace(/[^0-9\.％%]/g, '').replace(/%$/, '％');
      if (normalized) return normalized;
    }
    return fallback;
  } catch (error) {
    console.warn(`createAbv failed for ${rawName}: ${error.message}`);
    return fallback;
  }
}

async function createCharacteristic(item) {
  const rawName = item.rawName || item.name;
  const fallback = item.characteristic || item.note || '';
  try {
    const prompt = `ウイスキー情報：${item.articleTitle}\n\nこのウイスキーの特徴を、日本語で120〜160文字程度でまとめてください。出力は必ずJSON形式で {"characteristic":"..."} のみを返してください。特別に重要な単語や大事なポイントには、適宜 <b>太字</b> やハイライト（<mark>文章</mark>）を使って見やすく色付けしてください。`;
    const response = await fetch(LM_STUDIO_API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(AI_MODEL_NAME ? { model: AI_MODEL_NAME } : {}), temperature: 0.25,
        messages: [
          { role: 'system', content: 'あなたは日本語のウイスキー編集者です。出力は必ずJSONのみで返してください。' },
          { role: 'user', content: prompt }
        ]
      })
    });
    if (!response.ok) throw new Error(`LocalLM ${response.status}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const parsed = safeJsonParse(content);
    const characteristic = parsed?.characteristic || parsed?.特徴 || '';
    return characteristic && typeof characteristic === 'string' ? characteristic.trim() : fallback;
  } catch (error) {
    console.warn(`createCharacteristic failed for ${rawName}: ${error.message}`);
    return fallback;
  }
}

async function createVolume(item) {
  const rawName = item.rawName || item.name;
  const fallback = item.volume || '';
  try {
    const prompt = `ウイスキー情報：${item.articleTitle}\n\nこの商品の容量を、必ず日本語で「700ml」「750ml」「1L」などの形式で1つだけ答えてください。出力は必ずJSON形式で {"volume":"..."} のみを返してください。`;
    const response = await fetch(LM_STUDIO_API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(AI_MODEL_NAME ? { model: AI_MODEL_NAME } : {}), temperature: 0.25,
        messages: [
          { role: 'system', content: 'あなたは日本語のウイスキー編集者です。出力は必ずJSONのみで返してください。' },
          { role: 'user', content: prompt }
        ]
      })
    });
    if (!response.ok) throw new Error(`LocalLM ${response.status}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const parsed = safeJsonParse(content);
    const volume = parsed?.volume || parsed?.容量 || '';
    if (volume && typeof volume === 'string') {
      return volume.trim();
    }
    return fallback;
  } catch (error) {
    console.warn(`createVolume failed for ${rawName}: ${error.message}`);
    return fallback;
  }
}

async function createStyle(item) {
  const rawName = item.rawName || item.name;
  const fallback = Array.isArray(item.style) && item.style.length ? item.style : styleFor(item.rawName || item.name);
  try {
    const prompt = `ウイスキー情報：${item.articleTitle}\n\nこのウイスキーのスタイルを、3つ以内の日本語タグで表現してください。例: ["ジャパニーズ","ハイボール"]。出力は必ずJSON形式で {"style":["...","..."]} のみを返してください。`;
    const response = await fetch(LM_STUDIO_API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(AI_MODEL_NAME ? { model: AI_MODEL_NAME } : {}), temperature: 0.25,
        messages: [
          { role: 'system', content: 'あなたは日本語のウイスキー編集者です。出力は必ずJSONのみで返してください。' },
          { role: 'user', content: prompt }
        ]
      })
    });
    if (!response.ok) throw new Error(`LocalLM ${response.status}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const parsed = safeJsonParse(content);
    if (Array.isArray(parsed?.style) && parsed.style.length) {
      return parsed.style.map(String).filter(Boolean).slice(0, 3);
    }
    return fallback;
  } catch (error) {
    console.warn(`createStyle failed for ${rawName}: ${error.message}`);
    return fallback;
  }
}

async function createBarrel(item) {
  const rawName = item.rawName || item.name;
  const fallback = item.barrel || '樽情報不明';
  try {
    const prompt = `ウイスキー情報：${item.articleTitle}\n\nこのウイスキーの樽の種類を、簡潔な日本語1つで答えてください。例: バーボン樽、シェリー樽、ピート香の樽、ブレンド。出力は必ずJSON形式で {"barrel":"..."} のみを返してください。`;
    const response = await fetch(LM_STUDIO_API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(AI_MODEL_NAME ? { model: AI_MODEL_NAME } : {}), temperature: 0.25,
        messages: [
          { role: 'system', content: 'あなたは日本語のウイスキー編集者です。出力は必ずJSONのみで返してください。' },
          { role: 'user', content: prompt }
        ]
      })
    });
    if (!response.ok) throw new Error(`LocalLM ${response.status}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const parsed = safeJsonParse(content);
    const barrel = parsed?.barrel || parsed?.樽 || '';
    return barrel && typeof barrel === 'string' ? barrel.trim() : fallback;
  } catch (error) {
    console.warn(`createBarrel failed for ${rawName}: ${error.message}`);
    return fallback;
  }
}

async function createSectionText(item, sectionTitle, description, fallbackText) {
  const rawName = item.rawName || item.name;
  const fallback = fallbackText || `${rawName}の${sectionTitle}に関する説明です。`;
  try {
    const prompt = `ウイスキー情報：${item.articleTitle}\n\n「${sectionTitle}」について、${description}。日本語で400文字程度で書いてください。出力は必ずJSONのみで {"text":"..."} 形式で返してください。特別に重要な単語や大事なポイントには、適宜 <b>太字</b> やハイライト（<mark>文章</mark>）を使って見やすく色付けしてください。`;
    const response = await fetch(LM_STUDIO_API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(AI_MODEL_NAME ? { model: AI_MODEL_NAME } : {}), temperature: 0.3,
        messages: [
          { role: 'system', content: 'あなたは日本のウイスキー編集者です。出力は必ずJSON形式で返してください。' },
          { role: 'user', content: prompt }
        ]
      })
    });
    if (!response.ok) throw new Error(`LocalLM ${response.status}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const parsed = safeJsonParse(content);
    return (parsed && parsed.text) ? String(parsed.text).replace(/\*/g, '').replace(/\n/g, '<br>').trim() : fallback;
  } catch (error) {
    console.warn(`createSectionText failed for ${sectionTitle}: ${error.message}`);
    return fallback;
  }
}

async function createWays(item) {
  const rawName = item.rawName || item.name;
  const fallback = ['ストレート', 'ロック', 'ハイボール'];
  try {
    const prompt = `ウイスキー情報：${item.articleTitle}\n\nこのウイスキーに向いているおすすめの飲み方を、3つの短い日本語の文字列で作成してください。出力は必ずJSONのみで {"ways":["...","...","..."]} 形式で返してください。文字列の中に二重引用符や改行を含めず、値はシンプルな日本語で書いてください。`;
    const response = await fetch(LM_STUDIO_API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(AI_MODEL_NAME ? { model: AI_MODEL_NAME } : {}), temperature: 0.3,
        messages: [
          { role: 'system', content: 'あなたはウイスキーの飲み方を提案する日本語編集者です。出力は必ずJSON形式で返してください。' },
          { role: 'user', content: prompt }
        ]
      })
    });
    if (!response.ok) throw new Error(`LocalLM ${response.status}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const parsed = safeJsonParse(content);
    return Array.isArray(parsed?.ways) && parsed.ways.length ? parsed.ways.map(String).slice(0, 3) : fallback;
  } catch (error) {
    console.warn(`createWays failed: ${error.message}`);
    return fallback;
  }
}

async function createComments(item) {
  const rawName = item.rawName || item.name;
  const fallback = [];
  try {
    const prompt = `ウイスキー情報：${item.articleTitle}\n\nこのウイスキーについて、読者が参考にしたくなる口コミ風コメントを3つ作成してください。各コメントは「name」「text」を持つJSONオブジェクトで表し、出力は必ずJSONのみで {"comments":[{"name":"...","text":"..."},...]} 形式で返してください。コメントの本文に二重引用符や改行を含めず、値はシンプルな日本語で書いてください。nameはランダムな2つの単語を組み合わせた造語とします。`;
    const response = await fetch(LM_STUDIO_API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(AI_MODEL_NAME ? { model: AI_MODEL_NAME } : {}), temperature: 0.35,
        messages: [
          { role: 'system', content: 'あなたはウイスキーの口コミを考える日本語編集者です。出力は必ずJSON形式で返してください。' },
          { role: 'user', content: prompt }
        ]
      })
    });
    if (!response.ok) throw new Error(`LocalLM ${response.status}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const parsed = safeJsonParse(content);
    if (Array.isArray(parsed?.comments) && parsed.comments.length) {
      return parsed.comments.slice(0, 3).map(c => ({
        name: String(c.name || '').trim() || 'ユーザー',
        role: String(c.role || '').trim() || 'ウイスキー好き',
        text: String(c.text || '').trim() || ''
      })).filter(c => c.text);
    }
    return fallback;
  } catch (error) {
    console.warn(`createComments failed: ${error.message}`);
    return fallback;
  }
}

async function translateTitleToEnglish(title) {
  if (!title) return '';
  try {
    const prompt = `次の日本語のウイスキー記事タイトルを、SEOに使える短い英語タイトルに翻訳してください。出力は必ずJSONのみで {"english":"..."} の形式にしてください。\n\n日本語タイトル: ${title}`;
    const res = await fetch(LM_STUDIO_API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'system', content: 'あなたは日本語から英語への翻訳者です。出力は必ずJSONのみで返してください。' }, { role: 'user', content: prompt }], temperature: 0.2 })
    });
    if (!res.ok) throw new Error(`LocalLM ${res.status}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.trim().match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    return (parsed && typeof parsed.english === 'string' && parsed.english.trim()) ? parsed.english.trim() : '';
  } catch (err) {
    console.warn('translateTitleToEnglish failed:', err.message);
    return '';
  }
}

// -------------------------------------------------------------
// 静的HTML出力関数群（SSG化の処理を追加）
// -------------------------------------------------------------

function generateHtmlForProduct(item) {
  const title = item.articleTitle || item.name || 'ウイスキー詳細';
  const priceText = formatPrice(item.price);

  // タグのHTML生成
  const tagsHtml = (item.flavor || [])
    .map(tag => `<span>${tag}</span>`)
    .join('');

  // 星評価の生成
  const scoreNum = parseFloat(item.score) || 0;
  const starsHtml = '★'.repeat(Math.round(scoreNum)) + '☆'.repeat(5 - Math.round(scoreNum));

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} - WhiskyCompass</title>
  <meta name="description" content="${item.characteristic || item.name + 'のレビューと詳細情報'}">
  <link rel="stylesheet" href="/styles.css">
  <style>
    .product {max-width:900px;margin:40px auto;padding:24px;background:#fff;border-radius:8px}
    .product-hero{display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start}
    .product-image{width:320px;height:320px;background:#f3f3f3;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:14px;color:#999;overflow:hidden}
    .product-image img{width:100%;height:100%;object-fit:contain}
    .product-meta{flex:1 1 380px;min-width:0}
    .product-meta h1{font-size:26px;margin:0 0 8px;overflow-wrap:anywhere;word-break:break-word;}
    .price-chart{display:flex;align-items:flex-start;gap:20px;flex-wrap:wrap;margin-top:18px}
    .price-chart > div:first-child{flex:1 1 220px;min-width:170px}
    .price{font-weight:700;color:var(--amber, #d97706);font-size:20px;margin:8px 0}
    .radar-box{max-width:100%;width:100%;height:auto;border:1px solid #e5d4a3;border-radius:18px;padding:14px;background:#fff;box-shadow:0 10px 28px rgba(0,0,0,0.08);position:relative}
    .radar-box canvas{width:100%;height:180px;display:block}
    .radar-box .radar-label{display:block;margin:0 0 10px;font-size:12px;color:#5d6a5f;text-align:center}
    .radar-legend{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;margin-top:12px;font-size:11px;color:#5d6a5f;text-align:center}
    .radar-legend span{background:#f9f7f0;padding:4px 6px;border-radius:6px;display:inline-block}
    .tags span{display:inline-block;background:#f1efe9;padding:6px 8px;border-radius:6px;margin-right:8px;font-size:13px}
    .toc{display:grid;gap:10px;background:#f7f3e7;border:1px solid #e2d7c3;border-radius:14px;padding:18px;margin:28px 0}
    .toc strong{display:block;margin-bottom:8px;color:#6a593f;font-size:13px;letter-spacing:1px}
    .toc a{color:#17382e;text-decoration:none;font-size:14px;display:block;padding:6px 12px;border-radius:10px;transition:background .2s}
    .toc a:hover{background:rgba(26,56,37,.06)}
    .product-section{margin-top:32px}
    .product-section h2{font-size:22px;margin-bottom:16px}
    .section-copy{font-size:15px;line-height:1.9;color:#41403c}
    .section-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
    .info-card{background:#fbfaf6;border:1px solid #e6dcc7;border-radius:14px;padding:18px}
    .info-card h3{font-size:16px;margin:0 0 10px}
    .info-card p{margin:0;color:#4d584d}
    .detail-table{width:100%;border-collapse:collapse;margin-top:18px}
    .detail-table th,.detail-table td{padding:12px 14px;border:1px solid #e5e0d4;text-align:left;font-size:14px}
    .detail-table th{background:#faf7f1;color:#5e594f;width:180px}
    .comment-list{display:grid;gap:16px;margin-top:18px}
    .comment-card{display:flex;gap:14px;align-items:flex-start;background:#fffdf7;border:1px solid #efe6d8;border-radius:18px;padding:16px}
    .comment-avatar{width:42px;height:42px;border-radius:50%;background:#d8c6a2;color:#3f2c10;font-weight:700;display:grid;place-items:center;font-size:16px;flex-shrink:0}
    .comment-bubble{background:#fff;border:1px solid #ece3d3;border-radius:18px 18px 18px 4px;padding:14px;position:relative}
    .comment-bubble::after{content:'';position:absolute;left:16px;bottom:-10px;width:0;height:0;border:10px solid transparent;border-top-color:#fff;border-bottom:0;margin-left:-10px}
    .comment-bubble p{margin:0 0 8px;color:#4a4a45;line-height:1.8}
    .comment-meta{font-size:12px;color:#7a715c}
    @media (max-width:760px){.section-grid{grid-template-columns:1fr}.product-hero{flex-direction:column}.product-image{width:100%;height:auto;min-height:260px}.product-meta{width:100%}.radar-box canvas{height:150px}} 
    .buy-links a{display:inline-block;margin-right:10px;padding:10px 14px;border-radius:6px;text-decoration:none;background:#17382e;color:#fff}
    .back-link{display:inline-block;margin-bottom:12px;color:var(--ink, #333);text-decoration:none}
  </style>
</head>
<body>
  <div class="product">
    <a href="/" class="back-link">← 戻る</a>

    <div class="product-hero">
      <div class="product-image">
        <img src="${item.image || '/assets/no-image.png'}" alt="${title}">
      </div>

      <div class="product-meta">
        <h1>${title}</h1>
        <p class="section-copy" style="margin: 0 0 12px;">${item.characteristic || item.note || ''}</p>
        <p style="font-size: 13px; color: #7a715c; margin: 0 0 8px;">${item.origin || ''}</p>
        
        <div>
          <span style="color: #d97706;">${starsHtml}</span>
          <span style="font-weight: bold; margin-left: 4px;">${item.score || '0.0'}</span>
        </div>

        <div class="price-chart">
          <div>
            <div class="price">${priceText}</div>
            <div class="tags" style="margin-top: 12px;">
              ${tagsHtml}
            </div>
            <div class="buy-links" style="margin-top: 16px;">
              ${item.amazon ? `<a href="${item.amazon}" target="_blank" rel="noopener">Amazonで見る</a>` : ''}
              ${item.rakuten ? `<a href="${item.rakuten}" target="_blank" rel="noopener">楽天市場で見る</a>` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- スペック詳細テーブル -->
    <div class="product-section">
      <h2>基本スペック</h2>
      <table class="detail-table">
        <tr><th>原産国 / ブランド</th><td>${item.origin || '不明'}</td></tr>
        <tr><th>度数</th><td>${item.abv || '不明'}</td></tr>
        <tr><th>容量</th><td>${item.volume || '不明'}</td></tr>
        <tr><th>樽</th><td>${item.barrel || '不明'}</td></tr>
      </table>
    </div>

    <!-- 特徴・レビューセクション -->
    ${item.sectionTasting ? `
      <div class="product-section">
        <h2>テイスティング</h2>
        <p class="section-copy">${item.sectionTasting}</p>
      </div>
    ` : ''}
  </div>
</body>
</html>`;
}

async function writeProducts(products) {
  // 1. JSON (whiskies.js) の保存
  const payload = `// Generated by ../app.js at ${new Date().toISOString()}. Do not edit manually.\nwindow.WHISKY_DATA = ${JSON.stringify(products, null, 2)};\n`;
  await fs.writeFile(OUTPUT_FILE, payload, 'utf8');

  // 2. 各商品ごとの静的 HTML (products/<slug>/index.html) の一括生成
  console.log('\n商品ページのHTMLを自動生成中...');
  for (const item of products) {
    const slug = item.slug || item.id;
    if (!slug) continue;

    const itemDir = path.join(PRODUCTS_DIR, slug);
    await fs.mkdir(itemDir, { recursive: true });

    const htmlContent = generateHtmlForProduct(item);
    await fs.writeFile(path.join(itemDir, 'index.html'), htmlContent, 'utf8');
  }
  console.log(`全 ${products.length} 件の静的HTMLページ生成が完了しました！`);
}

// -------------------------------------------------------------

async function main() {
  await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  await fs.mkdir(PRODUCTS_DIR, { recursive: true });

  if (!RAKUTEN_APP_ID || !RAKUTEN_ACCESS_KEY) {
    console.warn('Rakuten credentials are not set; preserving the built-in review cards.');
    process.exitCode = 0;
    return;
  }

  const existing = await loadExistingProducts();
  const existingTitles = new Set(existing.map(w => canonicalTitle(w.articleTitle || w.name)));
  const newTitles = new Set();

  const [popularRaw, latestRaw] = await Promise.all([rakutenSearch('-reviewCount'), rakutenSearch('-updateTimestamp')]);
  const seen = new Set();
  const candidates = [
    ...popularRaw.map(x => [x, 'popular']),
    ...latestRaw.map(x => [x, 'latest'])
  ];

  let products = candidates
    .filter(([item]) => isBottle(item))
    .map(([item, source], index) => normaliseRakutenItem(item, source, index))
    .filter(item => item.name && !seen.has(item.name) && seen.add(item.name));

  products = products.slice(0, 60);
  for (const item of products) {
    item.origin = await extractOrigin(item);
  }

  if (products.length === 0) {
    throw new Error(`No publishable whisky products found (popular: ${popularRaw.length}, latest: ${latestRaw.length}). Existing public data was kept.`);
  }

  console.log('\nSelected whisky products:');
  products.forEach((item, index) => {
    console.log(`${String(index + 1).padStart(2, '0')}. [${item.source}] ${item.name} — ¥${item.price.toLocaleString('ja-JP')}`);
  });

  console.log('\n');

  const newProducts = [];
  for (const item of products) {
    const article = await createArticle(item);
    item.articleTitle = article.title;

    const summaryName = await createNameSummary(item);
    item.name = summaryName;

    const candidateTitle = item.articleTitle;
    const titleKey = canonicalTitle(candidateTitle);
    if (existingTitles.has(titleKey) || newTitles.has(titleKey)) {
      console.log(`Skipping duplicate article title (pre-check): ${item.rawName} -> ${candidateTitle}`);
      continue;
    }
    item.abv = await createAbv(item) || item.abv || '';
    item.volume = await createVolume(item) || item.volume || '';
    item.style = await createStyle(item) || item.style || styleFor(item.rawName || item.name);
    item.barrel = await createBarrel(item) || item.barrel || '樽情報不明';
    item.characteristic = await createCharacteristic(item) || item.characteristic || '';
    item.note = await createReview(item);
    item.sectionBasics = await createSectionText(item, '基本スペック', '原産国・度数・樽の種類・容量を除いた基本情報を、簡潔に整理して説明してください。', `${item.origin || '原産国不明'}・${item.abv || '?％'}・${item.volume || '?ml'}の基本スペックです。`);
    item.sectionDistillery = await createSectionText(item, 'このウイスキーについて', '蒸留所の特徴や歴史、製法・ブランド背景をわかりやすく説明してください。', item.caption || item.note || 'このウイスキーの全体像を説明します。');
    item.sectionTasting = await createSectionText(item, 'テイスティングレビュー', '香り・味わい・余韻を具体的にわかりやすく説明してください。', item.note);
    item.sectionWays = await createWays(item);
    item.sectionFood = await createSectionText(item, 'おすすめの飲み方＆相性の良いおつまみ', '飲み方の提案と相性の良いおつまみを合わせて説明してください。', 'ハイボールやロックで飲みやすさを活かし、軽いおつまみとの相性が良いです。');
    item.sectionPrice = await createSectionText(item, '定価・価格相場と買える場所', '参考価格相場といつどこで買えるかを、購入時に役立つ形で説明してください。', `価格は約${formatPrice(item.price)}程度です。`);
    item.sectionReviews = await createSectionText(item, '口コミ・評判', '口コミや評判の傾向を、中立的な表現でまとめてください。', item.note);
    item.sectionAudience = await createSectionText(item, 'こんな人におすすめ', 'どんなシーンや飲み手に向いているか、類似銘柄との比較も含めて説明してください。', item.note);
    item.sectionSummary = await createSectionText(item, 'まとめ', 'このウイスキーの総合的なおすすめポイントを簡潔にまとめてください。', item.note);
    item.sectionOverview = item.sectionDistillery;
    item.sectionTaste = item.sectionTasting;
    item.sectionPriceSummary = item.sectionPrice;
    item.userComments = await createComments(item);
    const finalTitle = item.articleTitle;
    const finalTitleKey = canonicalTitle(finalTitle);
    if (existingTitles.has(finalTitleKey) || newTitles.has(finalTitleKey)) {
      console.log(`Skipping duplicate article title (post-AI): ${item.rawName} -> ${finalTitle}`);
      continue;
    }
    
    item.articleBody = article.body;
    const englishTitle = await translateTitleToEnglish(item.articleTitle || item.name);
    item.slug = slugify(englishTitle || item.articleTitle || item.name);
    item.amazon = amazonSearchUrl(item.articleTitle || item.name);
    newProducts.push(item);
    newTitles.add(finalTitleKey);
  }

  const mergedProducts = [...existing, ...newProducts];
  
  // WHISKY_DATA の書き出し ＆ HTMLファイルの自動生成を実行
  await writeProducts(mergedProducts);
  console.log(`Published ${newProducts.length} new Rakuten product reviews to ${OUTPUT_FILE} (total ${mergedProducts.length})`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });