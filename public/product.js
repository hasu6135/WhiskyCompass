// product.js: render product detail based on ?id=...
(function(){
  function q(selector){return document.querySelector(selector)}
  function getId(){const p=new URLSearchParams(location.search);const q = p.get('id'); if(q) return q; // fallback to path-based slug
    const parts = location.pathname.split('/').filter(Boolean); const last = parts[parts.length-1] || ''; return last || null; }
  function formatPrice(n){if(!n && n!==0) return ''; return n.toLocaleString() + '円'}

  function radarMetrics(item){
    const flavor = item.flavor || [];
    const style = item.style || [];
    const has = label => flavor.includes(label) || style.includes(label);
    const drinkability = style.includes('ハイボール') ? 9 : 6;
    return [
      {label:'スモーキー', value: has('スモーキー') ? 9 : 3},
      {label:'フルーティー', value: has('フルーティー') ? 9 : 4},
      {label:'バニラ', value: has('バニラ') ? 9 : 3},
      {label:'リッチ', value: has('リッチ') ? 9 : 4},
      {label:'華やか', value: has('華やか') ? 9 : 4},
      {label:'飲みやすさ', value: drinkability}
    ];
  }

  function drawRadarChart(canvas, axes){
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const width = rect.width;
    const height = rect.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.32;
    const step = axes.length;
    const angleStep = (Math.PI * 2) / step;
    ctx.clearRect(0,0,width,height);
    ctx.strokeStyle = '#d7d3c8';
    ctx.lineWidth = 1;
    for(let i = 1; i <= 4; i++){
      const r = (radius / 4) * i;
      ctx.beginPath();
      axes.forEach((axis, index) => {
        const angle = angleStep * index - Math.PI / 2;
        const x = centerX + Math.cos(angle) * r;
        const y = centerY + Math.sin(angle) * r;
        i === 1 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
      });
      ctx.closePath();
      ctx.stroke();
    }
    axes.forEach((axis, index) => {
      const angle = angleStep * index - Math.PI / 2;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(x, y);
      ctx.stroke();
    });
    ctx.font = '11px Noto Sans JP, sans-serif';
    ctx.fillStyle = '#4f5c52';
    axes.forEach((axis, index) => {
      const angle = angleStep * index - Math.PI / 2;
      const x = centerX + Math.cos(angle) * (radius + 12);
      const y = centerY + Math.sin(angle) * (radius + 12);
      ctx.textAlign = x < centerX ? 'right' : x > centerX ? 'left' : 'center';
      ctx.textBaseline = y < centerY ? 'bottom' : y > centerY ? 'top' : 'middle';
      ctx.fillText(axis.label, x, y);
    });
    ctx.beginPath();
    axes.forEach((axis, index) => {
      const ratio = Math.min(10, Math.max(0, axis.value)) / 10;
      const angle = angleStep * index - Math.PI / 2;
      const x = centerX + Math.cos(angle) * radius * ratio;
      const y = centerY + Math.sin(angle) * radius * ratio;
      index === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(56, 86, 50, 0.22)';
    ctx.fill();
    ctx.strokeStyle = '#385632';
    ctx.lineWidth = 2;
    ctx.stroke();
    axes.forEach((axis, index) => {
      const ratio = Math.min(10, Math.max(0, axis.value)) / 10;
      const angle = angleStep * index - Math.PI / 2;
      const x = centerX + Math.cos(angle) * radius * ratio;
      const y = centerY + Math.sin(angle) * radius * ratio;
      ctx.fillStyle = '#385632';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function getServingMethods(item){
    const flavor = item.flavor || [];
    const style = item.style || [];
    const methods = [];
    if(style.includes('ハイボール') || style.includes('ジャパニーズ')) methods.push('ハイボール');
    if(flavor.includes('スモーキー') || style.includes('スコッチ')) methods.push('ロック');
    if(flavor.includes('フルーティー') || flavor.includes('バニラ')) methods.push('水割り');
    if(!methods.length) methods.push('ストレート', 'ハイボール');
    return [...new Set(methods)].slice(0,3);
  }

  function buildPriceTable(item){
    const price = formatPrice(item.price);
    const amazon = item.amazon ? `<a target="_blank" rel="noopener noreferrer" href="${item.amazon}">Amazon</a>` : 'Amazon';
    const rakuten = item.rakuten ? `<a target="_blank" rel="noopener noreferrer" href="${item.rakuten}">楽天</a>` : '楽天';
    return `
      <table class="detail-table">
        <tr><th>購入先</th><td>${amazon}</td><th>容量</th><td>${item.volume || '―'}</td></tr>
        <tr><th>参考価格</th><td>${price}</td><th>配送</th><td>ショップに準ずる</td></tr>
        <tr><th>おすすめ理由</th><td colspan="3">${item.flavor && item.flavor.length ? item.flavor.join('・') + 'の味わいが魅力' : '飲みやすくて普段使いにおすすめ'}</td></tr>
      </table>
    `;
  }

  function normalizeHandle(value) {
    const text = String(value || '').trim();
    return text.replace(/[^\p{L}\p{N}_]+/gu, '');
  }

  function buildCommentHandle(comment) {
    const namePart = normalizeHandle(comment.name || 'ユーザー').slice(0, 10);
    return `@${namePart}`;
  }

  function buildComments(comments){
    const defaultComments = [
      {name:'佐藤さん',role:'初めての方',text:'柔らかい甘さとほのかなスモーキー感がちょうどよく、初めてのブレンデッドにもぴったりでした。'},
      {name:'山本さん',role:'ハイボール派',text:'氷を入れても味がぼやけず、爽やかさがしっかり残るのでハイボールで楽しめます。'},
      {name:'中村さん',role:'ギフト検討中',text:'価格も手頃でラベルも品があるので、贈り物としても安心できる一本です。'}
    ];
    const list = Array.isArray(comments) && comments.length ? comments : defaultComments;
    return list.map(c=>`
      <div class="comment-card">
        <div class="comment-avatar">${String(c.name || '').slice(0,1) || 'U'}</div>
        <div class="comment-bubble">
          <p>${c.text || ''}</p>
          <div class="comment-meta">${buildCommentHandle(c)}</div>
        </div>
      </div>
    `).join('');
  }

  function createSectionAnchor(title, id){ return `<a href="#${id}">${title}</a>`; }

  const id = getId();
  const container = q('#productContent');
  if(!id){ container.innerHTML = '<p>商品IDが指定されていません。</p>'; return }
  const list = Array.isArray(window.WHISKY_DATA) ? window.WHISKY_DATA : [];
  const item = list.find(w=>w.id===id || w.slug===id);
  if(!item){ container.innerHTML = '<p>該当する商品が見つかりませんでした。</p>'; return }

  const title = item.articleTitle || item.name;
  const basicsText = item.sectionBasics || `${item.origin || '原産国不明'}のウイスキーで、${item.abv || '?％'}・${item.volume || '?ml'}の基本スペックが整理されています。`;
  const distilleryText = item.sectionDistillery || item.sectionOverview || (item.origin ? `${item.origin} をベースにした、穏やかでバランスのいい味わいが魅力です。` : 'バランスよく飲みやすいウイスキーです。');
  const tastingText = item.sectionTasting || item.sectionTaste || `香りは${item.flavor?.join('、')}が中心で、口に含むと程よい甘さとコクが感じられます。余韻には穏やかなスモーキーさが残り、飲み疲れしにくい軽やかさも魅力です。`;
  const methods = Array.isArray(item.sectionWays) && item.sectionWays.length ? item.sectionWays : getServingMethods(item);
  const servingText = item.sectionFood || '飲みやすさを活かしたハイボールやロックに加え、程よい甘みの食材との相性が良いです。';
  const priceText = item.sectionPrice || item.sectionPriceSummary || `最新の価格を参考にした相場感です。購入先によって価格やキャンペーンが変わる可能性があります。`;
  const reviewsText = item.sectionReviews || '定番の口コミ評価は、香りや飲みやすさに好意的な声が中心でした。';
  const audienceText = item.sectionAudience || 'まずは飲みやすい一本を探している方や、幅広いシーンで使える定番ボトルを探している方におすすめです。';
  const summaryText = item.sectionSummary || 'バランタイン ファイネストは、ほどよい甘さと香りのバランスが魅力の定番ブレンデッドです。初めての方から贈り物まで幅広く使える一本としておすすめです。';
  const comments = Array.isArray(item.userComments) && item.userComments.length ? item.userComments : null;
  const styleText = Array.isArray(item.style) && item.style.length ? item.style.join(' / ') : 'ー';

  container.innerHTML = `
    <div class="product-hero">
      <div class="product-image">${item.image?`<img src="${item.image}" alt="${item.label||item.name}" style="width:100%;height:100%;object-fit:contain">`:'画像無し'}</div>
      <div class="product-meta">
        <h1>${title}</h1>
        ${item.articleTitle && item.articleTitle !== item.name ? `<p class="product-subtitle">${item.name}</p>` : ''}
        <div class="origin">${item.origin||''}</div>
        <div class="rating">★★★★★ <b>${item.score||'ー'}</b></div>
        <div class="price-chart">
          <div>
            <div class="price">${formatPrice(item.price)}</div>
            <div class="tags">${(item.flavor||[]).map(t=>`<span>${t}</span>`).join('')}</div>
          </div>
        </div>
        <div style="margin-top:14px" class="buy-links">
          <a target="_blank" rel="noopener noreferrer" href="${item.amazon||'#'}">Amazonで見る</a>
          <a target="_blank" rel="noopener noreferrer" href="${item.rakuten||'#'}">楽天市場で見る</a>
        </div>
        <div class="radar-box" style="margin-top:20px">
          <canvas id="radarCanvas" width="220" height="180"></canvas>
        </div>
      </div>
    </div>

    <nav class="toc">
      <strong>目次</strong>
      ${createSectionAnchor('基本スペック', 'basics')}
      ${createSectionAnchor('このウイスキーについて', 'overview')}
      ${createSectionAnchor('テイスティングレビュー', 'taste')}
      ${createSectionAnchor('おすすめの飲み方＆相性の良いおつまみ', 'ways')}
      ${createSectionAnchor('定価・価格相場と買える場所', 'price')}
      ${createSectionAnchor('口コミ・評判', 'reviews')}
      ${createSectionAnchor('こんな人におすすめ', 'audience')}
      ${createSectionAnchor('まとめ', 'summary')}
    </nav>

    <section id="basics" class="product-section">
      <h2>基本スペック</h2>
      <div class="section-copy">
        <p>${basicsText}</p>
      </div>
      <table class="detail-table">
        <tr><th>原産国</th><td>${item.origin || '原産国不明'}</td><th>度数</th><td>${item.abv || '―'}</td></tr>
        <tr><th>容量</th><td>${item.volume || '―'}</td><th>樽の種類</th><td>${item.barrel || '―'}</td></tr>
        <tr><th>スタイル</th><td>${styleText}</td><th>販売元</th><td>${item.shopName || '―'}</td></tr>
      </table>
    </section>

    <section id="overview" class="product-section">
      <h2>このウイスキーについて</h2>
      <div class="section-grid">
        <div class="section-copy">
          <p>${distilleryText}</p>
          <ul>
            <li>スタイル: ${styleText}</li>
            <li>容量: ${item.volume || '?ml'}</li>
            <li>アルコール度数: ${item.abv || '?％'}</li>
          </ul>
        </div>
        <div class="info-card">
          <h3>特徴</h3>
          <p>${item.characteristic || 'バランスの良い味わいで、幅広い場面で楽しみやすい一本です。'}</p>
        </div>
      </div>
    </section>

    <section id="taste" class="product-section">
      <h2>テイスティングレビュー</h2>
      <div class="section-copy">
        <p>${tastingText}</p>
      </div>
    </section>

    <section id="ways" class="product-section">
      <h2>おすすめの飲み方＆相性の良いおつまみ</h2>
      <div class="section-copy">
        <p>${servingText}</p>
        ${Array.isArray(methods)
          ? `<ul>${methods.map(m=>`<li>${m}</li>`).join('')}</ul>`
          : `<p>${methods}</p>`}
      </div>
    </section>

    <section id="price" class="product-section">
      <h2>定価・価格相場と買える場所</h2>
      <div class="section-copy">${priceText}</div>
      ${buildPriceTable(item)}
    </section>

    <section id="reviews" class="product-section">
      <h2>口コミ・評判</h2>
      <div class="section-copy">
        <p>${reviewsText}</p>
      </div>
      <div class="comment-list">
        ${buildComments(comments)}
      </div>
    </section>

    <section id="audience" class="product-section">
      <h2>こんな人におすすめ</h2>
      <div class="section-copy">
        <p>${audienceText}</p>
      </div>
    </section>

    <section id="summary" class="product-section">
      <h2>まとめ</h2>
      <div class="section-copy">
        <p>${summaryText}</p>
      </div>
    </section>
  `;
  const radarCanvas = q('#radarCanvas');
  if (radarCanvas) drawRadarChart(radarCanvas, radarMetrics(item));
  // Push a pretty URL without reloading, e.g. /products/<slug>
  try{
    const slug = item.slug || item.id;
    const pretty = `/products/${encodeURIComponent(slug)}`;
    if (history && history.replaceState) history.replaceState({}, '', pretty);
  }catch(e){/* ignore */}
})();
