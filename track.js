/* Fitroom usage tracking: anonymous events for the Launchpad numbers.
   When you change this file, also bump ?v= on its script tag in index.html so browsers load the new copy right away.
   Records actions only: never names, emails, contact details or room photos.

   SETUP: paste your PostHog "Project API key" (starts with phc_) below, then push.
   Until a key is set, events are only kept in this browser (open the site with ?debug=track to see them).
   Your own testing: open the site once with ?notrack=1 and this browser stops sending events (?notrack=0 turns it back on). */
const TRACK_KEY = 'phc_wNcN2zwQapSuw6bVQLuSECynnwWxXS225tGxYtC7juah';   // PostHog project token (US), public by design
const TRACK_HOST = 'https://us.i.posthog.com';     // use 'https://eu.i.posthog.com' if your PostHog project is in the EU

/* The one paid offer (in the fit report). Prices and wording live here so they are easy to change week to week. */
const PAID = { name: 'Double-check my fit', price: 7, promise: 'PDF in 24 hours' };
/* Optional: a sign-up link (for example a Google Form) for people who click the paid button.
   Leave empty and the button just explains it isn't available yet. Nobody is ever charged by this button. */
const PAID_SIGNUP_URL = '';

(function () {
  const Q = new URLSearchParams(location.search);
  const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch (e) { return null } };
  const ss = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v) } catch (e) { return null } };
  const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  if (Q.has('notrack')) ls('fr_notrack', Q.get('notrack') === '0' ? null : '1');
  const OFF = ls('fr_notrack') === '1';
  const DEBUG = Q.get('debug') === 'track';

  /* Anonymous ids: one per browser (to see who comes back) and one per visit. */
  let uid = ls('fr_uid'); if (!uid) { uid = rid(); ls('fr_uid', uid) }
  let sid = ss('fr_sid'); if (!sid) { sid = rid(); ss('fr_sid', sid) }
  const now = Date.now(), first = +ls('fr_first') || now; if (!ls('fr_first')) ls('fr_first', String(now));
  const lastVisit = +ls('fr_last') || 0;

  const ua = navigator.userAgent;
  const device = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'ipad'
    : /iPhone|iPod/.test(ua) ? 'iphone' : /Android/.test(ua) ? 'android' : 'computer';
  const inApp = (typeof IN_APP !== 'undefined' && IN_APP) || Q.get('app') === '1';
  const src = (Q.get('src') || ss('fr_src') || '').slice(0, 40).toLowerCase() || 'direct';
  ss('fr_src', src);
  const BASE = { src, device, platform: inApp ? 'app' : 'website', session: sid };

  const log = []; window.FR_TRACK_LOG = log;
  function track(event, props) {
    const properties = Object.assign({}, BASE, { step: (typeof S !== 'undefined' && S.step) || null }, props || {});
    const e = { event, properties, timestamp: new Date().toISOString() };
    log.push(e); if (DEBUG) console.log('[track]', event, properties);
    try { const keep = JSON.parse(ls('fr_log') || '[]'); keep.push(e); ls('fr_log', JSON.stringify(keep.slice(-200))) } catch (x) { }
    if (OFF || !TRACK_KEY) return;
    properties.$process_person_profile = false;   // anonymous events only
    try {
      fetch(TRACK_HOST + '/i/v0/e/', {
        method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: TRACK_KEY, event, distinct_id: uid, properties, timestamp: e.timestamp })
      }).catch(() => { })
    } catch (x) { }
  }
  window.frTrack = track;

  /* ---------- 1. visit ---------- */
  track('visit', {
    returning: !!lastVisit, days_since_first: Math.floor((now - first) / 864e5),
    came_back_within_7_days: !!lastVisit && now - lastVisit > 30 * 60e3 && now - lastVisit < 7 * 864e5,
    referrer: (() => { try { return document.referrer ? new URL(document.referrer).hostname : '' } catch (e) { return '' } })()
  });
  ls('fr_last', String(now));

  /* Helpers that read the app's own state. */
  const roomIn = () => { try { return { width_in: roomW(), depth_in: roomL(), sq_ft: Math.round(floorArea() / 144) } } catch (e) { return {} } };
  let via = 'typed', photoAdded = false, stepStart = now;
  const secs = () => Math.round((Date.now() - stepStart) / 1000);

  /* ---------- 2. room_started: first thing they touch in step 1 ---------- */
  let started = false;
  function startRoom(how) { if (started || S.step !== 1) return; started = true; track('room_started', { first_action: how }) }
  document.addEventListener('input', e => { if (e.target.closest && e.target.closest('#panel')) startRoom('typed ' + (e.target.id || 'field')) }, true);
  document.addEventListener('change', e => {
    if (e.target.id === 'roomPhoto' && e.target.files && e.target.files[0]) { photoAdded = true; via = via === 'typed' ? 'photo' : via; startRoom('room photo') }
    else if (e.target.closest && e.target.closest('#panel')) startRoom('changed ' + (e.target.id || 'field'))
  }, true);
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('#panel [data-type],#panel [data-shape],#panel #addCut,#panel #addObs,#panel [data-nscan],#panel [data-qr],#panel .scanrow button,#panel .altways summary');
    if (b) startRoom(b.dataset.type ? 'room type' : b.dataset.shape ? 'room shape' : b.dataset.nscan || b.closest('.scanrow') ? 'scan' : b.id || 'other');
  }, true);

  /* Remember how the room was measured. */
  const origApply = window.fitroomApplyScan;
  if (origApply) window.fitroomApplyScan = function (d) {
    via = d && d.method === 'lidar' ? 'lidar' : d && d.method === 'arTap' ? 'app camera' : 'app typed'; startRoom('scan');
    return origApply.apply(this, arguments)
  };
  if (typeof scanUse === 'function') { const o = scanUse; scanUse = function () { via = 'web scan'; startRoom('scan'); return o.apply(this, arguments) } }

  /* ---------- Steps: room_done, style_done, layout_made ---------- */
  const origGo = go;
  go = function (n) {
    const from = S.step, r = origGo.apply(this, arguments), to = S.step;
    try {
      if (from === 1 && (to === 2 || to === 3)) {
        startRoom('next');
        track('room_done', Object.assign({
          method: via, photo_added: photoAdded, room_type: S.room.type, shape: shapeKind() || 'rectangle',
          built_ins: (S.room.obs || []).length, seconds: secs()
        }, roomIn()))
      }
      if (from === 2 && to === 3) {
        const st = S.layout && S.layout.style;
        track('style_done', {
          style: st ? (STYLES[st] && STYLES[st].name) || st : null, picked_by: S.styleManual ? 'tapped a style' : S.aiWhy ? 'Ask Claude' : 'auto from words/photos',
          words: (S.vibeText || '').trim().slice(0, 200), word_count: (S.vibeText || '').trim().split(/\s+/).filter(Boolean).length,
          inspo_photos: (S.photos || []).length, budget: S.tier, seconds: secs()
        })
      }
      if (to === 3 && from !== 3) layoutMade();
      if (from !== to) stepStart = Date.now();
    } catch (x) { }
    return r
  };
  let layoutN = 0;
  function layoutMade() {
    if (!S.layout) return; layoutN++;
    let pieces = 0, total = 0, stores = new Set();
    try { for (const x of groups()) { pieces += x.n; if (!S.skip.has(x.g)) total += x.price; stores.add(x.p.retailer) } } catch (e) { }
    track('layout_made', { pieces, total_price: Math.round(total), stores: stores.size, style: S.layout.style, layout_number: layoutN });
    watch();
  }

  /* ---------- fit_report_viewed and paid_seen: counted when they actually scroll into view ---------- */
  const seen = new Set();
  const warnings = () => { try { return fitReport().filter(l => l.k === 'tight' || l.k === 'no').map(l => l.t + ' (' + (l.k === 'no' ? 'problem' : 'tight') + ')') } catch (e) { return [] } };
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => {
    for (const en of es) {
      const el = en.target; if (!en.isIntersecting || (en.intersectionRatio < 0.5 && en.intersectionRect.height < 120)) continue;
      if (el.id === 'fitRep') { const k = 'fit' + layoutN; if (!seen.has(k)) { seen.add(k); const w = warnings(); track('fit_report_viewed', { has_warning: w.length > 0, warnings: w }) } }
      if (el.id === 'paidBtn') { const hl = el.classList.contains('hl'), k = 'paid' + layoutN + hl; if (!seen.has(k)) { seen.add(k); track('paid_seen', { highlighted: hl, price: PAID.price, offer: PAID.name }) } }
    }
  }, { threshold: [0, 0.25, 0.5, 1] }) : null;
  function watch() { if (!io) return; io.disconnect(); for (const id of ['fitRep', 'paidBtn']) { const el = document.getElementById(id); if (el) io.observe(el) } }
  /* The panel is re-drawn often (dragging, swapping), so re-attach after each draw. */
  if (typeof render === 'function') { const o = render; render = function () { const r = o.apply(this, arguments); if (S.step === 3) watch(); return r } }
  if (typeof renderBar === 'function') { const o = renderBar; renderBar = function () { const r = o.apply(this, arguments); if (S.step === 3) watch(); return r } }

  /* ---------- paid_clicked ---------- */
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('#paidBtn'); if (!b) return;
    const hl = b.classList.contains('hl');
    track('paid_clicked', { price: PAID.price, offer: PAID.name, highlighted: hl, warnings: warnings() });
    openDlg(`<h3>${PAID.name}</h3>
<p>For $${PAID.price}, a person checks every piece in this room by hand against the store's own listing: the exact size, the size of the shipping box (will it get through your door?), and the path from the door to where it goes. You get a PDF within 24 hours.</p>
<p><b>This isn't available yet, and you haven't been charged.</b> Fitroom is testing which features people want, and your click helps decide what gets built next.</p>
${PAID_SIGNUP_URL ? `<p><a class="btn primary" id="paidSignup" href="${PAID_SIGNUP_URL}" target="_blank" rel="noopener">Join the list: your first check is free</a></p>` : ''}
<p><button type="button" class="btn" onclick="this.closest('dialog').close()">Back to my room</button></p>`);
  });

  /* ---------- store_click: any link to a product page or store ---------- */
  const BYURL = {}; try { for (const p of PRODUCTS) BYURL[p.url] = p } catch (e) { }
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
    if (a.id === 'paidSignup') { track('paid_signup_clicked', { price: PAID.price }); return }
    let host = ''; try { host = new URL(a.href).hostname } catch (x) { return }
    if (host === location.hostname || /github|testflight|apple\.com/.test(host)) return;
    const p = BYURL[a.href], where = a.closest('#dlg') ? (a.closest('.buildtab') ? 'final build' : 'dialog') : a.closest('.row') ? 'piece list' : 'other';
    track('store_click', p ? { store: p.retailer, product: p.name.slice(0, 80), product_id: p.id, category: p.cat, price: p.price, where }
      : { store: host.replace(/^www\./, ''), product: null, where });
  }, true);

  /* ---------- final_build, pdf_saved ---------- */
  if (typeof finalBuild === 'function') { const o = finalBuild; finalBuild = function () { const r = o.apply(this, arguments); try { const { n, total } = picked(); track('final_build', { pieces_selected: n, total_price: Math.round(total) }) } catch (x) { } return r } }
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#printBuild')) track('pdf_saved', {}) }, true);

  /* ---------- app only: the phone's camera tools ---------- */
  if (typeof appSend === 'function') { const o = appSend; appSend = function (m) { try { if (m && (m.type === 'scan' || m.type === 'measure')) track('app_camera_opened', { tool: m.type === 'scan' ? 'scan room' : 'measure a piece' }) } catch (x) { } return o.apply(this, arguments) } }
  if (window.fitroomApplyMeasure) { const o = window.fitroomApplyMeasure; window.fitroomApplyMeasure = function (m) { try { track('piece_measured', { width_in: m && m.w, depth_in: m && m.d, height_in: m && m.h }) } catch (x) { } return o.apply(this, arguments) } }
  /* room_done already records LiDAR / camera scans; this records that a scan came back, even if they never finish step 1 */
  if (window.fitroomApplyScan) { const o = window.fitroomApplyScan; window.fitroomApplyScan = function (d) { try { track('app_scan_done', { method: d && d.method, furniture_found: d && d.plan && d.plan.objects ? d.plan.objects.length : 0 }) } catch (x) { } return o.apply(this, arguments) } }

  /* If the page opened straight onto the design step, still count it. */
  if (S.step === 3) layoutMade();

  if (DEBUG) console.log('[track] ready. key set:', !!TRACK_KEY, 'tracking off in this browser:', OFF);
})();
