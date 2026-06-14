/* Margin IQ — "here's what we detected" correction screen.
   Lets the user fix column/row roles, toggle departments, and flip layout
   before analysis. Mutates the mapping object in place. */
(function () {
  'use strict';

  var COL_ROLES = [
    ['ignore', 'Ignore'],
    ['dept', 'Department name'],
    ['sales', 'Sales / revenue'],
    ['cogs', 'Stock cost (COGS)'],
    ['gp', 'Gross profit'],
    ['deptCosts', 'Department costs'],
    ['wages', 'Wages'],
    ['contribution', 'Contribution'],
    ['salesVarPct', 'Sales vs last year %'],
    ['salesLY', 'Sales last year']
  ];
  var ROW_ROLES = [
    ['ignore', 'Ignore'],
    ['revenue', 'Sales / revenue'],
    ['cogs', 'Cost of goods (COGS)'],
    ['wages', 'Wages'],
    ['expense', 'Other expense'],
    ['grossProfit', 'Gross profit (stated)'],
    ['operatingProfit', 'Operating profit'],
    ['netProfit', 'Net profit'],
    ['totalSales', 'Total sales (subtotal)'],
    ['totalExpenses', 'Total expenses (subtotal)'],
    ['overhead', 'Unallocated overhead']
  ];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function el(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
  function selectOpts(list, current) {
    return list.map(function (o) {
      return '<option value="' + o[0] + '"' + (o[0] === current ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('');
  }
  function sampleVal(grid, mapping, col) {
    // first non-empty value in that column below the header
    for (var r = mapping.headerRow + 1; r < Math.min(grid.length, mapping.headerRow + 8); r++) {
      var v = grid[r] && grid[r][col];
      if (v !== null && v !== undefined && String(v).trim() !== '') return String(v);
    }
    return '';
  }

  function previewTable(grid, mapping) {
    var maxRows = Math.min(grid.length, (mapping.headerRow || 0) + 9);
    var width = 0;
    grid.forEach(function (r) { width = Math.max(width, r.length); });
    width = Math.min(width, 10);
    var html = '<div class="scroll-x"><table class="preview-table"><tbody>';
    for (var r = 0; r < maxRows; r++) {
      var isHeader = r === mapping.headerRow;
      html += '<tr' + (isHeader ? ' style="background:#dff0e6;font-weight:700"' : '') + '>';
      for (var c = 0; c < width; c++) {
        var v = (grid[r] && grid[r][c] != null) ? grid[r][c] : '';
        var num = window.MarginIQCore.parseNumber(v) !== null && String(v).trim() !== '';
        html += '<td class="' + (num ? 'num' : '') + '">' + esc(v) + '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    return html;
  }

  function render(grid, mapping, opts) {
    var host = document.getElementById('screen-mapping');
    host.innerHTML = '';
    host.classList.remove('hidden');

    var conf = mapping.confidence >= 6 ? 'high' : (mapping.confidence >= 3 ? 'medium' : 'low');
    var orientLabel = mapping.orientation === 'deptCols' ? 'departments in columns' : 'departments in rows';

    host.appendChild(el(
      '<div class="banner"><span class="em">🔍</span><div>' +
      'We read your file and detected a P&L with <b>' + orientLabel + '</b> ' +
      '(' + esc(conf) + ' confidence). Check the guesses below and fix anything that looks wrong — ' +
      'this is the bit that makes a messy export usable.' +
      '</div></div>'
    ));

    var card = el('<div class="card"></div>');
    card.appendChild(el('<h3>Detected layout</h3>'));
    card.appendChild(el('<div class="sub">If the layout is wrong, switch it here. We highlight the header row in green.</div>'));
    var pills = el('<div class="orient-pills"></div>');
    [['deptRows', 'Departments in rows'], ['deptCols', 'Departments in columns']].forEach(function (o) {
      var b = el('<button class="pill-btn' + (mapping.orientation === o[0] ? ' active' : '') + '">' + o[1] + '</button>');
      b.addEventListener('click', function () {
        if (mapping.orientation === o[0]) return;
        var alt = mapping.alternatives && mapping.alternatives[o[0]];
        if (alt) { alt.grid = grid; alt.alternatives = mapping.alternatives; render(grid, alt, opts); }
        else alert('That layout was not detectable for this file. The current layout is the best fit.');
      });
      pills.appendChild(b);
    });
    card.appendChild(pills);
    card.appendChild(el(previewTable(grid, mapping)));
    host.appendChild(card);

    if (mapping.orientation === 'deptCols') renderDeptCols(host, grid, mapping);
    else renderDeptRows(host, grid, mapping);

    var actions = el('<div class="actions"></div>');
    var go = el('<button class="btn">Looks good — analyze →</button>');
    go.addEventListener('click', function () { opts.onConfirm(mapping); });
    var back = el('<button class="btn secondary">← Choose a different file</button>');
    back.addEventListener('click', function () { opts.onBack(); });
    actions.appendChild(go); actions.appendChild(back);
    host.appendChild(actions);
    window.scrollTo(0, 0);
  }

  function renderDeptRows(host, grid, mapping) {
    var card = el('<div class="card"></div>');
    card.appendChild(el('<h3>What each column means</h3>'));
    card.appendChild(el('<div class="sub">We matched your column headers to the figures we need.</div>'));
    var gridEl = el('<div class="map-grid"></div>');
    var width = grid[mapping.headerRow] ? grid[mapping.headerRow].length : 0;
    for (var c = 0; c < width; c++) {
      var headerLabel = (grid[mapping.headerRow] && grid[mapping.headerRow][c] != null) ? String(grid[mapping.headerRow][c]) : '';
      var role = mapping.columnRoles[c] || 'ignore';
      if (role === 'gpPct' || role === 'contribPct') role = 'ignore'; // recomputed
      var sample = sampleVal(grid, mapping, c);
      var item = el(
        '<div class="map-item"><div class="h">Column: <span class="sample">' +
        (headerLabel ? esc(headerLabel) : '(no header)') + '</span></div>' +
        (sample ? '<div class="h" style="margin-bottom:7px">e.g. ' + esc(sample) + '</div>' : '') +
        '<select>' + selectOpts(COL_ROLES, role) + '</select></div>'
      );
      (function (col, sel) {
        sel.querySelector('select').addEventListener('change', function (e) {
          var v = e.target.value;
          if (v === 'ignore') delete mapping.columnRoles[col];
          else mapping.columnRoles[col] = v;
        });
      })(c, item);
      gridEl.appendChild(item);
    }
    card.appendChild(gridEl);
    host.appendChild(card);

    // Departments
    var dcard = el('<div class="card"></div>');
    dcard.appendChild(el('<h3>Departments we found <span class="sub">(' + mapping.deptRows.length + ')</span></h3>'));
    dcard.appendChild(el('<div class="sub">Untick anything that is a subtotal or not a real department.</div>'));
    var list = el('<div class="chklist"></div>');
    mapping.deptRows.forEach(function (dr) {
      var lab = el('<label class="chk' + (dr.isSubtotal ? ' sub' : '') + '"><input type="checkbox"' + (dr.include !== false ? ' checked' : '') + '><span>' + esc(dr.name) + (dr.isSubtotal ? ' · subtotal' : '') + '</span></label>');
      lab.querySelector('input').addEventListener('change', function (e) { dr.include = e.target.checked; });
      list.appendChild(lab);
    });
    dcard.appendChild(list);
    if (mapping.notesCols && mapping.notesCols.length) {
      dcard.appendChild(el('<div class="mining-note">💡 We also scanned a notes column for buried wage figures (e.g. “Wages 16,118”) so wages-to-sales can be calculated even when there is no wages column.</div>'));
    }
    host.appendChild(dcard);
  }

  function renderDeptCols(host, grid, mapping) {
    var card = el('<div class="card"></div>');
    card.appendChild(el('<h3>Departments (columns) <span class="sub">(' + mapping.deptCols.length + ')</span></h3>'));
    card.appendChild(el('<div class="sub">Tick the columns that are departments and fix any names.</div>'));
    var list = el('<div class="map-grid"></div>');
    mapping.deptCols.forEach(function (dc) {
      var item = el(
        '<div class="map-item"><label class="h" style="cursor:pointer"><input type="checkbox"' +
        (dc.include !== false ? ' checked' : '') + '> use this column</label>' +
        '<input type="text" value="' + esc(dc.name) + '"></div>'
      );
      item.querySelector('input[type=checkbox]').addEventListener('change', function (e) { dc.include = e.target.checked; });
      item.querySelector('input[type=text]').addEventListener('input', function (e) { dc.name = e.target.value; });
      list.appendChild(item);
    });
    card.appendChild(list);
    host.appendChild(card);

    var rcard = el('<div class="card"></div>');
    rcard.appendChild(el('<h3>What each line means</h3>'));
    rcard.appendChild(el('<div class="sub">We classified each account row. Fix any that look wrong.</div>'));
    var gridEl = el('<div class="map-grid"></div>');
    Object.keys(mapping.rowRoles).map(Number).sort(function (a, b) { return a - b; }).forEach(function (r) {
      var label = (grid[r] && grid[r][mapping.labelCol] != null) ? String(grid[r][mapping.labelCol]) : '';
      var role = mapping.rowRoles[r];
      var item = el(
        '<div class="map-item"><div class="h">Row: <span class="sample">' + esc(label) + '</span></div>' +
        '<select>' + selectOpts(ROW_ROLES, role) + '</select></div>'
      );
      (function (row, sel) {
        sel.querySelector('select').addEventListener('change', function (e) {
          var v = e.target.value;
          if (v === 'ignore') delete mapping.rowRoles[row];
          else mapping.rowRoles[row] = v;
        });
      })(r, item);
      gridEl.appendChild(item);
    });
    rcard.appendChild(gridEl);
    host.appendChild(rcard);
  }

  window.MarginIQMapping = { render: render };
})();
