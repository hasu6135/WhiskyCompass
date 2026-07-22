// product.js: render product detail based on ?id=...
(function(){
  function q(selector){return document.querySelector(selector)}
  function getId(){const p=new URLSearchParams(location.search);const q = p.get('id'); if(q) return q; // fallback to path-based slug
    const parts = location.pathname.split('/').filter(Boolean); const last = parts[parts.length-1] || ''; return last || null; }
  function formatPrice(n){if(!n && n!==0) return ''; return n.toLocaleString() + '円'}

  const id = getId();
  const container = q('#productContent');
  if(!id){ container.innerHTML = '<p>商品IDが指定されていません。</p>'; return }
  const list = Array.isArray(window.WHISKY_DATA) ? window.WHISKY_DATA : [];
  const item = list.find(w=>w.id===id || w.slug===id);
  if(!item){ container.innerHTML = '<p>該当する商品が見つかりませんでした。</p>'; return }

  container.innerHTML = `
    <div class="product-hero">
      <div class="product-image">${item.image?`<img src="${item.image}" alt="${item.label||item.name}" style="width:100%;height:100%;object-fit:contain">`:'画像無し'}</div>
      <div class="product-meta">
        <h1>${item.articleTitle||item.name}</h1>
        ${item.articleTitle && item.articleTitle !== item.name ? `<p class="product-subtitle">${item.name}</p>` : ''}
        <div class="origin">${item.origin||''}</div>
        <div class="rating">★★★★★ <b>${item.score||''}</b></div>
        <div class="price">${formatPrice(item.price)}</div>
        <div class="tags">${(item.flavor||[]).map(t=>`<span>${t}</span>`).join('')}</div>
        <div style="margin-top:14px" class="buy-links">
          <a target="_blank" rel="noopener noreferrer" href="${item.amazon||'#'}">Amazonで見る</a>
          <a target="_blank" rel="noopener noreferrer" href="${item.rakuten||'#'}">楽天市場で見る</a>
        </div>
      </div>
    </div>
    <section style="margin-top:22px">
      <h2>商品説明</h2>
      <p>${(item.caption||item.note||'説明はありません。').replace(/\n/g,'<br>')}</p>
    </section>
  `;
  // Push a pretty URL without reloading, e.g. /products/<slug>
  try{
    const slug = item.slug || item.id;
    const pretty = `/products/${encodeURIComponent(slug)}`;
    if (history && history.replaceState) history.replaceState({}, '', pretty);
  }catch(e){/* ignore */}
})();
