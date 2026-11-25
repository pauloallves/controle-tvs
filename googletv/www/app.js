(function () {
  var Cap = window.Capacitor;
  var Atv = Cap && Cap.registerPlugin ? Cap.registerPlugin('AtvRemote') : null;
  var $ = function (id) { return document.getElementById(id); };
  var logLines = [];
  var ready = false;
  var ip = '';

  function ls(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k) || '';
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) {}
    return '';
  }
  function log(s) {
    var t = new Date().toTimeString().slice(0, 8);
    logLines.push(t + ' ' + s);
    logLines = logLines.slice(-60);
    $('log').textContent = logLines.join('\n');
  }
  function msg(s) { $('msg').textContent = s || ''; }
  function setStatus(txt, cls) {
    $('status').textContent = txt;
    $('dot').className = cls || '';
  }
  function show(remote) {
    $('setup').hidden = remote;
    $('remote').hidden = !remote;
  }
  function need() {
    if (!Atv) { msg('Este app só funciona instalado no Android.'); return false; }
    return true;
  }
  function validIp(v) { return /^(\d{1,3}\.){3}\d{1,3}$/.test(v); }

  if (Atv) {
    Atv.addListener('atv', function (ev) {
      if (ev.type === 'log') log(ev.data);
      if (ev.type === 'state') {
        log('estado: ' + ev.data);
        if (ev.data === 'ready') { ready = true; setStatus('Conectado', 'on'); }
        else if (ev.data === 'closed') { ready = false; setStatus('Desconectado (toque ⋯ › Reconectar)', 'err'); }
        else setStatus(ev.data);
      }
    });
  }

  function connect() {
    if (!need()) return;
    ready = false;
    setStatus('Conectando...');
    show(true);
    Atv.connect({ ip: ip }).then(function () { log('conexão aberta'); })
      .catch(function (e) { setStatus('Falha: ' + (e.message || e), 'err'); log('erro: ' + (e.message || e)); });
  }

  function startPair(addr) {
    ip = addr; $('ip').value = addr; $('found').innerHTML = '';
    msg('TV encontrada. Pedindo o código...');
    Atv.pairStart({ ip: ip }).then(function () {
      msg('Olhe a TV: digite aqui o código que apareceu na tela.');
      $('codebox').hidden = false; $('code').focus();
    }).catch(function (e) { msg('Erro: ' + (e.message || e)); log('pairStart: ' + (e.message || e)); });
  }
  function scan() {
    if (!need()) return;
    msg('Procurando sua TV...'); $('found').innerHTML = ''; $('codebox').hidden = true;
    Atv.scan().then(function (r) {
      var h = (r && r.hosts) || [];
      log('encontrados: ' + (h.join(', ') || 'nenhum'));
      if (h.length === 1) { startPair(h[0]); return; }
      if (!h.length) { msg('Não achei a TV. Confira se está ligada e no mesmo Wi-Fi, ou digite o IP abaixo.'); return; }
      msg('Achei mais de uma. Toque na sua TV:');
      h.forEach(function (x, i) {
        var li = document.createElement('li'); li.textContent = 'TV ' + (i + 1) + ' (' + x + ')';
        li.onclick = function () { startPair(x); };
        $('found').appendChild(li);
      });
    }).catch(function (e) { msg('Erro: ' + (e.message || e)); });
  }
  $('scan').onclick = scan;

  $('pair').onclick = function () {
    if (!need()) return;
    var v = $('ip').value.trim();
    if (!validIp(v)) { msg('Digite um IP válido, como 192.168.0.20'); return; }
    startPair(v);
  };

  $('confirm').onclick = function () {
    var c = $('code').value.trim().toUpperCase();
    if (c.length !== 6) { msg('O código tem 6 caracteres.'); return; }
    msg('Verificando...');
    Atv.pairFinish({ code: c }).then(function () {
      ls('atv_ip', ip); ls('atv_paired', '1');
      msg(''); $('codebox').hidden = true;
      connect();
    }).catch(function (e) { msg('Código recusado: ' + (e.message || e)); log('pairFinish: ' + (e.message || e)); });
  };

  $('skip').onclick = function () {
    ip = $('ip').value.trim();
    if (!validIp(ip)) { msg('Digite o IP da TV.'); return; }
    ls('atv_ip', ip); connect();
  };

  // teclas (segurar repete em setas/volume/canal)
  var rep = null;
  function send(code) {
    if (!Atv) return;
    Atv.key({ code: code, direction: 3 }).catch(function (e) {
      log('tecla ' + code + ': ' + (e.message || e));
      if (!ready) setStatus('Sem conexão', 'err');
    });
  }
  function stopRep() { if (rep) { clearInterval(rep); rep = null; } }
  document.querySelectorAll('[data-k]').forEach(function (b) {
    var code = parseInt(b.getAttribute('data-k'), 10);
    var repeat = b.hasAttribute('data-rep');
    b.addEventListener('pointerdown', function () {
      send(code);
      if (navigator.vibrate) navigator.vibrate(8);
      if (repeat) { stopRep(); var t = setTimeout(function () { rep = setInterval(function () { send(code); }, 120); }, 400); b._t = t; }
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
      b.addEventListener(ev, function () { clearTimeout(b._t); stopRep(); });
    });
  });
  document.querySelectorAll('[data-url]').forEach(function (b) {
    b.onclick = function () {
      var u = b.getAttribute('data-url');
      log('abrir ' + u);
      Atv.launch({ url: u }).catch(function (e) { log('abrir: ' + (e.message || e)); });
    };
  });

  $('menu').onclick = function () { $('drawer').hidden = false; };
  $('close').onclick = function () { $('drawer').hidden = true; };
  $('reconnect').onclick = function () { $('drawer').hidden = true; connect(); };
  $('forget').onclick = function () {
    if (!Atv) return;
    Atv.forget().then(function () {
      ls('atv_paired', null); $('drawer').hidden = true; show(false); msg('Pareamento apagado. Pareie de novo.');
    });
  };
  $('openurl').onclick = function () {
    var u = $('url').value.trim();
    if (!/^https?:\/\//.test(u)) { log('link inválido'); return; }
    Atv.launch({ url: u }).catch(function (e) { log('abrir: ' + (e.message || e)); });
  };

  // início
  ip = ls('atv_ip');
  if (ip) $('ip').value = ip;
  if (ls('atv_paired') && validIp(ip)) connect();
  else scan();
})();
