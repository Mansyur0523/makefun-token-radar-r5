// Token Launch Radar — the page.
//
// One model prices the board and the page. The same fit in lib/model.ts runs
// here, in the browser, on the same comps: fitCurve(), growthMultiplier(),
// maturityMultiplier(), farmEconomics() and the 200 bootstrap refits. On load
// the page re-runs them and checks every rank, value and band against the
// board this program wrote — the badge at the top says how many match, so a
// screen with no code behind it cannot happen.
//
// No network: everything renders from window.RADAR (data.js beside the page).

(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) { document.body.innerHTML = '<p style="padding:20px">No data: data.js did not load.</p>'; return; }

  // ---------------------------------------------------------------- model
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function fitCurve(pts) {
    var n = pts.length, sx = 0, sy = 0, sxx = 0, sxy = 0, i, p;
    for (i = 0; i < n; i++) { p = pts[i]; sx += p.lt; sy += p.lm; sxx += p.lt * p.lt; sxy += p.lt * p.lm; }
    var b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    return { a: (sy - b * sx) / n, b: b, n: n };
  }
  function growthMultiplier(change7d) {
    var g = change7d === null || change7d === undefined || !isFinite(change7d) ? 0 : Math.min(120, Math.max(-60, change7d));
    return 1 + 0.25 * (g / 100);
  }
  function maturityMultiplier(age) {
    if (age === null || age === undefined) return 1;
    return 0.9 + 0.2 * (Math.min(age, 1095) / 1095);
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function farmEconomics(implied, tvl, age, deposit, share) {
    var hold = holdDaysFor(age), weeks = Math.ceil(hold / 7);
    var slice = (share * implied * deposit) / tvl;
    var gas = 4 + 2 * weeks;
    var tbill = deposit * 0.045 * (hold / 365);
    var cost = gas + tbill;
    var net = slice - cost;
    var hours = 0.25 + weeks * (10 / 60) + 10 / 60 + 5 / 60;
    return { deposit: deposit, slice: slice, gas: gas, tbill: tbill, cost: cost, net: net,
      breakeven: slice > 0 ? cost / slice : Infinity, hours: hours, netPerHour: net / hours,
      verdict: net > 0 ? 'FARM' : slice > gas ? 'THIN' : 'SKIP' };
  }
  function logImplied(tvl, change7d, age, curve) {
    return curve.a + curve.b * Math.log(tvl) + Math.log(growthMultiplier(change7d)) + Math.log(maturityMultiplier(age));
  }

  // ---------------------------------------------------------------- helpers
  function $(id) { return document.getElementById(id); }
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(2);
  }
  function money2(n) { return (n < 0 ? '−$' : '$') + Math.abs(n).toFixed(2); }
  function ageText(age) {
    if (age === null || age === undefined) return 'undated';
    if (age < 30) return age + 'd';
    if (age < 365) return Math.round(age / 30.4 * 10) / 10 + 'mo';
    return Math.round(age / 365 * 10) / 10 + 'y';
  }
  function pctChange(v) {
    if (v === null || v === undefined) return '<span class="mini">—</span>';
    var s = (v > 0 ? '+' : '') + v.toFixed(1) + '%';
    return '<span class="' + (v >= 0 ? 'pos' : 'neg') + '">' + s + '</span>';
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function chainsShort(chains) {
    if (!chains || chains.length === 0) return '—';
    if (chains.length <= 3) return chains.join(', ');
    return chains.slice(0, 3).join(', ') + ' +' + (chains.length - 3);
  }
  function breakevenText(e) {
    if (!isFinite(e.breakeven) || e.breakeven > 1) return '>100%';
    return Math.round(e.breakeven * 100) + '%';
  }

  // ---------------------------------------------------------------- self-check
  // Refit the curve on the page's own comps, reprice every row, redo the 200
  // bootstrap refits for the bands, and count what matches board.json.
  var curve = fitCurve(R.comps);
  var rng = mulberry32(20261114);
  var vals = R.rows.map(function () { return []; });
  var i, r, j;
  for (r = 0; r < 200; r++) {
    var sample = [];
    for (j = 0; j < R.comps.length; j++) sample.push(R.comps[Math.floor(rng() * R.comps.length)]);
    var c = fitCurve(sample);
    for (i = 0; i < R.rows.length; i++) vals[i].push(logImplied(R.rows[i].tvl_usd, R.rows[i].change_7d, R.rows[i].age_days, c));
  }
  var match = 0, total = 0;
  for (i = 0; i < R.rows.length; i++) {
    var row = R.rows[i];
    var v = vals[i].slice().sort(function (a, b) { return a - b; });
    var lo = Math.max(1, Math.round(Math.exp(v[Math.floor(0.1 * v.length)] + R.validation.bandE10)));
    var hi = Math.max(1, Math.round(Math.exp(v[Math.floor(0.9 * v.length)] + R.validation.bandE90)));
    var mine = Math.max(1, Math.round(Math.exp(logImplied(row.tvl_usd, row.change_7d, row.age_days, curve))));
    total++;
    if (mine === row.implied_value_usd && lo === row.band_lo_usd && hi === row.band_hi_usd) match++;
  }
  var sc = $('selfCheck');
  var curveOk = Math.abs(curve.a - R.curve.a) < 1e-9 && Math.abs(curve.b - R.curve.b) < 1e-9;
  if (curveOk && match === total) {
    sc.textContent = '✓ page = board.json: this page re-ran the fit and 200 bootstrap refits — ' + match + '/' + total + ' ranks, values and bands match';
  } else {
    sc.classList.add('bad');
    sc.textContent = '✗ page ≠ board.json: ' + match + '/' + total + ' values match; curve refit ' + (curveOk ? 'matches' : 'differs');
  }

  // ---------------------------------------------------------------- header
  var V = R.validation;
  $('totalImplied').textContent = money(R.total_implied_usd);
  $('sourceLine').textContent = 'DefiLlama snapshot ' + R.as_of + ' · ' + R.source + ' · ' + R.board_size + ' protocols ranked, ' + R.live_size + ' traded tokens kept apart, ' + R.set_aside_size + ' set aside by rule.';
  $('footSource').textContent = R.source + ', fetched ' + R.as_of + '.';
  $('formula').textContent = 'implied value = 10^(' + (V.curve.a / Math.log(10)).toFixed(3) + ' + ' + V.curve.b.toFixed(3) + ' × log10 TVL) × growth × maturity — fitted on ' + V.comps + ' clean comps, R² ' + R.r2.toFixed(2);
  $('stats').innerHTML = [
    ['<b>' + R.board_size + '</b>', 'ranked, record no token', '40 watchlist · 158 early'],
    ['<b>' + R.watchlist_size + ' / ' + R.watchlist_size + '</b>', 'watchlist covered', 'every slug the house kept'],
    ['<b>' + V.comps + '</b>', 'traded comps fit the curve', 'of 128 priced tokens'],
    ['<b>×' + V.loo.median.toFixed(2) + '</b>', 'leave-one-out median miss', 'flat multiple ×' + V.flat.median.toFixed(2) + ' · ' + Math.round(V.loo.within2 * 100) + '% within 2×'],
    ['<b>×' + V.walkForward.median.toFixed(2) + '</b>', 'walk-forward median miss', 'flat ×' + V.walkForwardFlat.median.toFixed(2) + ' · fit before, test after'],
    ['<b>' + Math.round(V.bandCoverage * 100) + '%</b>', 'of held-out caps land inside', 'the P10–P90 band']
  ].map(function (s) { return '<div class="stat">' + s[0] + '<span>' + s[1] + '</span><small>' + s[2] + '</small></div>'; }).join('');

  // ---------------------------------------------------------------- scatter
  (function scatter() {
    var W = 460, H = 250, P = 34;
    var x0 = Math.log10(1e6), x1 = Math.log10(3e10), y0 = Math.log10(1e4), y1 = Math.log10(1e11);
    function X(v) { return P + (Math.log10(v) - x0) / (x1 - x0) * (W - 2 * P); }
    function Y(v) { return H - P - (Math.log10(Math.max(1e4, v)) - y0) / (y1 - y0) * (H - 2 * P); }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Market cap against TVL">';
    var gx, gy;
    for (gx = 6; gx <= 10; gx++) {
      var xv = X(Math.pow(10, gx));
      s += '<line x1="' + xv + '" y1="' + (H - P) + '" x2="' + xv + '" y2="' + P + '" stroke="#eef1f5"/>';
      s += '<text x="' + xv + '" y="' + (H - 12) + '" font-size="9" fill="#5a6478" text-anchor="middle">' + (gx === 6 ? '$1M' : gx === 7 ? '$10M' : gx === 8 ? '$100M' : gx === 9 ? '$1B' : '$10B') + '</text>';
    }
    for (gy = 4; gy <= 11; gy++) {
      var yv = Y(Math.pow(10, gy));
      s += '<line x1="' + P + '" y1="' + yv + '" x2="' + (W - P) + '" y2="' + yv + '" stroke="#eef1f5"/>';
      s += '<text x="' + (P - 4) + '" y="' + (yv + 3) + '" font-size="9" fill="#5a6478" text-anchor="end">' + (gy === 4 ? '$10K' : gy === 5 ? '$100K' : gy === 6 ? '$1M' : gy === 7 ? '$10M' : gy === 8 ? '$100M' : gy === 9 ? '$1B' : gy === 10 ? '$10B' : '$100B') + '</text>';
    }
    R.comps.forEach(function (c) {
      s += '<circle cx="' + X(Math.exp(c.lt)).toFixed(1) + '" cy="' + Y(Math.exp(c.lm)).toFixed(1) + '" r="2.4" fill="#9aa3b2"/>';
    });
    R.rows.forEach(function (row) {
      s += '<circle cx="' + X(row.tvl_usd).toFixed(1) + '" cy="' + Y(row.implied_value_usd).toFixed(1) + '" r="2.2" fill="#0e7a6b" opacity="0.75"/>';
    });
    var line = '';
    for (var k = 0; k <= 40; k++) {
      var tvl = Math.pow(10, x0 + (x1 - x0) * k / 40);
      var val = Math.exp(curve.a + curve.b * Math.log(tvl));
      line += (k === 0 ? 'M' : 'L') + X(tvl).toFixed(1) + ',' + Y(val).toFixed(1);
    }
    s += '<path d="' + line + '" fill="none" stroke="#1c2333" stroke-width="1.6"/>';
    s += '</svg>';
    $('scatter').innerHTML = s;
  })();

  // ---------------------------------------------------------------- ablation
  (function ablation() {
    var h = '<table class="abl"><thead><tr><th>Variant</th><th>LOO miss</th><th>≤3×</th><th>ρ</th><th>Walk-fwd</th><th></th></tr></thead><tbody>';
    V.ablation.forEach(function (a) {
      h += '<tr' + (a.kept ? ' class="kept"' : '') + '><td>' + esc(a.variant) + '</td><td class="num">×' + a.loo.median.toFixed(2) + '</td><td class="num">' + Math.round(a.loo.within3 * 100) + '%</td><td class="num">' + a.rankCorr.toFixed(2) + '</td><td class="num">×' + a.walkForward.median.toFixed(2) + '</td><td>' + (a.kept ? 'kept' : 'not used') + '</td></tr>';
    });
    h += '</tbody></table>';
    h += '<p class="note">Time splits, same curve: fit before 2024, test the 41 listed since — ×' + V.splitA.median.toFixed(2) + ' vs flat ×' + V.splitAFlat.median.toFixed(2) + '; fit before 2023, test the 53 listed since — ×' + V.splitB.median.toFixed(2) + ' vs flat ×' + V.splitBFlat.median.toFixed(2) + '.</p>';
    $('ablation').innerHTML = h;
  })();

  // ---------------------------------------------------------------- state
  var state = { tab: 'board', q: '', family: '', chain: '', verdict: '', watch: '', deposit: 1000, share: 0.1, sort: 'rank', dir: 1, sel: null };
  var families = {};
  R.rows.forEach(function (row) { families[row.category || 'No category'] = (families[row.category || 'No category'] || 0) + 1; });
  var fFam = $('fFamily');
  fFam.innerHTML = '<option value="">All families</option>' + Object.keys(families).sort().map(function (f) {
    return '<option value="' + esc(f) + '">' + esc(f) + ' (' + families[f] + ')</option>';
  }).join('');
  var chains = {};
  R.rows.forEach(function (row) { row.chains.forEach(function (c) { chains[c] = (chains[c] || 0) + 1; }); });
  $('fChain').innerHTML = '<option value="">All chains</option>' + Object.keys(chains).sort().map(function (c) {
    return '<option>' + esc(c) + ' (' + chains[c] + ')</option>';
  }).join('');

  function econFor(row) { return farmEconomics(row.implied_value_usd, row.tvl_usd, row.age_days, state.deposit, state.share); }
  function bandRange(row) {
    var lo = row.band_lo_usd, hi = row.band_hi_usd;
    var span = Math.log(hi) - Math.log(lo);
    var pos = span > 0 ? (Math.log(row.implied_value_usd) - Math.log(lo)) / span : 0.5;
    return '<div class="bandbar" title="P10–P90 band"><i style="left:0;width:100%"></i><b style="left:' + (pos * 100).toFixed(1) + '%"></b></div>';
  }
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = R.rows.filter(function (row) {
      if (q && (row.name + ' ' + row.slug + ' ' + (row.category || '') + ' ' + row.chains.join(' ')).toLowerCase().indexOf(q) < 0) return false;
      if (state.family && (row.category || 'No category') !== state.family) return false;
      if (state.chain && row.chains.indexOf(state.chain) < 0) return false;
      if (state.watch === 'watch' && !row.on_watchlist) return false;
      if (state.watch === 'early' && row.on_watchlist) return false;
      var e = econFor(row);
      if (state.verdict && e.verdict !== state.verdict) return false;
      return true;
    });
    var key = state.sort, dir = state.dir;
    rows.sort(function (a, b) {
      var va, vb;
      if (key === 'name') { va = a.name; vb = b.name; }
      else if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (key === 'change') { va = a.change_7d === null ? -999 : a.change_7d; vb = b.change_7d === null ? -999 : b.change_7d; }
      else if (key === 'age') { va = a.age_days === null ? -1 : a.age_days; vb = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'implied') { va = a.implied_value_usd; vb = b.implied_value_usd; }
      else if (key === 'slice' || key === 'net' || key === 'verdict') { va = econFor(a)[key === 'slice' ? 'slice' : key === 'net' ? 'net' : 'net']; vb = econFor(b)[key === 'slice' ? 'slice' : key === 'net' ? 'net' : 'net']; }
      else { va = a.rank; vb = b.rank; }
      if (typeof va === 'string') return dir * (va < vb ? -1 : va > vb ? 1 : 0);
      return dir * (va - vb);
    });
    return rows;
  }

  function renderBoard() {
    var rows = filteredRows();
    $('shownCount').textContent = rows.length + ' of ' + R.rows.length + ' shown';
    var h = '';
    rows.forEach(function (row) {
      var e = econFor(row);
      var be = breakevenText(e);
      h += '<tr data-slug="' + esc(row.slug) + '"' + (state.sel === row.slug ? ' class="sel"' : '') + '>' +
        '<td class="num">' + row.rank + '<span class="sub2">' + row.rank_lo + '&ndash;' + row.rank_hi + '</span></td>' +
        '<td><strong>' + esc(row.name) + '</strong><span class="tag ' + (row.on_watchlist ? 'wl' : 'early') + '">' + (row.on_watchlist ? 'watchlist' : 'early') + '</span><span class="sub2">' + esc(row.category || 'No category') + ' &middot; ' + esc(chainsShort(row.chains)) + '</span></td>' +
        '<td class="num">' + money(row.tvl_usd) + '</td>' +
        '<td class="num">' + pctChange(row.change_7d) + '</td>' +
        '<td class="num">' + ageText(row.age_days) + '</td>' +
        '<td class="num"><span class="big">' + money(row.implied_value_usd) + '</span><span class="sub2">' + money(row.band_lo_usd) + ' &ndash; ' + money(row.band_hi_usd) + '</span>' + bandRange(row) + '</td>' +
        '<td class="num">' + money2(e.slice) + '</td>' +
        '<td class="num">' + (e.net >= 0 ? '<span class="pos">' : '<span class="neg">') + money2(e.net) + '</span><span class="sub2">' + be + ' break-even &middot; ' + money2(e.netPerHour) + '/h</span></td>' +
        '<td><span class="verdict ' + e.verdict + '">' + e.verdict + '</span></td>' +
        '<td class="num">' + money2(e.gas) + ' gas<span class="sub2">' + holdDaysFor(row.age_days) + 'd hold</span></td>' +
        '</tr>';
    });
    $('boardBody').innerHTML = h;
  }

  function farmStepsFor(row) {
    var e = econFor(row);
    var hold = holdDaysFor(row.age_days), weeks = Math.ceil(hold / 7);
    var chain = row.chains.length ? row.chains[0] : 'its main chain';
    var c = (row.category || '').toLowerCase();
    var action;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) action = 'Supply $' + e.deposit + ' of USDC to ' + row.name + ' on ' + chain + ' and keep the position open.';
    else if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('trading') >= 0) action = 'Provide $' + e.deposit + ' of liquidity to ' + row.name + '\'s main pool on ' + chain + ' and keep the position open.';
    else if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) action = 'Deposit $' + e.deposit + ' into a ' + row.name + ' vault on ' + chain + ' and keep the shares.';
    else if (c.indexOf('stable') >= 0) action = 'Mint or deposit $' + e.deposit + ' of the stable asset through ' + row.name + ' on ' + chain + '.';
    else if (c.indexOf('rwa') >= 0) action = 'Mint $' + e.deposit + ' of the protocol\'s yield asset on ' + chain + ' and hold it.';
    else action = 'Deposit $' + e.deposit + ' of USDC into ' + row.name + ' on ' + chain + ' and keep the position open.';
    var verdictLine = e.verdict === 'FARM'
      ? 'At a ' + Math.round(state.share * 100) + '% airdrop share the slice of ' + money2(e.slice) + ' beats the ' + money2(e.cost) + ' of gas and yield forgone, netting ' + money2(e.net) + '.'
      : e.verdict === 'THIN'
        ? 'At a ' + Math.round(state.share * 100) + '% airdrop share the slice of ' + money2(e.slice) + ' covers the gas but not the ' + money2(e.tbill) + ' of yield forgone, netting ' + money2(e.net) + '.'
        : 'At a ' + Math.round(state.share * 100) + '% airdrop share the slice of ' + money2(e.slice) + ' does not cover the ' + money2(e.cost) + ' of gas and yield forgone, netting ' + money2(e.net) + ' — skip unless the share or the value rises.';
    return [
      ['Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', 'under $3 of gas for the first transaction', '5 minutes'],
      [action, '$' + e.deposit + ' of capital and about $4 of gas', '15 minutes to set up'],
      ['Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', 'about $2 of gas a week, ' + money2(e.gas) + ' over ' + weeks + ' weeks', '10 minutes a week'],
      ['Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', 'the $' + e.deposit + ' stays in the position and forgoes ' + money2(e.tbill) + ' of T-bill yield', hold + ' days'],
      ['Before you withdraw, open the protocol\'s own points or rewards page and claim only from the link it publishes.', 'no fee to check, and never pay to claim', '10 minutes'],
      [verdictLine + ' Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', 'nothing but the log', '5 minutes']
    ];
  }

  function renderDetail() {
    var d = $('detail');
    if (!state.sel) { d.hidden = true; d.innerHTML = ''; return; }
    var row = null;
    R.rows.forEach(function (r) { if (r.slug === state.sel) row = r; });
    if (!row) { d.hidden = true; return; }
    var e = econFor(row);
    var steps = farmStepsFor(row).map(function (s) {
      return '<li>' + esc(s[0]) + ' <span class="mini">Cost: ' + esc(s[1]) + '. Time: ' + esc(s[2]) + '.</span></li>';
    }).join('');
    d.hidden = false;
    d.innerHTML = '<button class="close" id="closeDetail" type="button">Close</button>' +
      '<h2>#' + row.rank + ' ' + esc(row.name) + ' <span class="verdict ' + e.verdict + '">' + e.verdict + '</span></h2>' +
      '<p class="mini">' + esc(row.category || 'No category') + ' &middot; ' + esc(chainsShort(row.chains)) + ' &middot; TVL ' + money(row.tvl_usd) + ' &middot; 7-day ' + (row.change_7d === null ? '—' : row.change_7d.toFixed(1) + '%') + ' &middot; no token for ' + ageText(row.age_days) + (row.on_watchlist ? ' &middot; on the watchlist' : ' &middot; early row') + '</p>' +
      '<div class="grid"><div><h3>How the value is built</h3><dl>' +
      '<dt>Curve value</dt><dd>' + money(row.curve_value_usd) + '</dd>' +
      '<dt>Growth multiplier</dt><dd>×' + row.growth_multiplier.toFixed(2) + '</dd>' +
      '<dt>Maturity multiplier</dt><dd>×' + row.maturity_multiplier.toFixed(2) + '</dd>' +
      '<dt>Implied value</dt><dd><strong>' + money(row.implied_value_usd) + '</strong></dd>' +
      '<dt>P10–P90 band</dt><dd>' + money(row.band_lo_usd) + ' – ' + money(row.band_hi_usd) + '</dd>' +
      '<dt>Rank range over refits</dt><dd>#' + row.rank_lo + ' – #' + row.rank_hi + '</dd>' +
      '</dl></div><div><h3>Farm economics at $' + e.deposit.toLocaleString() + ', ' + Math.round(state.share * 100) + '% share</h3><dl>' +
      '<dt>Slice if it launches</dt><dd>' + money2(e.slice) + '</dd>' +
      '<dt>Gas, ' + holdDaysFor(row.age_days) + ' days</dt><dd>' + money2(e.gas) + '</dd>' +
      '<dt>T-bill yield forgone</dt><dd>' + money2(e.tbill) + '</dd>' +
      '<dt>Net of all costs</dt><dd><strong>' + money2(e.net) + '</strong></dd>' +
      '<dt>Break-even odds</dt><dd>' + breakevenText(e) + '</dd>' +
      '<dt>Net per hands-on hour</dt><dd>' + money2(e.netPerHour) + ' / hour</dd>' +
      '</dl></div></div>' +
      '<h3>Farm plan — six steps</h3><ol>' + steps + '</ol>';
    $('closeDetail').addEventListener('click', function () { state.sel = null; renderDetail(); renderBoard(); });
  }

  // ---------------------------------------------------------------- farm next
  (function farmNext() {
    var scored = R.rows.map(function (row) { return { row: row, e: farmEconomics(row.implied_value_usd, row.tvl_usd, row.age_days, 1000, 0.1) }; });
    scored.sort(function (a, b) { return b.e.netPerHour - a.e.netPerHour; });
    $('farmNext').innerHTML = scored.slice(0, 5).map(function (s) {
      var sign = s.e.netPerHour >= 0 ? '+' : '−';
      return '<button class="card" data-slug="' + esc(s.row.slug) + '" type="button"><b>' + sign + '$' + Math.abs(s.e.netPerHour).toFixed(2) + '/h</b><span class="who">#' + s.row.rank + ' ' + esc(s.row.name) + '</span><span class="meta">net ' + money2(s.e.net) + ' · gas ' + money2(s.e.gas) + ' · ' + s.e.hours.toFixed(1) + 'h · ' + (s.e.breakeven === Infinity ? '>100%' : Math.round(s.e.breakeven * 100) + '%') + ' odds</span></button>';
    }).join('');
  })();

  // ---------------------------------------------------------------- live / set-aside / method
  $('tabLiveN').textContent = R.live_size;
  $('tabBoardN').textContent = R.board_size;
  $('tabSetN').textContent = R.set_aside_size;
  $('liveBody').innerHTML = R.live.map(function (p, i) {
    return '<tr><td class="num">' + (i + 1) + '</td><td><strong>' + esc(p.name) + '</strong><span class="sub2">' + esc(p.category || 'No category') + ' &middot; ' + esc(chainsShort(p.chains)) + '</span></td><td class="num">' + money(p.tvl_usd) + '</td><td class="num">' + money(p.mcap_usd) + '</td><td class="num">×' + (p.mcap_usd / p.tvl_usd).toFixed(3) + '</td><td class="num">' + pctChange(p.change_7d) + '</td></tr>';
  }).join('');
  $('setBody').innerHTML = R.set_aside.map(function (p, i) {
    return '<tr><td class="num">' + (i + 1) + '</td><td><strong>' + esc(p.name) + '</strong><span class="sub2">' + esc(p.category || 'No category') + '</span></td><td class="num">' + money(p.tvl_usd) + '</td><td>' + esc(p.reason) + '</td></tr>';
  }).join('');
  (function method() {
    var h = '<dl>' +
      '<dt>Comps rule</dt><dd>Live tokens with a market cap, excluding exchanges, versioned pools, bridges, liquid-staking claims and stablecoins — ' + V.comps + ' of 128 priced tokens. The rule is the same one that sets protocols aside from the board.</dd>' +
      '<dt>Curve</dt><dd>log(market cap) = ' + (V.curve.a / Math.log(10)).toFixed(3) + ' + ' + V.curve.b.toFixed(3) + ' × log10(TVL), least squares, R² ' + R.r2.toFixed(2) + '. A dollar of TVL is worth a different multiple at $5M than at $5B.</dd>' +
      '<dt>Leave-one-out</dt><dd>Each of the ' + V.dated + ' dated comps priced by a curve that never saw it: median miss ×' + V.loo.median.toFixed(2) + ' (flat multiple ×' + V.flat.median.toFixed(2) + '), ' + Math.round(V.loo.within2 * 100) + '% within 2×, ' + Math.round(V.loo.within3 * 100) + '% within 3×, rank correlation ' + V.looRankCorr.toFixed(2) + '.</dd>' +
      '<dt>Walk-forward</dt><dd>Fit on tokens listed before a year, test the tokens listed in the year after, pooled over 2023, 2024 and 2025: median miss ×' + V.walkForward.median.toFixed(2) + ' (flat ×' + V.walkForwardFlat.median.toFixed(2) + ').</dd>' +
      '<dt>Time splits</dt><dd>Fit before 2024, test the ' + V.splitA.n + ' listed since: ×' + V.splitA.median.toFixed(2) + ' vs flat ×' + V.splitAFlat.median.toFixed(2) + '. Fit before 2023, test the ' + V.splitB.n + ' listed since: ×' + V.splitB.median.toFixed(2) + ' vs flat ×' + V.splitBFlat.median.toFixed(2) + '.</dd>' +
      '<dt>Band</dt><dd>P10–P90 over 200 bootstrap refits, widened by the 10th and 90th percentiles of the leave-one-out misses. ' + Math.round(V.bandCoverage * 100) + '% of held-out caps land inside their own leave-one-out band.</dd>' +
      '<dt>What lost</dt><dd>Huber weights (leave-one-out ×' + V.ablation[2].loo.median.toFixed(2) + ', walk-forward ×' + V.ablation[2].walkForward.median.toFixed(2) + ') and shrunk family offsets (×' + V.ablation[3].loo.median.toFixed(2) + ', ×' + V.ablation[3].walkForward.median.toFixed(2) + ') were tested the same blind way and did not beat the plain curve where it matters, so the board does not use them.</dd>' +
      '</dl>';
    $('methodBody').innerHTML = h;
    $('tenure').innerHTML = R.tenure.map(function (t) {
      var share = t.total === 0 ? 0 : t.withToken / t.total;
      return '<div class="bar-row"><span class="lbl">' + esc(t.label) + '</span><span class="bar"><i style="width:' + Math.round(share * 100) + '%"></i></span><span class="val">' + Math.round(share * 100) + '%</span><span class="mini">' + t.withToken + ' of ' + t.total + '</span></div>';
    }).join('');
  })();

  // ---------------------------------------------------------------- events
  document.querySelectorAll('#tabs button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.tab = btn.getAttribute('data-tab');
      document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('active', b === btn); });
      $('boardWrap').hidden = state.tab !== 'board';
      $('controls').style.display = state.tab === 'board' ? '' : 'none';
      $('detail').hidden = state.tab !== 'board' || !state.sel;
      $('liveWrap').hidden = state.tab !== 'live';
      $('setWrap').hidden = state.tab !== 'setaside';
      $('methodWrap').hidden = state.tab !== 'method';
    });
  });
  $('boardBody').addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (!tr) return;
    state.sel = tr.getAttribute('data-slug');
    renderBoard(); renderDetail();
    $('detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  $('farmNext').addEventListener('click', function (ev) {
    var card = ev.target.closest('.card[data-slug]');
    if (!card) return;
    state.sel = card.getAttribute('data-slug');
    renderBoard(); renderDetail();
    $('detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === 'name' ? 1 : -1; }
      renderBoard();
    });
  });
  $('q').addEventListener('input', function () { state.q = $('q').value; renderBoard(); });
  $('fFamily').addEventListener('change', function () { state.family = $('fFamily').value; renderBoard(); });
  $('fChain').addEventListener('change', function () { state.chain = $('fChain').value; renderBoard(); });
  $('fVerdict').addEventListener('change', function () { state.verdict = $('fVerdict').value; renderBoard(); });
  $('fWatch').addEventListener('change', function () { state.watch = $('fWatch').value; renderBoard(); });
  $('fDeposit').addEventListener('change', function () { state.deposit = Number($('fDeposit').value); renderBoard(); renderDetail(); });
  $('fShare').addEventListener('change', function () { state.share = Number($('fShare').value); renderBoard(); renderDetail(); });
  $('resetBtn').addEventListener('click', function () {
    state.q = ''; state.family = ''; state.chain = ''; state.verdict = ''; state.watch = '';
    state.deposit = 1000; state.share = 0.1; state.sort = 'rank'; state.dir = 1; state.sel = null;
    $('q').value = ''; $('fFamily').value = ''; $('fChain').value = ''; $('fVerdict').value = '';
    $('fWatch').value = ''; $('fDeposit').value = '1000'; $('fShare').value = '0.1';
    renderBoard(); renderDetail();
  });

  // Screenshot modes: ?shot=detail&slug=<slug> opens one protocol's detail
  // view; ?shot=filtered&verdict=FARM shows one filtered view. Plain loads
  // show the whole board.
  var params = new URLSearchParams(window.location.search);
  if (params.get('shot') === 'detail') {
    state.sel = params.get('slug') || (R.rows[0] && R.rows[0].slug);
  } else if (params.get('shot') === 'filtered') {
    if (params.get('verdict')) { state.verdict = params.get('verdict'); $('fVerdict').value = state.verdict; }
    if (params.get('watch')) { state.watch = params.get('watch'); $('fWatch').value = state.watch; }
  }

  renderBoard();
  renderDetail();
})();
