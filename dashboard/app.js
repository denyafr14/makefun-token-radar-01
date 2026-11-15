// Token Radar dashboard: renders window.RADAR (written beside this page as data.js by
// main.ts) with no network and no framework. Three views, chosen by the location hash:
//   #/                     the ranked board, with search, category and chain filters
//   #/?cat=..&chain=..&q=..&watch=1&sort=..   the board with filters set (shareable, printable)
//   #/p/<slug>             one protocol's detail: the model's arithmetic and its farm plan
//   #/live                 the protocols whose tokens already trade, at market values
'use strict';

const R = window.RADAR;
const view = document.getElementById('view');
const bySlug = new Map(R.rows.map((r) => [r.slug, r]));
const catInfo = new Map(R.categories.map((c) => [c.category, c]));

/* ---------- small DOM and format helpers ---------- */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function money(v) {
  if (v === null || v === undefined) return '—';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + v;
}
function pct(v) {
  if (v === null || v === undefined) return 'not reported';
  return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
}
function ageLabel(days) {
  if (days === null || days === undefined) return 'unrecorded';
  if (days < 60) return days + 'd';
  if (days < 730) return Math.round(days / 30.4) + ' mo';
  return (days / 365.25).toFixed(1) + ' yrs';
}
function mult(x) { return '×' + Number(x).toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0'); }

/* ---------- masthead stats ---------- */
(function stats() {
  const box = document.getElementById('stats');
  const items = [
    [String(R.board_size), 'protocols ranked'],
    [String(R.watchlist_size), 'watchlist covered'],
    [String(R.early_size), 'found below the floor'],
    [R.as_of, 'snapshot date'],
  ];
  for (const [b, s] of items) {
    const d = el('div', 'stat');
    d.append(el('b', null, b), el('span', null, s));
    box.append(d);
  }
})();

/* ---------- routing ---------- */
function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const q = h.indexOf('?');
  const path = q >= 0 ? h.slice(0, q) : h;
  const params = new URLSearchParams(q >= 0 ? h.slice(q + 1) : '');
  return { path, params };
}
function boardHash(f) {
  const p = new URLSearchParams();
  if (f.cat) p.set('cat', f.cat);
  if (f.chain) p.set('chain', f.chain);
  if (f.q) p.set('q', f.q);
  if (f.watch) p.set('watch', '1');
  if (f.sort && f.sort !== 'implied') p.set('sort', f.sort);
  const s = p.toString();
  return '#/' + (s ? '?' + s : '');
}
function setTab(name) {
  document.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('on', a.dataset.tab === name));
}

/* ---------- the board ---------- */
const SORTS = {
  implied: (a, b) => b.implied_value_usd - a.implied_value_usd,
  tvl: (a, b) => b.tvl_usd - a.tvl_usd,
  growth: (a, b) => (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity),
  age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
  multiple: (a, b) => b.peer_multiple - a.peer_multiple,
};

function modelStrip() {
  const m = R.model;
  const box = el('div', 'model');
  box.append(el('h2', null, 'How the value is figured — model ' + R.model_version));
  const p = el('p', null,
    'Each pre-token protocol is priced from the protocols in its own category whose tokens already trade: ' +
    'their market-cap-to-TVL ratios, clipped and medianed, give a peer multiple, shrunk toward the global median ' +
    '(' + mult(R.global_multiple) + ') where a category has few peers. TVL times that multiple is then adjusted for the ' +
    'protocol\u2019s own seven-day TVL change and for how long it has run with no token. Protocols that already trade ' +
    'are never ranked — they are the evidence, and sit under Already trading.');
  const f = el('p', 'formula',
    'implied = TVL \u00d7 peer multiple \u00d7 (1 + clamp(7d change, ' + m.growth_floor_pct + '%, +' + m.growth_cap_pct + '%) \u00d7 ' +
    m.growth_weight + ') \u00d7 (' + m.tenure_floor + ' + ' + m.tenure_range + ' \u00d7 (1 \u2212 e^\u2212age/' + m.tenure_tau_days + 'd))');
  box.append(p, f);
  return box;
}

function renderBoard(params) {
  setTab('board');
  const f = {
    cat: params.get('cat') || '',
    chain: params.get('chain') || '',
    q: (params.get('q') || '').toLowerCase(),
    watch: params.get('watch') === '1',
    sort: params.get('sort') || 'implied',
  };
  view.replaceChildren(modelStrip());

  /* controls */
  const controls = el('div', 'controls');
  const searchField = el('div', 'field');
  searchField.append(el('label', null, 'Search'));
  const search = document.createElement('input');
  search.type = 'search'; search.value = params.get('q') || ''; search.placeholder = 'Protocol name or slug';
  searchField.append(search);
  const catField = el('div', 'field');
  catField.append(el('label', null, 'Category'));
  const catSel = document.createElement('select');
  catSel.append(new Option('All categories', ''));
  for (const c of [...new Set(R.rows.map((r) => r.category || 'Uncategorized'))].sort()) catSel.append(new Option(c, c));
  catSel.value = f.cat;
  catField.append(catSel);
  const chainField = el('div', 'field');
  chainField.append(el('label', null, 'Chain'));
  const chainSel = document.createElement('select');
  chainSel.append(new Option('All chains', ''));
  for (const c of [...new Set(R.rows.flatMap((r) => r.chains))].sort()) chainSel.append(new Option(c, c));
  chainSel.value = f.chain;
  chainField.append(chainSel);
  const watchField = el('div', 'field check');
  const watchBox = document.createElement('input');
  watchBox.type = 'checkbox'; watchBox.checked = f.watch;
  watchField.append(watchBox, el('label', null, 'Watchlist only ($' + (R.floor_usd / 1e6) + 'M+ TVL, no token recorded)'));
  const sortField = el('div', 'field');
  sortField.append(el('label', null, 'Sort by'));
  const sortSel = document.createElement('select');
  for (const [v, label] of [['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7d change'], ['age', 'Time tokenless'], ['multiple', 'Peer multiple']]) {
    sortSel.append(new Option(label, v));
  }
  sortSel.value = f.sort;
  sortField.append(sortSel);
  const count = el('div', 'count');
  controls.append(searchField, catField, chainField, watchField, sortField, count);
  view.append(controls);

  const apply = () => {
    const nf = { cat: catSel.value, chain: chainSel.value, q: search.value.trim(), watch: watchBox.checked, sort: sortSel.value };
    history.replaceState(null, '', boardHash(nf));
    draw(nf);
  };
  search.addEventListener('input', apply);
  catSel.addEventListener('change', apply);
  chainSel.addEventListener('change', apply);
  watchBox.addEventListener('change', apply);
  sortSel.addEventListener('change', apply);

  const tableWrap = el('div');
  view.append(tableWrap);

  function draw(state) {
    const q = state.q.toLowerCase();
    const rows = R.rows.filter((r) =>
      (!state.cat || (r.category || 'Uncategorized') === state.cat) &&
      (!state.chain || r.chains.includes(state.chain)) &&
      (!state.watch || r.watchlist) &&
      (!q || r.name.toLowerCase().includes(q) || r.slug.includes(q)));
    rows.sort(SORTS[state.sort] || SORTS.implied);
    count.textContent = rows.length + ' of ' + R.board_size + ' protocols';
    tableWrap.replaceChildren();
    if (rows.length === 0) {
      tableWrap.append(el('p', 'empty', 'No protocol matches those filters. Loosen the search or clear a filter.'));
      return;
    }
    const table = el('table');
    const thead = el('thead');
    const htr = el('tr');
    for (const [label, cls] of [['Rank', 'num'], ['Protocol', ''], ['Category', ''], ['Chains', ''], ['TVL', 'num'], ['7d', 'num'], ['Tokenless for', 'num'], ['Peer ×', 'num'], ['Implied value', 'num']]) {
      htr.append(el('th', cls, label));
    }
    thead.append(htr);
    table.append(thead);
    const tbody = el('tbody');
    for (const r of rows) {
      const tr = el('tr', 'row');
      tr.addEventListener('click', () => { location.hash = '#/p/' + r.slug; });
      const nameTd = el('td');
      const link = el('a', 'pname', r.name);
      link.href = '#/p/' + r.slug;
      nameTd.append(link);
      nameTd.append(el('span', 'badge ' + (r.watchlist ? 'watch' : 'early'), r.watchlist ? 'Watchlist' : 'Early'));
      const gTd = el('td', 'num ' + (r.change_7d === null ? 'mut' : r.change_7d >= 0 ? 'up' : 'down'), pct(r.change_7d));
      tr.append(
        el('td', 'rank num', '#' + r.rank),
        nameTd,
        el('td', 'cat', r.category || 'Uncategorized'),
        el('td', 'chains', r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '')),
        el('td', 'money num', money(r.tvl_usd)),
        gTd,
        el('td', 'num', ageLabel(r.age_days)),
        el('td', 'mult num', mult(r.peer_multiple)),
        el('td', 'money num implied', money(r.implied_value_usd)),
      );
      tbody.append(tr);
    }
    table.append(tbody);
    tableWrap.append(table);
  }
  draw(f);
}

/* ---------- one protocol ---------- */
function renderDetail(slug) {
  setTab('board');
  const r = bySlug.get(slug);
  view.replaceChildren();
  const back = el('a', 'back', '\u2190 Back to the board');
  back.href = '#/';
  view.append(back);
  if (!r) {
    view.append(el('p', 'empty', 'No protocol with that slug is on the board.'));
    return;
  }
  const head = el('div', 'detail-head');
  head.append(el('h2', null, r.name));
  head.append(el('span', 'badge ' + (r.watchlist ? 'watch' : 'early'), r.watchlist ? 'On the watchlist' : 'Early find, below the floor'));
  head.append(el('span', 'sub', 'Rank #' + r.rank + ' of ' + R.board_size + ' \u00b7 records no token in the snapshot'));
  view.append(head);

  const cards = el('div', 'cards');
  for (const [b, s] of [
    [money(r.implied_value_usd), 'Implied value'],
    [money(r.tvl_usd), 'TVL in snapshot'],
    [pct(r.change_7d), 'TVL change, 7 days'],
    [ageLabel(r.age_days), 'Running tokenless'],
    [mult(r.peer_multiple), 'Peer multiple'],
  ]) {
    const c = el('div', 'card');
    c.append(el('b', null, b), el('span', null, s));
    cards.append(c);
  }
  view.append(cards);

  /* the model's arithmetic, line by line */
  const wf = el('section', 'block');
  wf.append(el('h3', null, 'How this value is figured'));
  const table = el('table', 'waterfall');
  const tbody = el('tbody');
  const info = catInfo.get(r.category || '(uncategorized)');
  const basisText = r.peer_basis === 'category'
    ? 'median of ' + r.peer_count + ' trading peers in ' + (r.category || 'its category')
    : r.peer_basis === 'shrunk'
      ? 'category median shrunk toward the global median — only ' + r.peer_count + ' trading peers'
      : 'global median — its category has no trading peers in the snapshot';
  const lines = [
    ['TVL (snapshot)', money(r.tvl_usd)],
    ['\u00d7 peer multiple (' + basisText + ')', mult(r.peer_multiple)],
    ['\u00d7 growth factor (7d change ' + pct(r.change_7d) + ')', mult(r.growth_multiplier)],
    ['\u00d7 tenure factor (' + ageLabel(r.age_days) + ' tokenless)', mult(r.tenure_multiplier)],
  ];
  for (const [a, b] of lines) {
    const tr = el('tr');
    tr.append(el('td', null, a), el('td', 'num', b));
    tbody.append(tr);
  }
  const tot = el('tr', 'total');
  tot.append(el('td', null, 'Implied value'), el('td', 'num', money(r.implied_value_usd)));
  tbody.append(tot);
  table.append(tbody);
  wf.append(table);
  if (info && info.peers.length > 0) {
    const pp = el('p', 'peers');
    pp.append(document.createTextNode('Peers it is priced from include '));
    pp.append(el('b', null, info.peers.map((p) => p.name + ' (' + mult(p.multiple) + ')').join(', ')));
    pp.append(document.createTextNode(' — the category\u2019s trading protocols, at their own market-cap-to-TVL ratios.'));
    wf.append(pp);
  }
  view.append(wf);

  const farm = el('section', 'block');
  farm.append(el('h3', null, 'How to farm it'));
  const ol = el('ol', 'steps');
  for (const s of r.farm_steps) ol.append(el('li', null, s));
  farm.append(ol);
  view.append(farm);

  const facts = el('section', 'block');
  facts.append(el('h3', null, 'The snapshot\u2019s record'));
  const grid = el('div', 'facts');
  for (const [k, v] of [
    ['Category', r.category || 'None recorded'],
    ['Chains', r.chains.join(', ') || 'None recorded'],
    ['First tracked', r.listed_at || 'Not recorded'],
    ['Token', 'None recorded — no market cap, no CoinGecko id, no symbol'],
    ['Watchlist floor', money(R.floor_usd) + ' TVL'],
  ]) {
    const d = el('div');
    d.append(el('b', null, k + ': '), document.createTextNode(v));
    grid.append(d);
  }
  facts.append(grid);
  view.append(facts);
}

/* ---------- already trading ---------- */
function renderLive() {
  setTab('live');
  view.replaceChildren();
  const intro = el('div', 'model');
  intro.append(el('h2', null, 'Already trading — the peer evidence'));
  intro.append(el('p', null,
    'These protocols\u2019 tokens already trade, so the radar does not rank them: it shows the market\u2019s own ' +
    'values. Their market-cap-to-TVL ratios are the peer multiples the board prices pre-token protocols from.'));
  view.append(intro);
  const table = el('table');
  const thead = el('thead');
  const htr = el('tr');
  for (const [label, cls] of [['Protocol', ''], ['Category', ''], ['Chains', ''], ['TVL', 'num'], ['Market cap', 'num'], ['Mcap / TVL', 'num'], ['7d', 'num']]) {
    htr.append(el('th', cls, label));
  }
  thead.append(htr);
  table.append(thead);
  const tbody = el('tbody');
  for (const p of R.live) {
    const tr = el('tr');
    tr.append(
      el('td', 'pname', p.name),
      el('td', 'cat', p.category || 'Uncategorized'),
      el('td', 'chains', p.chains.slice(0, 3).join(', ')),
      el('td', 'money num', money(p.tvl_usd)),
      el('td', 'money num', money(p.mcap_usd)),
      el('td', 'mult num', p.multiple === null ? '—' : mult(p.multiple)),
      el('td', 'num ' + (p.change_7d === null ? 'mut' : p.change_7d >= 0 ? 'up' : 'down'), pct(p.change_7d)),
    );
    tbody.append(tr);
  }
  table.append(tbody);
  view.append(table);
}

/* ---------- go ---------- */
function route() {
  const { path, params } = parseHash();
  if (path === '/live') renderLive();
  else if (path.startsWith('/p/')) renderDetail(decodeURIComponent(path.slice(3)));
  else renderBoard(params);
  view.setAttribute('aria-busy', 'false');
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
route();
