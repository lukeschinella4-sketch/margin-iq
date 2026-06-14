/* Margin IQ — export the scoreboard to CSV / Excel (client-side, via SheetJS). */
(function () {
  'use strict';
  var C = window.MarginIQCore;

  // Build a clean array-of-arrays scoreboard. If singleDept is set, export only
  // that department and omit whole-business net profit (manager-safe copy).
  function buildAOA(dataset, opts) {
    opts = opts || {};
    var rows = [];
    rows.push(['Margin IQ — Department Scoreboard']);
    if (opts.singleDept) rows.push(['Manager copy: ' + opts.singleDept + ' (whole-business net profit hidden)']);
    rows.push([]);
    rows.push(['Department', 'Sales', 'GP $', 'GP %', 'Wages', 'Wages % of sales', 'Dept costs', 'Contribution', 'Contribution %', 'Notes']);

    var depts = dataset.departments.filter(function (d) {
      return opts.singleDept ? (d.name === opts.singleDept) : true;
    });
    depts.forEach(function (d) {
      rows.push([
        d.name,
        num(d.sales), num(d.gp), pct(d.gpPct),
        num(d.wages), pct(d.wagesPct),
        num(d.deptCosts), num(d.contribution), pct(d.contribPct),
        d.notes || ''
      ]);
    });

    if (!opts.singleDept) {
      var b = dataset.business;
      rows.push([]);
      rows.push(['WHOLE BUSINESS']);
      pushBiz(rows, 'Total sales', b.totalSales);
      pushBiz(rows, 'Total gross profit', b.totalGP, b.totalGPPct);
      pushBiz(rows, 'Sum of contributions', b.sumContributions);
      pushBiz(rows, 'Unallocated overhead', b.unallocatedOverhead);
      pushBiz(rows, 'Operating profit', b.operatingProfit);
      pushBiz(rows, 'Net profit', b.netProfit, b.netProfitPct);
    }
    return rows;
  }

  function pushBiz(rows, label, val, pctVal) {
    if (val === null || val === undefined) return;
    var r = [label, num(val)];
    if (pctVal !== null && pctVal !== undefined) r.push(round1(pctVal) + '%');
    rows.push(r);
  }
  function num(n) { return (n === null || n === undefined) ? '' : C.round2(n); }
  function pct(n) { return (n === null || n === undefined) ? '' : round1(n) + '%'; }
  function round1(n) { return Math.round(n * 10) / 10; }

  function sheetFromAOA(dataset, opts) {
    var ws = XLSX.utils.aoa_to_sheet(buildAOA(dataset, opts));
    ws['!cols'] = [{ wch: 32 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 13 }, { wch: 14 }, { wch: 40 }];
    return ws;
  }

  function exportExcel(dataset, opts) {
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetFromAOA(dataset, opts), 'Scoreboard');
    XLSX.writeFile(wb, filename(opts, 'xlsx'));
  }
  function exportCSV(dataset, opts) {
    var ws = sheetFromAOA(dataset, opts);
    var csv = XLSX.utils.sheet_to_csv(ws);
    triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), filename(opts, 'csv'));
  }
  function filename(opts, ext) {
    var base = (opts && opts.singleDept) ? ('margin-iq-' + slug(opts.singleDept)) : 'margin-iq-scoreboard';
    return base + '.' + ext;
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function triggerDownload(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  window.MarginIQExport = { exportExcel: exportExcel, exportCSV: exportCSV };
})();
