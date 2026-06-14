/* Margin IQ — app orchestration: read file -> detect -> map -> analyze. */
(function () {
  'use strict';
  var C = window.MarginIQCore;

  var screens = {
    upload: document.getElementById('screen-upload'),
    mapping: document.getElementById('screen-mapping'),
    board: document.getElementById('screen-board')
  };
  var lastGrid = null;

  function show(name) {
    Object.keys(screens).forEach(function (k) { screens[k].classList.toggle('hidden', k !== name); });
    document.getElementById('btn-restart').classList.toggle('hidden', name === 'upload');
  }

  // ---- File reading -------------------------------------------------------
  function readFile(file) {
    var name = (file.name || '').toLowerCase();
    if (/\.pdf$/.test(name)) {
      alert('PDF P&L parsing is coming soon.\n\nFor now, export your P&L as CSV or Excel (.xlsx) from MYOB / Xero / QuickBooks and upload that — it parses cleanly.');
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () { alert('Sorry — could not read that file.'); };
    if (/\.csv$/.test(name) || /\.txt$/.test(name)) {
      reader.onload = function (e) { handleGrid(gridFromCsv(e.target.result)); };
      reader.readAsText(file);
    } else if (/\.xlsx$/.test(name) || /\.xls$/.test(name)) {
      reader.onload = function (e) {
        try { handleGrid(gridFromXlsx(e.target.result)); }
        catch (err) { alert('Could not parse that spreadsheet: ' + err.message); }
      };
      reader.readAsArrayBuffer(file);
    } else {
      alert('Unsupported file type. Please upload a CSV or Excel (.xlsx) P&L.');
    }
  }

  function gridFromCsv(text) {
    return Papa.parse(text, { skipEmptyLines: false }).data;
  }

  function gridFromXlsx(arrayBuffer) {
    var wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
    // Pick the sheet with the most populated cells (the actual data sheet).
    var best = null, bestScore = -1;
    wb.SheetNames.forEach(function (sn) {
      var ws = wb.Sheets[sn];
      var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
      var score = 0;
      aoa.forEach(function (r) { r.forEach(function (c) { if (c !== null && c !== '') score++; }); });
      if (score > bestScore) { bestScore = score; best = aoa; }
    });
    return best || [];
  }

  function handleGrid(grid) {
    if (!grid || !grid.length) { alert('That file looks empty.'); return; }
    lastGrid = grid;
    var mapping = C.detect(grid);
    window.MarginIQMapping.render(grid, mapping, {
      onConfirm: function (m) {
        var dataset = C.buildModel(lastGrid, m);
        window.MarginIQBoard.render(dataset);
        show('board');
      },
      onBack: function () { show('upload'); }
    });
    show('mapping');
  }

  // ---- Upload wiring ------------------------------------------------------
  var dz = document.getElementById('dropzone');
  var fi = document.getElementById('fileInput');
  dz.addEventListener('click', function () { fi.click(); });
  fi.addEventListener('change', function (e) { if (e.target.files[0]) readFile(e.target.files[0]); fi.value = ''; });
  ['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); }); });
  dz.addEventListener('drop', function (e) { var f = e.dataTransfer.files[0]; if (f) readFile(f); });

  // Sample buttons (fetch the bundled CSVs; needs the page to be served over http).
  document.querySelectorAll('[data-sample]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var path = btn.getAttribute('data-sample');
      fetch(path).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      }).then(function (txt) { handleGrid(gridFromCsv(txt)); })
        .catch(function () {
          alert('Could not load the sample.\n\nSample buttons need the app to be served over a local server ' +
                '(e.g. `python3 -m http.server` then open http://localhost:8000), rather than opened as a file. ' +
                'You can still drag in your own CSV/Excel file directly.');
        });
    });
  });

  document.getElementById('btn-restart').addEventListener('click', function () { show('upload'); });
})();
