/*
 * Margin IQ — core engine (environment-agnostic, no DOM).
 *
 * Pipeline:   raw grid (array-of-arrays)  ->  detect(grid)  ->  mapping
 *             grid + mapping              ->  buildModel    ->  dataset
 *             dataset                     ->  generateInsights
 *
 * Two real-world P&L layouts are supported:
 *   A) "deptRows"  — departments are ROWS, metrics are COLUMNS
 *                    (the margins-table shape: Dept | Sales | Stock cost | GP | Dept costs | Contribution ...)
 *   B) "deptCols"  — departments are COLUMNS, account lines are ROWS
 *                    (the classic Xero / MYOB / QuickBooks "P&L by tracking category" shape)
 *
 * Everything here is pure data so the same code powers the browser UI and the
 * Node verification harness. Exposed on `window.MarginIQCore` and as a CommonJS module.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MarginIQCore = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Number / string helpers — resilient to messy spreadsheet formatting.
  // ---------------------------------------------------------------------------

  // Parse a cell into a number, or null if it isn't really numeric.
  // Handles: "$1,234.56", "(123)" => -123, "1,234", "45.6%", "—", "-", "n/a".
  function parseNumber(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).trim();
    if (!s) return null;
    var low = s.toLowerCase();
    if (low === 'n/a' || low === 'na' || low === '-' || low === '—' || low === '–' || low === '.') return null;
    // bracketed negatives: (1,234) or ($1,234)
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/-\s*$/.test(s) || /^-/.test(s)) neg = neg || /^-/.test(s) || /-\s*$/.test(s);
    // strip currency symbols, thousands separators, percent, spaces, trailing minus
    s = s.replace(/[%$£€\s]/g, '').replace(/,/g, '').replace(/-\s*$/, '');
    if (s === '' || s === '-') return null;
    if (!/^-?\d*\.?\d+$/.test(s)) return null;
    var n = parseFloat(s);
    if (!isFinite(n)) return null;
    return neg ? -Math.abs(n) : n;
  }

  // Is this cell "numeric-looking" (used for layout detection)?
  function isNumericCell(v) {
    if (v === null || v === undefined || v === '') return false;
    return parseNumber(v) !== null;
  }

  function cellStr(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  function norm(v) {
    return cellStr(v).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // Normalize a raw array-of-arrays into a rectangular grid of trimmed values.
  function normalizeGrid(aoa) {
    if (!Array.isArray(aoa)) return [];
    var width = 0;
    aoa.forEach(function (r) { if (Array.isArray(r)) width = Math.max(width, r.length); });
    return aoa.map(function (r) {
      var row = Array.isArray(r) ? r.slice() : [];
      for (var i = 0; i < width; i++) {
        if (row[i] === undefined) row[i] = null;
        else if (typeof row[i] === 'string') row[i] = row[i].trim();
      }
      return row;
    });
  }

  function rowIsBlank(row) {
    return !row.some(function (c) { return cellStr(c) !== ''; });
  }

  // ---------------------------------------------------------------------------
  // Label classifiers — map free-text labels to canonical roles.
  // ---------------------------------------------------------------------------

  // Column-header roles for the deptRows layout.
  var COLUMN_PATTERNS = [
    ['dept',         /^(department|dept|category|categories|account|name|cost ?cent(re|er)|tracking|line|item)\b/i],
    ['salesVarPct',  /vs ?ly|vs last|var(iance)?|growth|yoy|y\/y|change %|chg/i],
    ['gpPct',        /(gp|gross|margin)\s*%|%\s*(gp|gross|margin)|margin %/i],
    ['contribPct',   /contrib(ution)?\s*%/i],
    ['cogs',         /cogs|cost of (goods|sales)|stock ?cost|purchases?|c\.?o\.?g\.?s/i],
    ['gp',           /gross (profit|margin)|^gp\b|gp ?\$/i],
    ['deptCosts',    /(dept|department|direct)\s*(costs?|expenses?)|operating expense|overheads?\b/i],
    ['wages',        /wages?|salar(y|ies)|payroll|labou?r/i],
    ['contribution', /contrib(ution)?/i],
    ['salesLY',      /(sales|revenue).*(ly|last year|prior)|ly (sales|revenue)/i],
    ['sales',        /sales|revenue|turnover|^income|takings|net sales/i]
  ];

  function classifyColumnHeader(label) {
    var s = norm(label);
    if (!s) return null;
    for (var i = 0; i < COLUMN_PATTERNS.length; i++) {
      if (COLUMN_PATTERNS[i][1].test(s)) return COLUMN_PATTERNS[i][0];
    }
    return null;
  }

  // Account-line roles for the deptCols layout (matched against the row label).
  var ROW_PATTERNS = [
    ['netProfit',        /net (profit|income|earnings)|profit after|net result/i],
    ['operatingProfit',  /operating (profit|income)|ebit|trading profit/i],
    ['grossProfit',      /gross (profit|margin)/i],
    ['totalSales',       /total (sales|revenue|income)/i],
    ['overhead',         /unallocated|overhead/i],
    ['cogs',             /cogs|cost of (goods|sales)|stock|purchases?|opening stock|closing stock/i],
    ['wages',            /wages?|salar(y|ies)|payroll|labou?r|superannuation|super\b/i],
    ['revenue',          /sales|revenue|turnover|income|takings|fees/i],
    ['totalExpenses',    /total (expenses?|operating|overheads?)/i],
    ['expense',          /expense|rent|freight|packaging|electricity|power|insurance|advertis|marketing|repairs?|maintenance|fees|donations?|motor|vehicle|admin|cleaning|rates|telephone|phone|internet|subscription|bank|fuel|other/i]
  ];

  function classifyRowLabel(label) {
    var s = norm(label);
    if (!s) return null;
    for (var i = 0; i < ROW_PATTERNS.length; i++) {
      if (ROW_PATTERNS[i][1].test(s)) return ROW_PATTERNS[i][0];
    }
    return null;
  }

  // Labels that mark whole-business total rows (never a department).
  var BUSINESS_LABEL = /^(total|sum of|net profit|net income|operating profit|gross profit|unallocated|overhead|profit|loss|grand total|ebit)/i;
  function isBusinessLabel(label) { return BUSINESS_LABEL.test(norm(label)); }

  // A row/col label that is a subtotal / combined line (shown but excluded from sums).
  function isSubtotalLabel(label) {
    return /combined|subtotal|sub-total|↳|^\s*↳|^\s*-{1,}>|total /i.test(cellStr(label));
  }

  // Heuristic: does a string look like a department NAME (for deptCols header detection)?
  function looksLikeDeptName(label) {
    var s = norm(label);
    if (!s) return false;
    if (parseNumber(label) !== null) return false;
    if (/^(total|account|description|details?|notes?|ledger|gl|code|%)/i.test(s)) return false;
    if (classifyRowLabel(label)) return false;     // it's an account line, not a dept
    if (classifyColumnHeader(label)) return false; // it's a metric header (margins-table), not a dept
    return s.length <= 40;
  }

  // ---------------------------------------------------------------------------
  // DETECTION
  // ---------------------------------------------------------------------------

  function detect(grid) {
    grid = normalizeGrid(grid);
    var a = detectDeptRows(grid);
    var b = detectDeptCols(grid);
    var chosen;
    if (a && b) chosen = a.confidence >= b.confidence ? a : b;
    else chosen = a || b;
    if (!chosen) {
      // Fall back to an empty deptRows mapping the user can fix by hand.
      chosen = { orientation: 'deptRows', headerRow: 0, labelCol: 0, columnRoles: {}, deptRows: [], confidence: 0 };
    }
    chosen.grid = grid;
    chosen.alternatives = { deptRows: a, deptCols: b };
    return chosen;
  }

  // --- Layout A: departments as rows -----------------------------------------
  function detectDeptRows(grid) {
    var best = null;
    var scanLimit = Math.min(grid.length, 25);
    for (var r = 0; r < scanLimit; r++) {
      var row = grid[r];
      if (rowIsBlank(row)) continue;
      var roles = {};
      var labelCol = -1;
      var metricHits = 0;
      for (var c = 0; c < row.length; c++) {
        var role = classifyColumnHeader(row[c]);
        if (!role) continue;
        if (role === 'dept' && labelCol === -1) { labelCol = c; roles[c] = 'dept'; continue; }
        if (role !== 'dept' && !roles[c]) { roles[c] = role; metricHits++; }
      }
      // need a sales-ish column to be a real margins header
      var hasSales = Object.keys(roles).some(function (k) { return roles[k] === 'sales'; });
      if (labelCol === -1) {
        // header might not label the dept column explicitly; treat col 0 as label
        // only if we still found strong metric headers including sales
        if (hasSales && metricHits >= 2) { labelCol = 0; roles[0] = roles[0] || 'dept'; }
        else continue;
      }
      if (!hasSales || metricHits < 2) continue;

      var score = metricHits + (hasSales ? 1 : 0);
      if (!best || score > best.confidence) {
        best = { orientation: 'deptRows', headerRow: r, labelCol: labelCol, columnRoles: roles, confidence: score };
      }
    }
    if (!best) return null;
    annotateDeptRows(grid, best);
    return best;
  }

  // Decide which rows below the header are department rows vs business totals.
  function annotateDeptRows(grid, m) {
    var deptRows = [];
    var notesCols = inferNotesColumns(grid, m);
    m.notesCols = notesCols;
    for (var r = m.headerRow + 1; r < grid.length; r++) {
      var row = grid[r];
      if (rowIsBlank(row)) continue;
      var label = cellStr(row[m.labelCol]);
      if (!label) {
        // label-less but numeric row right under header — could be a stray total; skip
        continue;
      }
      // does it carry at least one numeric metric value?
      var hasNum = Object.keys(m.columnRoles).some(function (c) {
        return m.columnRoles[c] !== 'dept' && isNumericCell(row[c]);
      });
      if (!hasNum) continue;
      if (isBusinessLabel(label)) continue; // captured separately as business total
      deptRows.push({ row: r, name: label, isSubtotal: isSubtotalLabel(label), include: true });
    }
    m.deptRows = deptRows;
  }

  // Trailing text columns (no header role) in a deptRows sheet often hold notes
  // where wages etc. are buried. Detect them so we can mine wages.
  function inferNotesColumns(grid, m) {
    var width = grid[m.headerRow] ? grid[m.headerRow].length : 0;
    var cols = [];
    for (var c = 0; c < width; c++) {
      if (m.columnRoles[c]) continue;
      // count text-vs-number in the rows below header for this column
      var text = 0, num = 0;
      for (var r = m.headerRow + 1; r < grid.length; r++) {
        var v = grid[r][c];
        if (cellStr(v) === '') continue;
        if (isNumericCell(v)) num++; else text++;
      }
      if (text >= 1 && text >= num) cols.push(c);
    }
    return cols;
  }

  // --- Layout B: departments as columns --------------------------------------
  function detectDeptCols(grid) {
    // Find the account-label column: the column with the most classifiable account lines.
    var width = 0;
    grid.forEach(function (row) { width = Math.max(width, row.length); });
    var bestLabelCol = -1, bestLabelHits = 0, accountRowsByCol = {};
    for (var c = 0; c < width; c++) {
      var hits = 0, rowsHit = [];
      for (var r = 0; r < grid.length; r++) {
        var role = classifyRowLabel(grid[r][c]);
        if (role) { hits++; rowsHit.push(r); }
      }
      accountRowsByCol[c] = rowsHit;
      if (hits > bestLabelHits) { bestLabelHits = hits; bestLabelCol = c; }
    }
    if (bestLabelCol === -1 || bestLabelHits < 2) return null;

    // Header row = the last non-blank row above the first account line that has
    // several dept-name-like cells to the right of the label column.
    var firstAccountRow = (accountRowsByCol[bestLabelCol] || [])[0];
    if (firstAccountRow === undefined) return null;
    var headerRow = -1, deptCols = [];
    for (var hr = firstAccountRow - 1; hr >= 0; hr--) {
      if (rowIsBlank(grid[hr])) continue;
      var candidates = [];
      for (var cc = 0; cc < width; cc++) {
        if (cc === bestLabelCol) continue;
        if (looksLikeDeptName(grid[hr][cc])) candidates.push(cc);
      }
      if (candidates.length >= 1) { headerRow = hr; deptCols = candidates; break; }
    }
    // A real "P&L by department" sheet has a text header row of department names.
    // If we never found one, this isn't a deptCols layout — bail rather than guess.
    if (headerRow === -1 || !deptCols.length) return null;

    // Build row roles for every row carrying an account label.
    var rowRoles = {};
    for (var rr = 0; rr < grid.length; rr++) {
      var role2 = classifyRowLabel(grid[rr][bestLabelCol]);
      if (role2) rowRoles[rr] = role2;
    }
    // Require the hallmark of an income statement: revenue plus a cost/profit line.
    var roleSet = {};
    Object.keys(rowRoles).forEach(function (k) { roleSet[rowRoles[k]] = true; });
    var hasRevenue = roleSet.revenue || roleSet.totalSales;
    var hasCostOrProfit = roleSet.cogs || roleSet.grossProfit || roleSet.netProfit || roleSet.operatingProfit || roleSet.expense || roleSet.wages;
    if (!hasRevenue || !hasCostOrProfit) return null;

    // Identify a "Total" department column to drop / treat as business totals.
    var totalCols = deptCols.filter(function (c) { return /total|all dept|company|consolidat/i.test(norm(grid[headerRow][c])); });
    var realDeptCols = deptCols.filter(function (c) { return totalCols.indexOf(c) === -1; });
    if (!realDeptCols.length) realDeptCols = deptCols; // everything was "total"? keep them

    var m = {
      orientation: 'deptCols',
      headerRow: headerRow,
      labelCol: bestLabelCol,
      deptCols: realDeptCols.map(function (c) { return { col: c, name: cellStr(grid[headerRow][c]) || ('Dept ' + (c + 1)), include: true }; }),
      totalCols: totalCols,
      rowRoles: rowRoles,
      confidence: bestLabelHits + realDeptCols.length
    };
    return m;
  }

  // ---------------------------------------------------------------------------
  // MODEL BUILDING
  // ---------------------------------------------------------------------------

  function buildModel(grid, mapping) {
    grid = normalizeGrid(grid);
    if (mapping.orientation === 'deptCols') return buildFromDeptCols(grid, mapping);
    return buildFromDeptRows(grid, mapping);
  }

  function finalizeDept(d) {
    if (d.gp === null && d.sales !== null && d.cogs !== null) d.gp = round2(d.sales - d.cogs);
    if (d.cogs === null && d.sales !== null && d.gp !== null) d.cogs = round2(d.sales - d.gp);
    d.gpPct = (d.sales && d.gp !== null) ? (d.gp / d.sales) * 100 : null;
    // deptCosts: prefer explicit; else build from wages + other
    if (d.deptCosts === null) {
      var parts = [];
      if (d.wages !== null) parts.push(d.wages);
      if (d.otherCosts !== null) parts.push(d.otherCosts);
      if (parts.length) d.deptCosts = round2(parts.reduce(function (a, b) { return a + b; }, 0));
    }
    if (d.contribution === null && d.gp !== null && d.deptCosts !== null) d.contribution = round2(d.gp - d.deptCosts);
    d.contribPct = (d.sales && d.contribution !== null) ? (d.contribution / d.sales) * 100 : null;
    d.wagesPct = (d.sales && d.wages !== null) ? (d.wages / d.sales) * 100 : null;
    return d;
  }

  function blankDept(name) {
    return {
      name: name, sales: null, cogs: null, gp: null, gpPct: null,
      wages: null, otherCosts: null, deptCosts: null,
      contribution: null, contribPct: null, wagesPct: null,
      salesLY: null, salesVarPct: null, isSubtotal: false, notes: ''
    };
  }

  function buildFromDeptRows(grid, m) {
    var departments = [];
    var roleByCol = m.columnRoles || {};
    (m.deptRows || []).forEach(function (dr) {
      if (dr.include === false) return;
      var row = grid[dr.row] || [];
      var d = blankDept(dr.name);
      d.isSubtotal = !!dr.isSubtotal;
      Object.keys(roleByCol).forEach(function (c) {
        var role = roleByCol[c];
        if (role === 'dept') return;
        var val = parseNumber(row[c]);
        if (val === null) return;
        if (role === 'gpPct' || role === 'contribPct') return; // recomputed
        if (role === 'salesVarPct') { d.salesVarPct = val; return; }
        if (d[role] === null || d[role] === undefined) d[role] = val;
      });
      // notes + wages mining from trailing text columns
      var noteParts = [];
      (m.notesCols || []).forEach(function (c) {
        var t = cellStr(row[c]);
        if (t) noteParts.push(t);
      });
      d.notes = noteParts.join(' · ');
      if (d.wages === null && d.notes) {
        var w = mineWages(d.notes);
        if (w !== null) d.wages = w;
      }
      finalizeDept(d);
      departments.push(d);
    });
    var business = extractBusinessTotals(grid, m, departments);
    return assemble(grid, m, departments, business);
  }

  function buildFromDeptCols(grid, m) {
    var departments = [];
    (m.deptCols || []).forEach(function (dc) {
      if (dc.include === false) return;
      var d = blankDept(dc.name);
      // Track detail lines and subtotal lines separately so a stated subtotal
      // (e.g. "Total Operating Expenses") never double-counts its own detail.
      var revDetail = 0, hasRevDetail = false, revTotal = null;
      var cogs = 0, hasCogs = false;
      var wages = 0, hasWages = false;
      var expDetail = 0, hasExpDetail = false, expTotal = null;
      var gp = null;
      Object.keys(m.rowRoles).forEach(function (r) {
        var role = m.rowRoles[r];
        var val = parseNumber(grid[r][dc.col]);
        if (val === null) return;
        switch (role) {
          case 'revenue':       revDetail += val; hasRevDetail = true; break;
          case 'totalSales':    revTotal = (revTotal || 0) + val; break;
          case 'cogs':          cogs += Math.abs(val); hasCogs = true; break;
          case 'wages':         wages += Math.abs(val); hasWages = true; break;
          case 'expense':       expDetail += Math.abs(val); hasExpDetail = true; break; // non-wage detail
          case 'totalExpenses': expTotal = (expTotal || 0) + Math.abs(val); break;       // includes wages
          case 'grossProfit':   gp = val; break;
          default: break; // netProfit / operatingProfit / overhead handled at business level
        }
      });
      d.sales = hasRevDetail ? round2(revDetail) : (revTotal !== null ? round2(revTotal) : null);
      d.cogs = hasCogs ? round2(cogs) : null;
      d.wages = hasWages ? round2(wages) : null;
      if (gp !== null) d.gp = round2(gp);
      // Department costs, computed explicitly to avoid double-counting wages
      // against an expense subtotal that already includes them.
      if (hasWages || hasExpDetail) {
        d.deptCosts = round2((hasWages ? wages : 0) + (hasExpDetail ? expDetail : 0));
        d.otherCosts = hasExpDetail ? round2(expDetail) : 0;
      } else if (expTotal !== null) {
        d.deptCosts = round2(expTotal);
        d.otherCosts = round2(expTotal); // wages not separable
      }
      finalizeDept(d);
      departments.push(d);
    });
    var business = extractBusinessTotalsDeptCols(grid, m, departments);
    return assemble(grid, m, departments, business);
  }

  // Pull "Wages 16118" style figures out of a free-text notes cell.
  function mineWages(text) {
    var total = 0, found = false;
    var re = /(?:wages?|salar(?:y|ies)|payroll)\s*(?:\([^)]*\))?\s*[:=]?\s*\$?\s*([\d,]+(?:\.\d+)?)/gi;
    var match;
    while ((match = re.exec(text)) !== null) {
      var n = parseNumber(match[1]);
      if (n !== null) { total += n; found = true; }
    }
    return found ? round2(total) : null;
  }

  // Pull a percentage stated inside a label, e.g. "NET PROFIT (1.26%)" -> 1.26.
  function minePct(label) {
    var m = String(label).match(/\(?\s*(-?\d+(?:\.\d+)?)\s*%\s*\)?/);
    return m ? parseFloat(m[1]) : null;
  }

  function extractBusinessTotals(grid, m, departments) {
    var biz = {
      totalSales: null, totalGP: null, sumContributions: null,
      unallocatedOverhead: null, operatingProfit: null, netProfit: null,
      // stated percentages, honored over computed ones when present in the file
      totalGPPctStated: null, operatingProfitPctStated: null, netProfitPctStated: null
    };
    function firstNum(row) {
      for (var c = 0; c < row.length; c++) { var n = parseNumber(row[c]); if (n !== null) return n; }
      return null;
    }
    for (var r = 0; r < grid.length; r++) {
      var rawLab = cellStr(grid[r][m.labelCol]) || cellStr(grid[r][0]);
      var lab = norm(rawLab);
      if (!lab) continue;
      var val = firstNum(grid[r]);
      if (val === null) continue;
      if (biz.totalSales === null && /total sales|total revenue/.test(lab)) biz.totalSales = val;
      else if (biz.totalGP === null && /total gross profit/.test(lab)) { biz.totalGP = val; biz.totalGPPctStated = minePct(rawLab); }
      else if (biz.sumContributions === null && /sum of .*contribution/.test(lab)) biz.sumContributions = val;
      else if (biz.unallocatedOverhead === null && /unallocated overhead|^overhead/.test(lab)) biz.unallocatedOverhead = val;
      else if (biz.operatingProfit === null && /operating profit|operating income/.test(lab)) { biz.operatingProfit = val; biz.operatingProfitPctStated = minePct(rawLab); }
      else if (biz.netProfit === null && /net profit|net income/.test(lab)) { biz.netProfit = val; biz.netProfitPctStated = minePct(rawLab); }
    }
    return biz;
  }

  function extractBusinessTotalsDeptCols(grid, m, departments) {
    var biz = { totalSales: null, totalGP: null, sumContributions: null, unallocatedOverhead: null, operatingProfit: null, netProfit: null };
    // Prefer a "Total" column if present; else aggregate dept-col values.
    var totalCol = (m.totalCols && m.totalCols.length) ? m.totalCols[0] : null;
    function valAt(r) {
      if (totalCol !== null) { var v = parseNumber(grid[r][totalCol]); if (v !== null) return v; }
      // sum across real dept columns
      var s = 0, any = false;
      (m.deptCols || []).forEach(function (dc) { var n = parseNumber(grid[r][dc.col]); if (n !== null) { s += n; any = true; } });
      return any ? round2(s) : null;
    }
    Object.keys(m.rowRoles).forEach(function (r) {
      var role = m.rowRoles[r];
      var v = valAt(Number(r));
      if (v === null) return;
      if (role === 'netProfit' && biz.netProfit === null) biz.netProfit = v;
      else if (role === 'operatingProfit' && biz.operatingProfit === null) biz.operatingProfit = v;
      else if (role === 'overhead' && biz.unallocatedOverhead === null) biz.unallocatedOverhead = v;
    });
    return biz;
  }

  // Fill in business totals from department aggregates where the file didn't state them.
  function assemble(grid, m, departments, business) {
    var summable = departments.filter(function (d) { return !d.isSubtotal; });
    var sum = function (key) {
      var any = false, t = 0;
      summable.forEach(function (d) { if (d[key] !== null && d[key] !== undefined) { t += d[key]; any = true; } });
      return any ? round2(t) : null;
    };
    if (business.totalSales === null) business.totalSales = sum('sales');
    if (business.totalGP === null) business.totalGP = sum('gp');
    if (business.sumContributions === null) business.sumContributions = sum('contribution');

    // Honor percentages stated in the source file; otherwise compute on detected sales.
    business.totalGPPct = (business.totalGPPctStated !== null && business.totalGPPctStated !== undefined)
      ? business.totalGPPctStated
      : ((business.totalSales && business.totalGP !== null) ? (business.totalGP / business.totalSales) * 100 : null);
    business.netProfitPct = (business.netProfitPctStated !== null && business.netProfitPctStated !== undefined)
      ? business.netProfitPctStated
      : ((business.totalSales && business.netProfit !== null) ? (business.netProfit / business.totalSales) * 100 : null);
    // derive operating profit if we can
    if (business.operatingProfit === null && business.sumContributions !== null && business.unallocatedOverhead !== null) {
      business.operatingProfit = round2(business.sumContributions - business.unallocatedOverhead);
    }

    var warnings = [];
    if (!departments.length) warnings.push('No department rows were detected — check the mapping.');
    departments.forEach(function (d) {
      if (d.sales === null && !d.isSubtotal) warnings.push('"' + d.name + '" has no sales figure detected — check the column mapping.');
    });

    return {
      meta: { currency: '$' },
      orientation: m.orientation,
      departments: departments,
      business: business,
      warnings: warnings
    };
  }

  // ---------------------------------------------------------------------------
  // INSIGHTS — rules-based, manager-friendly plain English.
  // ---------------------------------------------------------------------------

  function generateInsights(dataset) {
    var depts = dataset.departments.filter(function (d) { return !d.isSubtotal && d.sales; });
    var callouts = [];
    var perDept = {};
    depts.forEach(function (d) { perDept[d.name] = []; });

    function add(list, sev, text, deptName) {
      var item = { severity: sev, text: text, dept: deptName || null };
      callouts.push(item);
      if (deptName && perDept[deptName]) perDept[deptName].push(item);
    }

    if (!depts.length) return { callouts: callouts, perDept: perDept };

    // Strongest margin
    var byGp = depts.filter(function (d) { return d.gpPct !== null; }).slice().sort(function (a, b) { return b.gpPct - a.gpPct; });
    if (byGp.length) {
      var top = byGp[0];
      add(callouts, 'good', top.name + ' is your strongest margin at ' + fmtPct(top.gpPct) + ' gross profit.', top.name);
    }

    // Biggest contributor (positive)
    var byContrib = depts.filter(function (d) { return d.contribution !== null; }).slice().sort(function (a, b) { return b.contribution - a.contribution; });
    if (byContrib.length && byContrib[0].contribution > 0) {
      var star = byContrib[0];
      add(callouts, 'good', star.name + ' contributes the most to the business — ' + fmtMoney(star.contribution) + ' after its own costs.', star.name);
    }

    // Negative contribution = losing money after direct costs
    depts.forEach(function (d) {
      if (d.contribution !== null && d.contribution < 0) {
        add(callouts, 'bad', d.name + ' has a NEGATIVE contribution (' + fmtMoney(d.contribution) + ') — it costs more to run than it makes after stock and direct costs.', d.name);
      }
    });

    // Wages too heavy
    depts.forEach(function (d) {
      if (d.wagesPct === null) return;
      if (d.wagesPct >= 40) add(callouts, 'bad', d.name + ' wages are ' + fmtPct(d.wagesPct) + ' of sales — that\'s the leak. Few departments survive a ratio this high.', d.name);
      else if (d.wagesPct >= 30) add(callouts, 'warn', d.name + ' wages are ' + fmtPct(d.wagesPct) + ' of sales — on the heavy side; worth watching rosters vs trade.', d.name);
    });

    // Sales decline
    depts.forEach(function (d) {
      if (d.salesVarPct === null) return;
      if (d.salesVarPct <= -10) add(callouts, 'warn', d.name + ' sales are down ' + fmtPct(Math.abs(d.salesVarPct)) + ' vs last year.', d.name);
      else if (d.salesVarPct >= 10) add(callouts, 'good', d.name + ' sales are up ' + fmtPct(d.salesVarPct) + ' vs last year.', d.name);
    });

    // Low GP for the pack (more than ~10pts below the best)
    if (byGp.length >= 2) {
      var worst = byGp[byGp.length - 1];
      if (worst.gpPct !== null && byGp[0].gpPct - worst.gpPct >= 10) {
        add(callouts, 'warn', worst.name + ' has the thinnest gross margin at ' + fmtPct(worst.gpPct) + ' — check buying and markup.', worst.name);
      }
    }

    return { callouts: callouts, perDept: perDept };
  }

  // ---------------------------------------------------------------------------
  // Formatting helpers (shared with UI).
  // ---------------------------------------------------------------------------
  function round2(n) { return Math.round(n * 100) / 100; }
  function fmtMoney(n) {
    if (n === null || n === undefined) return '—';
    var neg = n < 0;
    return (neg ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
  }
  function fmtPct(n) { return (n === null || n === undefined) ? '—' : n.toFixed(1) + '%'; }

  return {
    parseNumber: parseNumber,
    normalizeGrid: normalizeGrid,
    classifyColumnHeader: classifyColumnHeader,
    classifyRowLabel: classifyRowLabel,
    detect: detect,
    buildModel: buildModel,
    generateInsights: generateInsights,
    mineWages: mineWages,
    fmtMoney: fmtMoney,
    fmtPct: fmtPct,
    round2: round2
  };
});
