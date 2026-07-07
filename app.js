(function(){
  "use strict";
  var $ = function(id){ return document.getElementById(id); };
  var inA = $('inputA'), inB = $('inputB');
  var currentFilter = 'issue';
  var mode = 'id';                 // 'id' | 'nominal'
  var lastRows = [], lastTotals = null;

  var HINTS = {
    id:'Contoh Format <b>Transaction&nbsp;Id | Nama&nbsp;Rekening | Login&nbsp;Id/Username | Nominal</b>.',
    nominal:'Dicocokkan dari <b>nilai nominalnya</b> (kolom terakhir), bukan Transaction Id — berguna saat kedua sumber tak punya id yang sama. Boleh menempel hanya daftar angka; kolom lain opsional.'
  };

  /* ---------- Number parsing (Indonesia-friendly) ---------- */
  function parseNominal(raw){
    if(raw == null) return NaN;
    var s = String(raw).trim(); if(!s) return NaN;
    var neg = false;
    if(/^\(.*\)$/.test(s)){ neg = true; s = s.slice(1,-1); }
    if(/-/.test(s)) neg = neg || /^\s*-/.test(s);
    s = s.replace(/rp/ig,'').replace(/[^0-9.,]/g,''); if(!s) return NaN;
    var hasDot = s.indexOf('.')>-1, hasComma = s.indexOf(',')>-1;
    if(hasDot && hasComma){
      if(s.lastIndexOf('.')>s.lastIndexOf(',')){ s = s.replace(/,/g,''); }
      else { s = s.replace(/\./g,'').replace(/,/g,'.'); }
    } else if(hasComma){
      var cp = s.split(',');
      if(cp.length===2){ s = cp[0].replace(/\./g,'')+'.'+cp[1]; }
      else { s = s.replace(/,/g,''); }
    } else if(hasDot){
      var dp = s.split('.');
      if(!(dp.length===2 && dp[1].length!==3)) s = s.replace(/\./g,'');
    }
    var n = parseFloat(s); if(isNaN(n)) return NaN;
    return neg ? -Math.abs(n) : n;
  }

  /* ---------- Parse text -> list of {id, nama, login, amount} ----------
     Kolom: Transaction Id | Nama Rekening | Login Id/Username | Nominal
     Pemisah kolom: tab, garis tegak (|), titik koma (;), atau " - ".
     Nominal selalu kolom terakhir. Format lama (2 kolom) tetap didukung. */
  function parseData(text){
    var items = [], invalid = 0, lines = String(text).split(/\r?\n/);
    var SEP = /\t|\s*\|\s*|\s*;\s*|\s+-\s+/;
    for(var i=0;i<lines.length;i++){
      var t = lines[i].trim(); if(!t) continue;

      // 1) baris berkolom (ada pemisah tab/|/;/ - )
      if(SEP.test(t)){
        var parts = t.split(SEP).map(function(s){ return s.trim(); }).filter(function(s){ return s.length; });
        if(parts.length >= 2){
          var amt = parseNominal(parts[parts.length-1]);
          if(!isNaN(amt)){
            var id = parts[0]; if(/^rp\.?$/i.test(id)) id = '';
            var nama = parts.length >= 4 ? parts[1] : (parts.length === 3 ? parts[1] : '');
            var login = parts.length >= 4 ? parts[2] : '';
            items.push({ id:id, nama:nama, login:login, amount:amt });
            continue;
          }
        }
      }

      // 2) format lama "keterangan  nominal" (dipisah spasi)
      var m = t.match(/^(.*?)[\s;|\t]+(?:rp\.?\s*)?(\(?[-0-9][0-9.,)]*)\s*$/i);
      if(m){
        var id2 = m[1].replace(/[\s,;|]+$/,'').trim();
        if(/^rp\.?$/i.test(id2)) id2 = '';
        var a2 = parseNominal(m[2]);
        if(!isNaN(a2)){ items.push({ id:id2, nama:'', login:'', amount:a2 }); continue; }
      }

      // 3) hanya angka (mode nominal)
      var bm = t.match(/^(?:rp\.?\s*)?(\(?[-0-9][0-9.,)]*)$/i);
      if(bm){
        var a3 = parseNominal(bm[1]);
        if(!isNaN(a3)){ items.push({ id:'', nama:'', login:'', amount:a3 }); continue; }
      }
      invalid++;
    }
    return { items:items, invalid:invalid };
  }

  /* ---------- Formatting ---------- */
  function rupiah(n){
    var v = Math.round((n + Number.EPSILON) * 100) / 100;
    var neg = v < 0;
    var str = Math.abs(v).toLocaleString('id-ID',{minimumFractionDigits:0, maximumFractionDigits:2});
    return (neg ? '−Rp ' : 'Rp ') + str;
  }
  function nearlyEqual(a,b){ return Math.abs(a-b) < 0.005; }
  function centKey(a){ return String(Math.round((a + Number.EPSILON) * 100)); }

  /* ---------- Mode: cocokkan by ID / tiket ---------- */
  function compareById(itemsA, itemsB){
    function aggregate(items){
      var map = {}, order = [], noId = 0;
      items.forEach(function(it){
        var key = it.id ? it.id.toLowerCase() : ('\u0000noid#' + (noId++));
        if(map[key]){ map[key].amount += it.amount; map[key].n++; if(!map[key].nama) map[key].nama = it.nama; if(!map[key].login) map[key].login = it.login; }
        else { map[key] = { id: it.id || '(tanpa ID)', nama: it.nama||'', login: it.login||'', amount: it.amount, n:1 }; order.push(key); }
      });
      return { map:map, order:order };
    }
    var A = aggregate(itemsA), B = aggregate(itemsB);
    var keys = [], seen = {};
    A.order.concat(B.order).forEach(function(k){ if(!seen[k]){ seen[k]=1; keys.push(k); } });

    var rows=[], totA=0, totB=0, cMatch=0, cDiff=0, cOnlyA=0, cOnlyB=0;
    keys.forEach(function(k){
      var a = A.map[k], b = B.map[k];
      var xa = a ? a.amount : null, xb = b ? b.amount : null;
      if(xa!=null) totA += xa; if(xb!=null) totB += xb;
      var src = a || b;
      var row = { id:src.id, nama:(a&&a.nama)||(b&&b.nama)||'', login:(a&&a.login)||(b&&b.login)||'', a:xa, b:xb };
      if(a && b){ row.diff = xa - xb; if(nearlyEqual(xa,xb)){ row.status='ok'; cMatch++; } else { row.status='diff'; cDiff++; } }
      else if(a){ row.diff = xa; row.status='onlyA'; cOnlyA++; }
      else { row.diff = -xb; row.status='onlyB'; cOnlyB++; }
      rows.push(row);
    });
    return { rows:rows, totals:{ totA:totA, totB:totB, cMatch:cMatch, cDiff:cDiff, cOnlyA:cOnlyA, cOnlyB:cOnlyB } };
  }

  /* ---------- Mode: cocokkan by nominal ---------- */
  function compareByNominal(itemsA, itemsB){
    function group(items){ var g={}, order=[]; items.forEach(function(it){ var k=centKey(it.amount);
      if(!g[k]){ g[k]=[]; order.push(k); } g[k].push(it); }); return { g:g, order:order }; }
    var A = group(itemsA), B = group(itemsB);
    var keys = [], seen = {};
    A.order.concat(B.order).forEach(function(k){ if(!seen[k]){ seen[k]=1; keys.push(k); } });

    var rows=[], totA=0, totB=0, cMatch=0, cOnlyA=0, cOnlyB=0;
    itemsA.forEach(function(it){ totA += it.amount; });
    itemsB.forEach(function(it){ totB += it.amount; });

    function labelPair(a,b,amt){
      if(a.id && b.id){ return a.id === b.id ? a.id : (a.id + ' ↔ ' + b.id); }
      return a.id || b.id || rupiah(amt);
    }
    keys.forEach(function(k){
      var qa = A.g[k] || [], qb = B.g[k] || [];
      var amt = qa.length ? qa[0].amount : qb[0].amount;
      var matched = Math.min(qa.length, qb.length);
      for(var i=0;i<matched;i++){ rows.push({ id:labelPair(qa[i],qb[i],amt), nama:qa[i].nama||qb[i].nama||'', login:qa[i].login||qb[i].login||'', a:amt, b:amt, diff:0, status:'ok' }); cMatch++; }
      for(var i=matched;i<qa.length;i++){ rows.push({ id:qa[i].id || rupiah(amt), nama:qa[i].nama||'', login:qa[i].login||'', a:amt, b:null, diff:amt, status:'onlyA' }); cOnlyA++; }
      for(var i=matched;i<qb.length;i++){ rows.push({ id:qb[i].id || rupiah(amt), nama:qb[i].nama||'', login:qb[i].login||'', a:null, b:amt, diff:-amt, status:'onlyB' }); cOnlyB++; }
    });
    return { rows:rows, totals:{ totA:totA, totB:totB, cMatch:cMatch, cDiff:0, cOnlyA:cOnlyA, cOnlyB:cOnlyB } };
  }

  /* ---------- Core ---------- */
  function compare(){
    var A = parseData(inA.value), B = parseData(inB.value);
    if(A.items.length === 0 && B.items.length === 0){
      showWarn('Belum ada transaksi yang bisa dibaca. Format: Transaction Id | Nama Rekening | Login Id/Username | Nominal — mis. "TRX001 | Budi | budi88 | 150000". Nominal selalu di kolom terakhir.');
      $('results').hidden = true; $('empty').hidden = false; return;
    }
    var res = (mode === 'nominal') ? compareByNominal(A.items, B.items) : compareById(A.items, B.items);

    var rank = { diff:0, onlyA:1, onlyB:1, ok:2 };
    res.rows.sort(function(x,y){ if(rank[x.status]!==rank[y.status]) return rank[x.status]-rank[y.status];
      return Math.abs(y.diff)-Math.abs(x.diff); });

    lastRows = res.rows; lastTotals = res.totals;
    renderSummary(lastTotals); render();
    $('empty').hidden = true; $('results').hidden = false;

    var inv = A.invalid + B.invalid;
    if(inv>0) showWarn(inv + ' baris dilewati karena tidak ada nominal yang bisa dibaca. Cek kembali format barisnya.');
    else hideWarn();
  }

  function renderSummary(t){
    $('sumA').textContent = rupiah(t.totA);
    $('sumB').textContent = rupiah(t.totB);
    var diff = t.totA - t.totB;
    $('sumDiff').textContent = rupiah(diff);
    var issues = t.cDiff + t.cOnlyA + t.cOnlyB, total = t.cMatch + issues;
    var head = $('statHead'), balanced = nearlyEqual(diff,0) && issues===0;
    head.classList.toggle('balanced', balanced);
    head.querySelector('.k').textContent = balanced ? 'Seimbang' : 'Selisih (A − B)';
    $('mMatched').textContent = t.cMatch; $('mIssues').textContent = issues; $('mTotal').textContent = total;
    var pct = total ? (t.cMatch/total*100) : 0;
    requestAnimationFrame(function(){ $('meterFill').style.width = pct.toFixed(1)+'%'; });
  }

  var BADGE = { ok:['b-ok','Cocok'], diff:['b-diff','Selisih nominal'], onlyA:['b-onlya','Hanya di A'], onlyB:['b-onlyb','Hanya di B'] };

  function render(){
    var tbody = $('tbody'); tbody.innerHTML = ''; var shown = 0;
    for(var i=0;i<lastRows.length;i++){
      var r = lastRows[i];
      if(currentFilter==='issue' && r.status==='ok') continue;
      if(currentFilter==='ok' && r.status!=='ok') continue;
      shown++;
      var diffHtml;
      if(r.status==='ok'){ diffHtml = '<span class="diff-zero">—</span>'; }
      else {
        var cls = r.diff>0 ? 'diff-pos' : (r.diff<0 ? 'diff-neg' : 'diff-zero');
        var str = (r.diff>0?'+':'') + rupiah(r.diff).replace('−','-');
        diffHtml = '<span class="diff-chip '+cls+'">'+str+'</span>';
      }
      var badge = BADGE[r.status];
      var subBits = [r.nama, r.login].filter(Boolean).join(' · ');
      var sub = subBits ? '<span class="cell-sub">'+esc(subBits)+'</span>' : '';
      var tr = document.createElement('tr');
      tr.className = r.status==='ok' ? 'row-ok' : 'row-issue';
      tr.innerHTML =
        '<td class="cell-id" data-label="Transaction Id">'+esc(r.id)+sub+'</td>'+
        '<td data-label="Data Docs" class="num'+(r.a==null?' empty':'')+'">'+(r.a==null?'—':rupiah(r.a))+'</td>'+
        '<td data-label="Data Qris / Bo" class="num'+(r.b==null?' empty':'')+'">'+(r.b==null?'—':rupiah(r.b))+'</td>'+
        '<td data-label="Selisih">'+diffHtml+'</td>'+
        '<td data-label="Status"><span class="badge '+badge[0]+'">'+badge[1]+'</span></td>';
      tbody.appendChild(tr);
    }
    if(shown===0){
      var tr2 = document.createElement('tr');
      tr2.innerHTML = '<td colspan="5" style="text-align:center;color:var(--muted);padding:26px">Tidak ada transaksi pada filter ini.</td>';
      tbody.appendChild(tr2);
    }
    var t = lastTotals;
    $('footNote').textContent = (mode==='nominal')
      ? (t.cMatch+' cocok (nominal sama) · '+t.cOnlyA+' hanya di A · '+t.cOnlyB+' hanya di B')
      : (t.cMatch+' cocok · '+t.cDiff+' selisih nominal · '+t.cOnlyA+' hanya di A · '+t.cOnlyB+' hanya di B');
  }

  /* ---------- CSV ---------- */
  function toCsv(){
    var head = ['Transaction Id','Nama Rekening','Login Id/Username','Data Docs','Data Qris / Bo','Selisih (A-B)','Status'];
    var lines = [head.join(',')];
    var label = { ok:'Cocok', diff:'Selisih nominal', onlyA:'Hanya di A', onlyB:'Hanya di B' };
    lastRows.forEach(function(r){
      lines.push([ r.id, r.nama||'', r.login||'', r.a==null?'':r.a, r.b==null?'':r.b, r.status==='ok'?0:r.diff, label[r.status] ].map(csvCell).join(','));
    });
    return lines.join('\r\n');
  }
  function csvCell(v){ v=String(v); if(/[",\r\n]/.test(v)) v='"'+v.replace(/"/g,'""')+'"'; return v; }
  function downloadCsv(){
    if(!lastRows.length) return;
    var blob = new Blob(['\ufeff'+toCsv()], {type:'text/csv;charset=utf-8'});
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'selisih-transaksi.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 500);
  }

  /* ---------- Helpers ---------- */
  function esc(s){ return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function showWarn(m){ var w=$('warn'); w.textContent=m; w.hidden=false; }
  function hideWarn(){ $('warn').hidden = true; }
  function countLines(t){ return String(t).split(/\r?\n/).filter(function(l){return l.trim();}).length; }
  function updateCounts(){
    $('countA').innerHTML = '<b>'+countLines(inA.value)+'</b> baris';
    $('countB').innerHTML = '<b>'+countLines(inB.value)+'</b> baris';
  }
  function updateHint(){ $('hintLine').innerHTML = HINTS[mode]; }

  /* ---------- Impor Excel / CSV ---------- */
  function detectDelimiter(sample){
    var line = (sample.split(/\r?\n/).find(function(l){ return l.trim(); }) || '');
    var cand = [',',';','\t'], best = ',', bestN = -1;
    cand.forEach(function(d){ var n = line.split(d).length - 1; if(n > bestN){ bestN = n; best = d; } });
    return best;
  }
  function parseCSVText(text){
    var delim = detectDelimiter(text);
    var rows = [], row = [], cur = '', inQ = false;
    for(var i=0;i<text.length;i++){
      var c = text[i];
      if(inQ){
        if(c === '"'){ if(text[i+1] === '"'){ cur += '"'; i++; } else { inQ = false; } }
        else { cur += c; }
      } else {
        if(c === '"'){ inQ = true; }
        else if(c === delim){ row.push(cur); cur = ''; }
        else if(c === '\n'){ row.push(cur); rows.push(row); row = []; cur = ''; }
        else if(c === '\r'){ /* abaikan */ }
        else { cur += c; }
      }
    }
    if(cur.length || row.length){ row.push(cur); rows.push(row); }
    return rows;
  }
  // Ubah baris [id, nama, login, ..., nominal] -> teks "id | nama | login | nominal"
  function rowsToText(rows){
    // buang baris kosong
    rows = rows.filter(function(r){ return r && r.some(function(c){ return String(c).trim() !== ''; }); });
    if(!rows.length) return { text:'', count:0 };
    // deteksi & lewati baris header (nominal kolom terakhir bukan angka)
    var lastCell = function(r){ for(var j=r.length-1;j>=0;j--){ if(String(r[j]).trim()!=='') return r[j]; } return ''; };
    if(rows.length > 1 && isNaN(parseNominal(lastCell(rows[0]))) && !isNaN(parseNominal(lastCell(rows[1])))){ rows = rows.slice(1); }
    var lines = [];
    rows.forEach(function(r){
      var cells = r.map(function(c){ return String(c == null ? '' : c).trim(); });
      while(cells.length && cells[cells.length-1] === '') cells.pop();
      if(!cells.length) return;
      var out = (cells.length >= 4) ? [cells[0], cells[1], cells[2], cells[cells.length-1]] : cells;
      lines.push(out.join(' | '));
    });
    return { text: lines.join('\n'), count: lines.length };
  }
  function setImportNote(side, msg, isErr){
    var el = $('note' + side); if(!el) return;
    el.textContent = msg; el.classList.toggle('err', !!isErr);
  }
  function importFile(side, file){
    if(!file) return;
    var target = side === 'A' ? inA : inB;
    var name = file.name || 'file';
    var ext = (name.split('.').pop() || '').toLowerCase();
    var reader = new FileReader();

    function apply(rows){
      var res = rowsToText(rows);
      if(!res.count){ setImportNote(side, 'File kosong / tak terbaca', true); return; }
      target.value = res.text;
      updateCounts();
      setImportNote(side, '✓ ' + res.count + ' baris · ' + name, false);
      if(!$('results').hidden) compare();
    }

    reader.onerror = function(){ setImportNote(side, 'Gagal membaca file', true); };

    if(ext === 'xlsx' || ext === 'xls'){
      if(typeof XLSX === 'undefined'){
        setImportNote(side, 'Butuh koneksi untuk .xlsx — simpan sebagai CSV', true); return;
      }
      reader.onload = function(e){
        try{
          var wb = XLSX.read(new Uint8Array(e.target.result), { type:'array' });
          var ws = wb.Sheets[wb.SheetNames[0]];
          var rows = XLSX.utils.sheet_to_json(ws, { header:1, raw:true, defval:'' });
          apply(rows);
        }catch(err){ setImportNote(side, 'File Excel tidak valid', true); }
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = function(e){
        try{ apply(parseCSVText(String(e.target.result))); }
        catch(err){ setImportNote(side, 'CSV tidak valid', true); }
      };
      reader.readAsText(file, 'UTF-8');
    }
  }

  /* ---------- Events ---------- */
  $('btnCompare').addEventListener('click', compare);
  $('btnCsv').addEventListener('click', downloadCsv);
  inA.addEventListener('input', updateCounts);
  inB.addEventListener('input', updateCounts);

  document.querySelectorAll('[data-clear]').forEach(function(b){
    b.addEventListener('click', function(){ var s=b.getAttribute('data-clear'); if(s==='A') inA.value=''; else inB.value=''; setImportNote(s,''); updateCounts(); });
  });
  document.querySelectorAll('[data-import]').forEach(function(inp){
    inp.addEventListener('change', function(){
      var side = inp.getAttribute('data-import');
      if(inp.files && inp.files[0]) importFile(side, inp.files[0]);
      inp.value = '';   // izinkan impor file yang sama lagi
    });
  });
  document.querySelectorAll('.seg-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      document.querySelectorAll('.seg-btn').forEach(function(b){ b.setAttribute('aria-selected','false'); });
      btn.setAttribute('aria-selected','true');
      mode = btn.getAttribute('data-mode');
      updateHint();
      if(!$('results').hidden) compare();     // hitung ulang otomatis kalau hasil sedang tampil
    });
  });
  document.querySelectorAll('.tab').forEach(function(tab){
    tab.addEventListener('click', function(){
      document.querySelectorAll('.tab').forEach(function(t){ t.setAttribute('aria-selected','false'); });
      tab.setAttribute('aria-selected','true');
      currentFilter = tab.getAttribute('data-filter');
      if(lastRows.length) render();
    });
  });
  document.addEventListener('keydown', function(e){ if((e.ctrlKey||e.metaKey) && e.key==='Enter'){ e.preventDefault(); compare(); } });

  updateCounts(); updateHint();
})();
