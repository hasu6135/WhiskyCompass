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

const HITS = 5;
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

function writeProducts(products) {
  const payload = `// Generated by ../app.js at ${new Date().toISOString()}. Do not edit manually.\nwindow.WHISKY_DATA = ${JSON.stringify(products, null, 2)};\n`;
  return fs.writeFile(OUTPUT_FILE, payload, 'utf8');
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

function getRakutenImageUrl(item) {
  const candidates = [
    item.mediumImageUrls,
    item.largeImageUrls,
    item.smallImageUrls,
    item.imageUrls,
    item.imageUrl ? [item] : null
  ];
  for (const list of candidates) {
    if (!Array.isArray(list) || !list.length) continue;
    const imageObj = list[0];
    const url = imageObj?.imageUrl || imageObj?.url || imageObj?.image || '';
    if (url) return url;
  }
  const fallback = item.imageUrl || item.image || '';
  if (typeof fallback === 'string' && fallback.trim()) return fallback.trim();
  return findImageUrl(item);
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
  // Use a title fallback from the Rakuten-normalized title, but let LocalLM shape the final article title and body.
  const fallbackTitle = formatArticleTitle(item);
  const rawName = item.rawName || item.name;
  const fallbackBody = item.note || `${rawName} はおすすめのウイスキーです。詳細は販売ページでご確認ください。`;
  try {
    const prompt = `商品情報:\n名前: ${rawName}\n価格: ${item.price || ''}\n説明: ${item.caption || ''}\nタグ: ${(item.flavor||[]).join('、')}\n\n出力形式: JSON で {"title":"...","body":"..."} のみを返してください。タイトルは「ウイスキー名 銘柄名 熟成年数 容量」の形式を優先して短く、本文は120〜300文字の日本語で説明を書くこと。`;
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

async function createNameSummary(item) {
  const rawName = item.rawName || item.name;
  const fallback = rawName;
  try {
    const prompt = `商品情報:\n名前: ${rawName}\n価格: ${item.price || ''}\n説明: ${item.caption || ''}\nタグ: ${(item.flavor||[]).join('、')}\n\n出力形式: JSON で {"name":"..."} のみを返してください。このウイスキーを一言で表現する文言を、20〜40文字の日本語で作成してください。`;
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
  const fallback = `${rawName}は${item.flavor.join('・')}の印象を楽しみたい方に向く候補です。販売ページで容量・度数・価格をご確認ください。`;
  console.log(`Generating LocalLM review for ${rawName}...`);
  try {
    const response = await fetch(LM_STUDIO_API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(AI_MODEL_NAME ? { model: AI_MODEL_NAME } : {}), temperature: 0.35,
        messages: [
          { role: 'system', content: 'あなたは日本のウイスキー編集者です。与えられた販売情報だけを根拠に、断定・受賞歴・在庫の主張をせず、80〜120字の中立な紹介文を日本語で作成してください。HTMLは不要です。' },
          { role: 'user', content: `商品名: ${rawName}\n商品説明: ${item.caption || 'なし'}\n価格: ${item.price}円\nレビュー平均: ${item.score}\n想定タグ: ${item.flavor.join('、')}` }
        ]
      })
    });
    if (!response.ok) throw new Error(`LocalLM ${response.status}`);
    const data = await response.json();
    return String(data.choices?.[0]?.message?.content || fallback).replace(/<[^>]*>/g, '').trim().slice(0, 260);
  } catch (error) {
    console.warn(`LocalLM review skipped for ${rawName}: ${error.message}`);
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

async function main() {
  await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  if (!RAKUTEN_APP_ID || !RAKUTEN_ACCESS_KEY) {
    console.warn('Rakuten credentials are not set; preserving the built-in review cards.');
    process.exitCode = 0;
    return;
  }

  const existing = await loadExistingProducts();
  const existingTitles = new Set(existing.map(w => canonicalTitle(w.articleTitle || w.name)));
  const newTitles = new Set();

  const [popularRaw, latestRaw] = await Promise.all([rakutenSearch('-reviewCount'), rakutenSearch('-updateTimestamp')]);
  // Using Rakuten only; Amazon affiliate links will point to Amazon search results based on title
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
    const summaryName = await createNameSummary(item);
    item.name = summaryName;

    const candidateTitle = formatArticleTitle(item);
    const titleKey = canonicalTitle(candidateTitle);
    if (existingTitles.has(titleKey) || newTitles.has(titleKey)) {
      console.log(`Skipping duplicate article title (pre-check): ${item.rawName} -> ${candidateTitle}`);
      continue;
    }
    item.note = await createReview(item);
    const article = await createArticle(item);
    const finalTitle = article.title || candidateTitle;
    const finalTitleKey = canonicalTitle(finalTitle);
    if (existingTitles.has(finalTitleKey) || newTitles.has(finalTitleKey)) {
      console.log(`Skipping duplicate article title (post-AI): ${item.rawName} -> ${finalTitle}`);
      continue;
    }
    item.articleTitle = finalTitle;
    item.articleBody = article.body;
    const englishTitle = await translateTitleToEnglish(item.articleTitle || item.name);
    item.slug = slugify(englishTitle || item.articleTitle || item.name);
    item.amazon = amazonSearchUrl(item.articleTitle || item.name);
    newProducts.push(item);
    newTitles.add(finalTitleKey);
  }

  const mergedProducts = [...existing, ...newProducts];
  await writeProducts(mergedProducts);
  console.log(`Published ${newProducts.length} new Rakuten product reviews to ${OUTPUT_FILE} (total ${mergedProducts.length})`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
