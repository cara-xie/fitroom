/* Moving tools, adapted from Moove (github.com/christianazinn/moove, Cal Hacks 13.0).
   Only the parts Fitroom didn't already have:
     1. Sort  - a card deck: Keep / Sell / Donate / Trash for everything you own (Moove's Review deck)
     2. Sell  - a price range and ready-to-paste listing text for each "Sell" thing (Moove's listing agent, without auto-posting)
     3. New place - rough room sizes from a listing's beds / baths / square feet (Moove's listing import fallback),
                    then "Design this room" opens Fitroom's normal flow with your kept furniture already in it
     4. Pack  - numbered boxes per destination room, fragile rules, OPEN FIRST, printable labels (Moove's packing planner)
   Left out on purpose: room scanning and 3D layout (Fitroom has its own), auto-buying, payments, eBay posting,
   two-phone sharing and voxel models (they need Moove's backend).
   Prices are rough ranges for common used furniture, NOT live sales data. The page says so. */
(function () {
  const KEY = 'fitroom_move_v1';
  /* kind: label, destination group, used price range per unit [lo, hi] (null = you decide), weight lb per unit,
     flags, box volume per unit (share of a medium box), unit word, Fitroom furniture kind */
  const T = {
    sofa: { l: 'Sofa', g: 'living', p: [80, 350], lb: 100, have: 'sofa' },
    bed: { l: 'Bed frame', g: 'bedroom', p: [50, 250], lb: 75, have: 'bed' },
    mattress: { l: 'Mattress', g: 'bedroom', p: [40, 150], lb: 65 },
    dresser: { l: 'Dresser', g: 'bedroom', p: [40, 180], lb: 90, have: 'dresser' },
    desk: { l: 'Desk', g: 'office', p: [30, 120], lb: 55, have: 'desk' },
    chair: { l: 'Chair', g: 'office', p: [15, 80], lb: 18, have: 'chair' },
    table: { l: 'Dining table', g: 'dining', p: [40, 200], lb: 65, have: 'table' },
    coffee: { l: 'Coffee table', g: 'living', p: [20, 90], lb: 25, have: 'coffee' },
    shelf: { l: 'Bookshelf', g: 'living', p: [15, 70], lb: 45, have: 'storage' },
    tv: { l: 'TV', g: 'living', p: [60, 250], lb: 22, fragile: 1, have: 'tv' },
    lamp: { l: 'Floor lamp', g: 'living', p: [10, 40], lb: 10, fragile: 1 },
    mirror: { l: 'Mirror', g: 'bedroom', p: [10, 50], lb: 18, fragile: 1 },
    rug: { l: 'Rug', g: 'living', p: [15, 80], lb: 18 },
    plant: { l: 'Plant', g: 'living', p: [5, 25], lb: 12 },
    microwave: { l: 'Microwave', g: 'kitchen', p: [20, 60], lb: 26 },
    books: { l: 'Books', u: 'shelf', g: 'office', p: [5, 25], lb: 30, v: .8, box: 1 },
    dishes: { l: 'Dishes & glasses', u: 'cabinet', g: 'kitchen', p: [10, 40], lb: 15, v: .7, box: 1, fragile: 1 },
    pots: { l: 'Pots & pans', u: 'drawer', g: 'kitchen', p: [10, 40], lb: 18, v: .6, box: 1 },
    clothes: { l: 'Clothes', u: 'closet rail', g: 'bedroom', p: [10, 60], lb: 15, v: 1.2, box: 1, soft: 1 },
    bedding: { l: 'Bedding & towels', u: 'set', g: 'bedroom', p: [0, 15], lb: 9, v: .6, box: 1, soft: 1, first: 1 },
    decor: { l: 'Decor & frames', u: 'shelf', g: 'living', p: [5, 30], lb: 9, v: .5, box: 1, fragile: 1 },
    electronics: { l: 'Small electronics', u: 'bin', g: 'office', p: [20, 100], lb: 11, v: .5, box: 1, fragile: 1 },
    bathroom: { l: 'Bathroom things', u: 'cabinet', g: 'bath', p: [0, 0], lb: 9, v: .4, box: 1, first: 1 },
    shoes: { l: 'Shoes', u: 'row', g: 'bedroom', p: [10, 50], lb: 11, v: .6, box: 1 },
    hobby: { l: 'Games & hobbies', u: 'bin', g: 'living', p: [5, 40], lb: 11, v: .6, box: 1 },
    keepsake: { l: 'Keepsakes', u: 'bin', g: 'bedroom', p: null, lb: 9, v: .5, box: 1, fragile: 1, sent: 1 }
  };
  const FROM_HAVE = { sofa: 'sofa', bed: 'bed', table: 'table', chair: 'chair', desk: 'desk', dresser: 'dresser', storage: 'shelf', tv: 'tv', coffee: 'coffee' };
  const GROUP = { living: 'Living room', bedroom: 'Bedroom', dining: 'Dining room', kitchen: 'Kitchen', bath: 'Bathroom', office: 'Office' };
  const DEC = { keep: 'Keep', sell: 'Sell', donate: 'Donate', trash: 'Trash' };
  const COND = { new: ['Like new', .8, 'Like new, barely used.'], good: ['Good', .55, 'Good condition, normal wear.'], fair: ['Fair', .3, 'Some visible wear. Priced to go.'] };
  /* destination colors for box bands (Moove's per-room colors, in this palette) */
  const BAND = ['#46707F', '#B48A3E', '#7FA8A3', '#A24D35', '#4F7889', '#8C9690', '#6E8B5E', '#9A6F8C'];

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const usd = n => '$' + Math.round(n).toLocaleString('en-US');
  const track = (e, p) => { try { window.frTrack && window.frTrack(e, p || {}) } catch (x) { } };

  function blank() { return { items: [], hist: [], tab: 'sort', nid: 1, place: { beds: 1, baths: 1, sqft: 750, link: '', rooms: null } } }
  let M = blank();
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && Array.isArray(s.items)) M = Object.assign(blank(), s, { hist: [] }) } catch (e) { }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(Object.assign({}, M, { hist: [] }))) } catch (e) { } };
  window.FR_MOVE = M;

  function add(k, n) {
    const ex = M.items.find(i => i.k === k && !i.dec);
    if (ex) ex.n += n || 1; else M.items.push({ id: M.nid++, k, n: n || 1, dec: null, to: null, cond: 'good', price: null });
  }
  /* First visit: start from the furniture Fitroom already knows about (scan or "My furniture"). */
  function seed() {
    if (M.seeded) return; M.seeded = true;
    const have = (S.room && S.room.have) || [];
    have.forEach(h => { const k = FROM_HAVE[h.kind]; if (k) add(k, 1) });
  }

  /* ---------- destinations ---------- */
  function rooms() {
    if (M.place.rooms) return M.place.rooms;
    return Object.entries(GROUP).map(([id, name]) => ({ id, name, g: id }));
  }
  function destOf(it) {
    const rs = rooms(); if (it.to && rs.some(r => r.id === it.to)) return it.to;
    const g = T[it.k].g, fit = rs.find(r => r.g === g) || (g === 'office' ? rs.find(r => r.id === 'bed2') || rs.find(r => r.g === 'living') : null) || (g === 'dining' ? rs.find(r => r.g === 'living') : null) || rs[0];
    return fit.id;
  }
  const roomName = id => (rooms().find(r => r.id === id) || {}).name || '';

  /* ---------- money + weight ---------- */
  function range(it) { const p = T[it.k].p; return p ? [p[0] * it.n, p[1] * it.n] : null }
  function ask(it) { if (it.price != null) return it.price; const r = range(it); if (!r || !r[1]) return 0; const m = COND[it.cond || 'good'][1]; return Math.max(5, Math.round((r[0] + (r[1] - r[0]) * m) / 5) * 5) }
  const lbOf = it => T[it.k].lb * it.n;

  /* ---------- page ---------- */
  function p5() {
    seed();
    const sorted = M.items.filter(i => i.dec).length, sells = M.items.filter(i => i.dec === 'sell').length,
      keeps = M.items.filter(i => i.dec === 'keep'), boxes = keeps.length ? pack().boxes.length : 0;
    const tab = (k, l, n) => `<button type="button" role="tab" data-mvtab="${k}" aria-selected="${M.tab === k}">${l}${n ? `<i>${n}</i>` : ''}</button>`;
    const body = M.tab === 'sell' ? sellTab() : M.tab === 'place' ? placeTab() : M.tab === 'pack' ? packTab() : sortTab();
    return `<div class="mvwrap">
<div class="mvhead"><button type="button" class="linkbtn mvback" data-go="0">← Home</button><span class="mvkick">Moving</span></div>
<h1>Your move</h1>
<p class="lede">Sort it, sell it, pack it. Then design the new place.</p>
<div class="mvtabs" role="tablist" aria-label="Moving steps">${tab('sort', 'Sort', M.items.length ? `${sorted}/${M.items.length}` : '')}${tab('sell', 'Sell', sells)}${tab('place', 'New place', M.place.rooms ? M.place.rooms.length : '')}${tab('pack', 'Pack', boxes)}</div>
${body}
</div>`;
  }

  /* 1. Sort */
  function adder() {
    return `<div class="mvadd"><span class="lbl">What are you moving?</span><div class="chips quickadd">${Object.entries(T).map(([k, t]) => `<button type="button" class="idea" data-mvadd="${k}">+ ${t.l}</button>`).join('')}</div></div>`;
  }
  function card(it, i, total) {
    const t = T[it.k], r = range(it);
    return `<div class="mvcard" id="mvCard" data-id="${it.id}" tabindex="0" aria-label="${esc(t.l)}. Swipe right to keep, left to sell, up to donate, down to trash.">
<span class="mvcount">${i + 1} of ${total}</span>
<h2>${esc(t.l)}</h2>
<p class="mvmeta">${t.sent ? 'Only you can decide this one' : r && r[1] ? `≈ ${usd(r[0])}–${usd(r[1])} used` : 'Not usually resold'} · ${lbOf(it)} lb</p>
<div class="mvqty"><button type="button" class="btn small" data-mvn="-1" aria-label="One fewer">−</button><span>${it.n}${t.u ? ' ' + t.u + (it.n > 1 ? 's' : '') : ''}</span><button type="button" class="btn small" data-mvn="1" aria-label="One more">+</button></div>
${t.sent ? '<span class="mvtag">Sentimental</span>' : t.fragile ? '<span class="mvtag">Fragile</span>' : ''}
</div>
<div class="mvact">
<button type="button" class="btn" data-mvdec="sell"><span aria-hidden="true">←</span> Sell</button>
<button type="button" class="btn" data-mvdec="donate"><span aria-hidden="true">↑</span> Donate</button>
<button type="button" class="btn" data-mvdec="trash"><span aria-hidden="true">↓</span> Trash</button>
<button type="button" class="btn primary" data-mvdec="keep">Keep <span aria-hidden="true">→</span></button>
</div>`;
  }
  function sortTab() {
    const open = M.items.filter(i => !i.dec), done = M.items.length - open.length;
    let h = '';
    if (!M.started) {
      const picked = M.items.map(i => esc(T[i.k].l) + (i.n > 1 ? ` ×${i.n}` : '')).join(' · ');
      return adder() + `<p class="hint mvpicked">${M.items.length ? `<b>${M.items.length} picked:</b> ${picked} <button type="button" class="linkbtn" data-mvclear>Clear</button>` : 'Tap each thing you own. Tap twice for two.'}</p>
<button type="button" class="btn primary wide big" data-mvstart${M.items.length ? '' : ' disabled'}>Start sorting${M.items.length ? ` ${M.items.length} things` : ''}</button>`;
    }
    if (open.length) h += `<div class="mvdeck">${card(open[0], done, M.items.length)}<p class="hint mvswipe">Swipe the card, or use the arrow keys.${M.hist.length ? ' <button type="button" class="linkbtn" data-mvundo>Undo</button>' : ''}</p></div>`;
    else h += `<div class="mvdone"><b>All sorted!</b>${M.hist.length ? ' <button type="button" class="linkbtn" data-mvundo>Undo</button>' : ''}</div>`;
    h += board();
    h += `<details class="more mvmore"><summary>Add more things</summary>${adder()}</details>`;
    return h;
  }
  function board() {
    const by = d => M.items.filter(i => i.dec === d);
    if (!M.items.some(i => i.dec)) return '';
    const sell = by('sell').reduce((a, i) => { const r = range(i); return r ? [a[0] + r[0], a[1] + r[1]] : a }, [0, 0]),
      saved = by('sell').concat(by('donate')).reduce((a, i) => a + lbOf(i), 0);
    const opts = cur => rooms().map(r => `<option value="${r.id}"${r.id === cur ? ' selected' : ''}>${esc(r.name)}</option>`).join('');
    const col = d => { const xs = by(d); return `<div class="mvcol"><h3>${DEC[d]} <i>${xs.length}</i></h3>${xs.map(i => `<div class="mvrow"><button type="button" class="mvname" data-mvback="${i.id}" title="Sort again">${esc(T[i.k].l)}${i.n > 1 ? ` ×${i.n}` : ''}</button>${d === 'keep' ? `<select data-mvto="${i.id}" aria-label="Where ${esc(T[i.k].l)} goes">${opts(destOf(i))}</select>` : ''}</div>`).join('') || '<p class="hint">Nothing yet</p>'}</div>` };
    return `<div class="mvstrip"><span><b>${sell[1] ? `≈ ${usd(sell[0])}–${usd(sell[1])}` : '$0'}</b> from selling</span><span><b>${saved} lb</b> kept out of the landfill</span></div>
<div class="mvboard">${col('keep')}${col('sell')}${col('donate')}${col('trash')}</div>`;
  }

  /* 2. Sell */
  function listing(it) {
    const t = T[it.k], c = COND[it.cond || 'good'];
    return `${t.l}${it.n > 1 ? ` (${it.n})` : ''} – ${usd(ask(it))}\n${c[2]} Moving soon, so it needs to go.\nPickup only. Message me if you're interested!`;
  }
  function sellTab() {
    const xs = M.items.filter(i => i.dec === 'sell'), dn = M.items.filter(i => i.dec === 'donate');
    if (!xs.length && !dn.length) return `<div class="mvempty"><b>Nothing to sell yet.</b><p class="hint">Swipe a card left on Sort to sell it.</p><button type="button" class="btn" data-mvtab="sort">Go to Sort</button></div>`;
    return `${xs.map(it => { const t = T[it.k], r = range(it); return `<div class="mvsell">
<div class="mvsellh"><b>${esc(t.l)}${it.n > 1 ? ` ×${it.n}` : ''}</b><span class="hint">${r && r[1] ? `usually ${usd(r[0])}–${usd(r[1])}` : ''}</span></div>
<div class="seg mvcond" role="radiogroup" aria-label="Condition">${Object.entries(COND).map(([k, c]) => `<button type="button" role="radio" aria-checked="${it.cond === k}" class="${it.cond === k ? 'on' : ''}" data-mvcond="${it.id}" data-cv="${k}">${c[0]}</button>`).join('')}</div>
<label class="mvprice"><span>Ask</span><span class="mvdollar">$</span><input type="number" min="0" step="5" value="${ask(it)}" data-mvprice="${it.id}" aria-label="Asking price for ${esc(t.l)}"></label>
<textarea rows="3" readonly id="mvtx${it.id}" aria-label="Listing text">${esc(listing(it))}</textarea>
<button type="button" class="btn small" data-mvcopy="${it.id}">Copy listing</button>
</div>` }).join('')}
${xs.length ? `<details class="more"><summary>How these prices work</summary><p class="hint">They're rough ranges for common used pieces, not live sales data. Check a few similar listings near you before you post.</p></details>` : ''}
${dn.length ? `<h2>To donate</h2><p class="mvlist">${dn.map(i => esc(T[i.k].l) + (i.n > 1 ? ` ×${i.n}` : '')).join(' · ')}</p>` : ''}`;
  }

  /* 3. New place: rough room sizes from beds / baths / sq ft */
  function buildPlace() {
    const P = M.place, beds = Math.max(0, Math.min(5, +P.beds || 0)), baths = Math.max(1, Math.min(4, +P.baths || 1)), sqft = Math.max(250, Math.min(5000, +P.sqft || 700));
    const rs = [];
    if (beds === 0) rs.push({ id: 'living', name: 'Main room', type: 'living', g: 'living', a: 300, asp: 1.3 });
    else rs.push({ id: 'living', name: 'Living room', type: 'living', g: 'living', a: 220, asp: 1.25 });
    rs.push({ id: 'kitchen', name: 'Kitchen', g: 'kitchen', a: 110, asp: 1.3 });
    if (sqft >= 1000) rs.push({ id: 'dining', name: 'Dining room', type: 'dining', g: 'dining', a: 120, asp: 1.1 });
    for (let b = 1; b <= beds; b++) rs.push({ id: 'bed' + b, name: beds === 1 ? 'Bedroom' : b === 1 ? 'Main bedroom' : 'Bedroom ' + b, type: 'bedroom', g: 'bedroom', a: b === 1 ? 160 : 115, asp: 1.15 });
    for (let b = 1; b <= baths; b++) rs.push({ id: 'bath' + b, name: baths === 1 ? 'Bathroom' : 'Bathroom ' + b, g: 'bath', a: 45, asp: 1.5 });
    const sum = rs.reduce((a, r) => a + r.a, 0), s = Math.max(.7, Math.min(1.4, sqft * .85 / sum));
    rs.forEach(r => { const a = r.a * s, w = Math.sqrt(a * r.asp); r.w = Math.round(w * 2) / 2; r.l = Math.round(a / w * 2) / 2; delete r.a; delete r.asp });
    if (beds === 0) rs[0].g = 'living';
    P.rooms = rs; track('move_place_built', { beds, baths, sqft });
  }
  const ft = x => { const f = Math.floor(x), i = Math.round((x - f) * 12); return i ? `${f}′${i}″` : `${f}′` };
  function placeTab() {
    const P = M.place, step = (k, v, min, max) => `<div class="mvstep"><button type="button" class="btn small" data-mvp="${k}" data-d="-1" aria-label="Fewer"${v <= min ? ' disabled' : ''}>−</button><b>${v}</b><button type="button" class="btn small" data-mvp="${k}" data-d="1" aria-label="More"${v >= max ? ' disabled' : ''}>+</button></div>`;
    const keepsIn = id => M.items.filter(i => i.dec === 'keep' && destOf(i) === id);
    return `<p class="hint mvtop">Copy three numbers from the listing. We'll sketch the rooms before you move in.</p>
<div class="mvform">
<div class="dim"><span>Bedrooms</span>${step('beds', P.beds, 0, 5)}</div>
<div class="dim"><span>Bathrooms</span>${step('baths', P.baths, 1, 4)}</div>
<div class="dim"><span>Size</span><div class="ftin"><input type="number" id="mvSqft" min="250" max="5000" step="25" value="${P.sqft}" aria-label="Square feet"><i>sq ft</i></div></div>
<label class="field mvlink"><span class="lbl">Listing link <span class="opt">optional, for your notes</span></span><input type="url" id="mvLink" placeholder="https://" value="${esc(P.link || '')}"></label>
</div>
<button type="button" class="btn primary wide big" data-mvbuild>${P.rooms ? 'Update my rooms' : 'Sketch my new place'}</button>
${P.rooms ? `<h2>Your new place</h2><p class="hint" style="margin-top:-4px">Rough sizes from the listing. Measure or scan once you have the keys.</p>
<div class="mvrooms">${P.rooms.map(r => { const k = keepsIn(r.id); return `<div class="mvroom"><div><b>${esc(r.name)}</b><span class="hint">≈ ${ft(r.w)} × ${ft(r.l)}${k.length ? ` · ${k.length} kept thing${k.length > 1 ? 's' : ''}` : ''}</span></div>${r.type ? `<button type="button" class="btn small primary" data-mvdesign="${r.id}">Design this room</button>` : ''}</div>` }).join('')}</div>
${P.link ? `<p class="hint">Listing: <a href="${esc(P.link)}" target="_blank" rel="noopener noreferrer">${esc(P.link.replace(/^https?:\/\//, '').slice(0, 48))}</a></p>` : ''}` : ''}`;
  }
  function designRoom(id) {
    const r = (M.place.rooms || []).find(x => x.id === id); if (!r || !r.type) return;
    const R = S.room, W = Math.round(r.w * 12), L = Math.round(r.l * 12);
    R.type = r.type; R.wft = Math.floor(W / 12); R.win = W % 12; R.lft = Math.floor(L / 12); R.lin = L % 12;
    R.have = []; R.obs = []; R.cuts = []; R.door = 'S'; R.window = 'N'; R.doorOff = 12;
    S.extra = []; S.removed.clear(); S.catTier = {}; S.catColor = {}; S.layout = null; markDirty();
    const ks = []; M.items.filter(i => i.dec === 'keep' && destOf(i) === id && T[i.k].have).forEach(i => { for (let n = 0; n < i.n; n++)ks.push(T[i.k].have) });
    ks.forEach((k, n) => addHave(k, W * (n % 2 ? .7 : .3), L * Math.min(.8, .28 + .24 * Math.floor(n / 2))));
    track('move_design_room', { type: r.type, kept: ks.length });
    S.sub = 'layout'; S.open1b = ks.length ? 'have' : null; S.view = 'plan'; go(1);
  }

  /* 4. Pack: Moove's rules. Fragile boxes max 18 lb and never with books; soft things pad fragile boxes;
     other boxes max 40 lb; bedding and bathroom things are marked OPEN FIRST. */
  function pack() {
    const keeps = M.items.filter(i => i.dec === 'keep'), byDest = {}, loose = [];
    keeps.forEach(i => { const t = T[i.k]; if (!t.box) { loose.push(i); return } const d = destOf(i); (byDest[d] = byDest[d] || []).push(i) });
    const boxes = []; let no = 1;
    const dests = Object.keys(byDest).sort((a, b) => rooms().findIndex(r => r.id === a) - rooms().findIndex(r => r.id === b));
    dests.forEach(d => {
      const chunks = [];
      byDest[d].forEach(i => { const t = T[i.k], vol = t.v * i.n, n = Math.max(1, Math.ceil(vol / .25)); for (let c = 0; c < n; c++)chunks.push({ k: i.k, v: vol / n, lb: t.lb * i.n / n, fr: !!t.fragile, soft: !!t.soft, first: !!t.first }) });
      const mine = [], open = (fr) => { const b = { no: 0, d, fr, v: 0, lb: 0, c: {}, first: false }; mine.push(b); return b };
      const put = (b, x) => { b.v += x.v; b.lb += x.lb; b.c[x.k] = (b.c[x.k] || 0) + 1; if (x.first) b.first = true };
      const fill = (list, fr, cap) => { let b = null; list.sort((a, b2) => b2.lb / b2.v - a.lb / a.v).forEach(x => { if (!b || b.v + x.v > 1.001 || b.lb + x.lb > cap) b = mine.find(y => y.fr === fr && y.v + x.v <= 1.001 && y.lb + x.lb <= cap) || open(fr); put(b, x) }) };
      fill(chunks.filter(x => x.fr), true, 18);
      const soft = chunks.filter(x => x.soft && !x.fr);
      mine.filter(b => b.fr).forEach(b => { while (soft.length && b.v + soft[0].v <= 1.001 && b.v < .99) { const s = soft.shift(); put(b, s) } });
      fill(chunks.filter(x => !x.fr && !x.soft).concat(soft), false, 40);
      mine.forEach(b => { b.no = no++; boxes.push(b) });
    });
    return { boxes, loose, dests };
  }
  function label(b, color, cls) {
    const ks = Object.keys(b.c);
    return `<div class="${cls || 'mvbox'}"><div class="mvband" style="background:${color}">${esc(roomName(b.d))}</div>
<div class="mvbn">${b.no}</div>
<p class="mvbc">${ks.map(k => esc(T[k].l)).join(', ')}</p>
<p class="mvbm">≈ ${Math.round(b.lb)} lb${b.fr ? ' · <b>FRAGILE</b>' : ''}${b.first ? ' · <b>OPEN FIRST</b>' : ''}</p></div>`;
  }
  function packTab() {
    const keeps = M.items.filter(i => i.dec === 'keep');
    if (!keeps.length) return `<div class="mvempty"><b>Nothing to pack yet.</b><p class="hint">Swipe a card right on Sort to keep it.</p><button type="button" class="btn" data-mvtab="sort">Go to Sort</button></div>`;
    const { boxes, loose } = pack(), color = id => BAND[Math.max(0, rooms().findIndex(r => r.id === id)) % BAND.length];
    const fr = boxes.filter(b => b.fr).length, lb = boxes.reduce((a, b) => a + b.lb, 0);
    const cuft = Math.round(boxes.length * 3 + loose.reduce((a, i) => { const h = T[i.k].have && typeof HAVE !== 'undefined' ? HAVE[T[i.k].have] : null; return a + (h ? h.w * h.d * h.h / 1728 : 6) * i.n }, 0));
    return `<div class="mvstrip"><span><b>${boxes.length}</b> box${boxes.length === 1 ? '' : 'es'}</span><span><b>${fr}</b> fragile</span><span><b>≈ ${Math.round(lb)} lb</b> in boxes</span></div>
${boxes.length ? `<div class="mvboxes">${boxes.map(b => label(b, color(b.d))).join('')}</div>
<button type="button" class="btn primary wide" data-mvprint>Print box labels</button>` : '<p class="hint">No boxes needed. Everything kept goes on the truck as is.</p>'}
${loose.length ? `<h2>On the truck, not in boxes</h2><p class="mvlist">${loose.map(i => esc(T[i.k].l) + (i.n > 1 ? ` ×${i.n}` : '') + ` → ${esc(roomName(destOf(i)))}`).join(' · ')}</p>` : ''}
<p class="hint">About ${cuft} cubic feet in all, a rough guess. Compare it with the truck or van sizes your rental company lists.</p>
<details class="more"><summary>How we pack</summary><p class="hint">Medium boxes. Fragile things get their own boxes, up to 18 lb, padded with clothes and bedding. Other boxes stay under 40 lb. Bedding and bathroom things are marked OPEN FIRST.</p></details>`;
  }
  function printLabels() {
    const { boxes } = pack(), color = id => BAND[Math.max(0, rooms().findIndex(r => r.id === id)) % BAND.length];
    let el = document.getElementById('mvPrint'); if (!el) { el = document.createElement('div'); el.id = 'mvPrint'; document.body.appendChild(el) }
    el.innerHTML = boxes.map(b => label(b, color(b.d), 'mvlabel')).join('');
    document.body.classList.add('mvprinting'); track('move_labels_print', { boxes: boxes.length });
    const done = () => { document.body.classList.remove('mvprinting'); window.removeEventListener('afterprint', done) };
    window.addEventListener('afterprint', done); window.print(); setTimeout(done, 1500);
  }

  /* ---------- actions ---------- */
  function rerender() { save(); const y = window.scrollY; render(); window.scrollTo(0, y) }
  function decide(d) {
    const it = M.items.find(i => !i.dec); if (!it) return;
    it.dec = d; M.hist.push(it.id); track('move_sorted', { decision: d, kind: it.k });
    const c = document.getElementById('mvCard');
    if (c && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const off = { keep: [1, 0], sell: [-1, 0], donate: [0, -1], trash: [0, 1] }[d];
      c.style.transition = 'transform .22s ease, opacity .22s ease'; c.style.transform = `translate(${off[0] * 140}%,${off[1] * 80}%) rotate(${off[0] * 12}deg)`; c.style.opacity = '0';
      setTimeout(rerender, 200);
    } else rerender();
  }

  document.addEventListener('click', e => {
    if (S.step !== 5) return;
    const t = e.target;
    const tb = t.closest('[data-mvtab]'); if (tb) { M.tab = tb.dataset.mvtab; track('move_tab', { tab: M.tab }); save(); render(); window.scrollTo({ top: 0 }); return }
    const ad = t.closest('[data-mvadd]'); if (ad) { add(ad.dataset.mvadd, 1); ad.classList.add('on'); rerender(); return }
    const dc = t.closest('[data-mvdec]'); if (dc) { decide(dc.dataset.mvdec); return }
    const nn = t.closest('[data-mvn]'); if (nn) { const it = M.items.find(i => !i.dec); if (it) { it.n = Math.max(1, it.n + +nn.dataset.mvn); rerender() } return }
    if (t.closest('[data-mvstart]')) { M.started = true; track('move_start_sort', { things: M.items.length }); rerender(); return }
    if (t.closest('[data-mvclear]')) { M.items = []; M.hist = []; rerender(); return }
    if (t.closest('[data-mvundo]')) { const id = M.hist.pop(), it = M.items.find(i => i.id === id); if (it) { it.dec = null; M.items.splice(M.items.indexOf(it), 1); M.items.unshift(it) } rerender(); return }
    const bk = t.closest('[data-mvback]'); if (bk) { const it = M.items.find(i => i.id === +bk.dataset.mvback); if (it) { it.dec = null; M.items.splice(M.items.indexOf(it), 1); M.items.unshift(it) } rerender(); return }
    const cd = t.closest('[data-mvcond]'); if (cd) { const it = M.items.find(i => i.id === +cd.dataset.mvcond); if (it) { it.cond = cd.dataset.cv; it.price = null } rerender(); return }
    const cp = t.closest('[data-mvcopy]'); if (cp) { const tx = document.getElementById('mvtx' + cp.dataset.mvcopy); if (tx) { const ok = () => { cp.textContent = 'Copied!'; setTimeout(() => { cp.textContent = 'Copy listing' }, 1400) }; if (navigator.clipboard) navigator.clipboard.writeText(tx.value).then(ok, () => { tx.select(); document.execCommand('copy'); ok() }); else { tx.select(); document.execCommand('copy'); ok() } track('move_listing_copied') } return }
    const pp = t.closest('[data-mvp]'); if (pp) { const k = pp.dataset.mvp, lim = k === 'beds' ? [0, 5] : [1, 4]; M.place[k] = Math.max(lim[0], Math.min(lim[1], (+M.place[k] || 0) + +pp.dataset.d)); rerender(); return }
    if (t.closest('[data-mvbuild]')) { buildPlace(); rerender(); return }
    const ds = t.closest('[data-mvdesign]'); if (ds) { save(); designRoom(ds.dataset.mvdesign); return }
    if (t.closest('[data-mvprint]')) { printLabels(); return }
  });
  document.addEventListener('change', e => {
    if (S.step !== 5) return;
    const t = e.target;
    if (t.dataset.mvto) { const it = M.items.find(i => i.id === +t.dataset.mvto); if (it) it.to = t.value; rerender(); return }
    if (t.dataset.mvprice) { const it = M.items.find(i => i.id === +t.dataset.mvprice); if (it) { it.price = Math.max(0, Math.round(+t.value || 0)) } rerender(); return }
    if (t.id === 'mvSqft') { M.place.sqft = Math.max(250, Math.min(5000, Math.round(+t.value || 0))); save(); return }
    if (t.id === 'mvLink') { const v = t.value.trim(); M.place.link = /^https?:\/\//i.test(v) ? v : ''; save(); return }
  });
  document.addEventListener('keydown', e => {
    if (S.step !== 5 || M.tab !== 'sort' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '')) return;
    if (document.querySelector('dialog[open]')) return;
    const d = { ArrowRight: 'keep', ArrowLeft: 'sell', ArrowUp: 'donate', ArrowDown: 'trash' }[e.key];
    if (d && document.getElementById('mvCard')) { e.preventDefault(); decide(d) }
  });
  /* swipe the card */
  let drag = null;
  document.addEventListener('pointerdown', e => {
    const c = e.target.closest && e.target.closest('#mvCard'); if (!c || e.target.closest('button')) return;
    drag = { c, x: e.clientX, y: e.clientY, id: e.pointerId }; c.setPointerCapture(e.pointerId); c.style.transition = 'none';
  });
  document.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.c.style.transform = `translate(${dx}px,${dy}px) rotate(${dx / 20}deg)`;
    const d = Math.abs(dx) > Math.abs(dy) ? (dx > 60 ? 'keep' : dx < -60 ? 'sell' : '') : (dy < -60 ? 'donate' : dy > 60 ? 'trash' : '');
    drag.c.dataset.hint = d ? DEC[d] : '';
  });
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y, c = drag.c; drag = null;
    const d = Math.abs(dx) > Math.abs(dy) ? (dx > 90 ? 'keep' : dx < -90 ? 'sell' : '') : (dy < -90 ? 'donate' : dy > 90 ? 'trash' : '');
    if (d) decide(d); else { c.style.transition = 'transform .2s ease'; c.style.transform = ''; c.dataset.hint = '' }
  };
  document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);

  window.p5 = p5;
})();
