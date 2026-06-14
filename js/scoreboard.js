/* Margin IQ — scoreboard, plain-English read, per-manager view, net-profit toggle. */
(function () {
  'use strict';
  var C = window.MarginIQCore, X = window.MarginIQExport;

  var state = { dataset: null, focus: 'all', showNet: true, insights: null, flags: {} };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function el(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
  var money = C.fmtMoney, pct = C.fmtPct;
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function computeFlags(depts) {
    var flags = {};
    var withContrib = depts.filter(function (d) { return d.contribution !== null; });
    var bestContrib = withContrib.slice().sort(function (a, b) { return b.contribution - a.contribution; })[0];
    depts.forEach(function (d) {
      if (bestContrib && d === bestContrib && d.contribution > 0) flags[d.name] = { kind: 'star', label: '★ Star' };
      else if (d.contribution !== null && d.contribution < 0) flags[d.name] = { kind: 'loser', label: 'Losing money' };
      else if ((d.wagesPct !== null && d.wagesPct >= 40) || (d.salesVarPct !== null && d.salesVarPct <= -10)) flags[d.name] = { kind: 'watch', label: 'Watch' };
    });
    return flags;
  }

  function render(dataset) {
    state.dataset = dataset;
    state.focus = 'all';
    state.insights = C.generateInsights(dataset);
    state.flags = computeFlags(dataset.departments.filter(function (d) { return !d.isSubtotal && d.sales; }));
    draw();
  }

  function draw() {
    var host = document.getElementById('screen-board');
    host.innerHTML = '';
    host.classList.remove('hidden');
    var ds = state.dataset;
    var realDepts = ds.departments.filter(function (d) { return !d.isSubtotal && d.sales; });

    // Warnings
    if (ds.warnings && ds.warnings.length) {
      var wb = el('<div class="warn-box">⚠️ A few things to double-check:<ul></ul></div>');
      ds.warnings.slice(0, 5).forEach(function (w) { wb.querySelector('ul').appendChild(el('<li>' + esc(w) + '</li>')); });
      host.appendChild(wb);
    }

    host.appendChild(buildControls(realDepts));

    var single = state.focus !== 'all';
    var showBiz = !single && state.showNet;

    if (!single && (!state.showNet || single)) { /* placeholder */ }
    if (single || !state.showNet) {
      host.appendChild(el('<div class="confnote">🔒 Whole-business net profit &amp; totals are hidden — safe to show a department manager.</div>'));
    }

    if (showBiz) host.appendChild(buildKpiStrip(ds.business));

    if (single) {
      host.appendChild(buildManagerCard(realDepts.find(function (d) { return d.name === state.focus; })));
    } else {
      host.appendChild(el('<div class="section-title">Department scoreboard</div>'));
      host.appendChild(buildBoard(ds.departments));
      host.appendChild(el('<div class="section-title">The plain-English read</div>'));
      host.appendChild(buildInsights(state.insights.callouts));
    }

    window.scrollTo(0, 0);
  }

  function buildControls(realDepts) {
    var c = el('<div class="controls"></div>');
    c.appendChild(el('<span class="label">Meeting with</span>'));
    var sel = el('<select id="focusSel"></select>');
    sel.appendChild(el('<option value="all">All departments (overview)</option>'));
    realDepts.forEach(function (d) { sel.appendChild(el('<option value="' + esc(d.name) + '"' + (state.focus === d.name ? ' selected' : '') + '>' + esc(d.name) + ' manager</option>')); });
    sel.value = state.focus;
    sel.addEventListener('change', function (e) { state.focus = e.target.value; draw(); });
    c.appendChild(sel);

    // export
    var exWrap = el('<span style="display:flex;gap:8px"></span>');
    var exXlsx = el('<button class="btn small">⬇ Excel</button>');
    var exCsv = el('<button class="btn secondary small">⬇ CSV</button>');
    var opts = function () { return state.focus === 'all' ? {} : { singleDept: state.focus }; };
    exXlsx.addEventListener('click', function () { X.exportExcel(state.dataset, opts()); });
    exCsv.addEventListener('click', function () { X.exportCSV(state.dataset, opts()); });
    exWrap.appendChild(exXlsx); exWrap.appendChild(exCsv);
    c.appendChild(exWrap);

    var sw = el('<label class="switch" title="Hide whole-business net profit before a manager walks in">' +
      '<input type="checkbox"' + (state.showNet ? ' checked' : '') + '>' +
      '<span class="track"><span class="knob"></span></span>' +
      '<span class="txt">' + (state.showNet ? 'Net profit shown' : 'Net profit HIDDEN') + '</span></label>');
    sw.querySelector('input').addEventListener('change', function (e) { state.showNet = e.target.checked; draw(); });
    c.appendChild(sw);
    return c;
  }

  function buildKpiStrip(b) {
    var strip = el('<div class="kpi-strip"></div>');
    function k(label, val, sub, cls) {
      if (val === null || val === undefined) return;
      strip.appendChild(el('<div class="kpi-card"><div class="k">' + esc(label) + '</div><div class="v ' + (cls || '') + '">' + esc(val) + (sub ? ' <small>' + esc(sub) + '</small>' : '') + '</div></div>'));
    }
    k('Total sales', money(b.totalSales));
    k('Total gross profit', money(b.totalGP), b.totalGPPct != null ? pct(b.totalGPPct) : '');
    k('Sum of contributions', money(b.sumContributions));
    if (b.unallocatedOverhead != null) k('Unallocated overhead', money(b.unallocatedOverhead));
    k('Net profit', money(b.netProfit), b.netProfitPct != null ? pct(b.netProfitPct) : '', (b.netProfit >= 0 ? 'pos' : 'neg'));
    return strip;
  }

  function bar(kind, value, hot) {
    if (value == null) return '';
    var w = clamp(value, 0, 100);
    return '<div class="bar ' + kind + (hot ? ' hot' : '') + '"><span style="width:' + w + '%"></span></div>';
  }

  function buildBoard(allDepts) {
    var table = el('<table class="board"><thead><tr>' +
      '<th>Department</th><th>Sales</th><th>vs LY</th><th>GP $</th><th>GP %</th><th>Wages %</th><th>Contribution</th><th>Contrib %</th>' +
      '</tr></thead><tbody></tbody></table>');
    var tb = table.querySelector('tbody');
    allDepts.forEach(function (d) {
      var sub = d.isSubtotal;
      var flag = state.flags[d.name];
      var badge = flag ? '<span class="badge ' + flag.kind + '">' + esc(flag.label) + '</span>' : '';
      var contribCls = d.contribution == null ? 'muted' : (d.contribution >= 0 ? 'pos' : 'neg');
      var vlsCls = d.salesVarPct == null ? '' : (d.salesVarPct >= 0 ? 'pos' : 'neg');
      var vls = d.salesVarPct == null ? '—' : (d.salesVarPct >= 0 ? '+' : '') + pct(d.salesVarPct);
      var wagesHot = d.wagesPct != null && d.wagesPct >= 40;
      var tr = el('<tr class="' + (sub ? 'sub' : '') + (state.focus === d.name ? ' row-focus' : '') + '">' +
        '<td class="dept">' + esc(d.name) + (sub ? '' : badge) + '</td>' +
        '<td>' + (d.sales == null ? '—' : money(d.sales)) + '</td>' +
        '<td><span class="' + vlsCls + '">' + vls + '</span></td>' +
        '<td>' + (d.gp == null ? '—' : money(d.gp)) + '</td>' +
        '<td><div class="cell-stack">' + (d.gpPct == null ? '—' : pct(d.gpPct)) + bar('gp', d.gpPct) + '</div></td>' +
        '<td><div class="cell-stack"><span class="' + (wagesHot ? 'neg' : '') + '">' + (d.wagesPct == null ? '—' : pct(d.wagesPct)) + '</span>' + bar('wage', d.wagesPct, wagesHot) + '</div></td>' +
        '<td><span class="' + contribCls + '">' + (d.contribution == null ? 'combined' : money(d.contribution)) + '</span></td>' +
        '<td><span class="' + contribCls + '">' + (d.contribPct == null ? '—' : pct(d.contribPct)) + '</span></td>' +
        '</tr>');
      tb.appendChild(tr);
    });
    return table;
  }

  function buildInsights(callouts) {
    var wrap = el('<div class="insights"></div>');
    if (!callouts.length) { wrap.appendChild(el('<div class="insight info"><span class="ic">ℹ️</span><div>No automatic callouts — the departments look broadly balanced.</div></div>')); return wrap; }
    var icon = { good: '✅', bad: '⚠️', warn: '👀', info: 'ℹ️' };
    callouts.forEach(function (c) {
      wrap.appendChild(el('<div class="insight ' + c.severity + '"><span class="ic">' + (icon[c.severity] || 'ℹ️') + '</span><div>' + esc(c.text) + '</div></div>'));
    });
    return wrap;
  }

  function buildManagerCard(d) {
    if (!d) return el('<div class="card">Department not found.</div>');
    var card = el('<div class="card"></div>');
    var head = el('<div class="mgr-head"><h3>' + esc(d.name) + '</h3><span class="sub">manager review sheet</span></div>');
    card.appendChild(head);

    // KPIs row for this dept
    var k = el('<div class="kpi-strip"></div>');
    function kpi(label, val, sub, cls) { k.appendChild(el('<div class="kpi-card"><div class="k">' + esc(label) + '</div><div class="v ' + (cls || '') + '">' + esc(val) + (sub ? ' <small>' + esc(sub) + '</small>' : '') + '</div></div>')); }
    kpi('Sales', money(d.sales), d.salesVarPct != null ? ((d.salesVarPct >= 0 ? '+' : '') + pct(d.salesVarPct) + ' vs LY') : '');
    kpi('Gross profit', money(d.gp), d.gpPct != null ? pct(d.gpPct) : '');
    if (d.wagesPct != null) kpi('Wages', money(d.wages), pct(d.wagesPct) + ' of sales', d.wagesPct >= 40 ? 'neg' : '');
    if (d.contribution != null) kpi('Contribution', money(d.contribution), d.contribPct != null ? pct(d.contribPct) : '', d.contribution >= 0 ? 'pos' : 'neg');
    card.appendChild(k);

    // Waterfall
    var wf = el('<table class="waterfall"></table>');
    function row(label, val, cls, total) { wf.appendChild(el('<tr' + (total ? ' class="total"' : '') + '><td>' + esc(label) + '</td><td class="' + (cls || '') + '">' + (val == null ? '—' : money(val)) + '</td></tr>')); }
    row('Sales', d.sales);
    row('Less stock cost (COGS)', d.cogs == null ? null : -d.cogs);
    row('= Gross profit', d.gp, '', true);
    if (d.wages != null) row('Less wages', -d.wages);
    if (d.otherCosts != null && d.otherCosts > 0) row('Less other direct costs', -d.otherCosts);
    else if (d.wages == null && d.deptCosts != null) row('Less department costs', -d.deptCosts);
    if (d.contribution != null) row('= Department contribution', d.contribution, (d.contribution >= 0 ? 'pos' : 'neg'), true);
    card.appendChild(wf);

    // dept-specific insights
    var mine = state.insights.perDept[d.name] || [];
    if (mine.length) {
      var ins = el('<div style="margin-top:12px"></div>');
      var icon = { good: '✅', bad: '⚠️', warn: '👀', info: 'ℹ️' };
      mine.forEach(function (c) { ins.appendChild(el('<div class="insight ' + c.severity + '" style="margin-bottom:8px"><span class="ic">' + (icon[c.severity] || 'ℹ️') + '</span><div>' + esc(c.text) + '</div></div>')); });
      card.appendChild(ins);
    }

    // contribution explainer (Luke specifically values this)
    card.appendChild(el('<div class="explainer">💡 <b>What “contribution” means:</b> this is what ' + esc(d.name) +
      ' puts toward running the whole business — rent, electricity, admin and office wages all come out of this pool before any profit. ' +
      'It is <b>not</b> the department’s take-home profit, and the whole-business net profit is deliberately hidden on this view.</div>'));

    return card;
  }

  window.MarginIQBoard = { render: render };
})();
