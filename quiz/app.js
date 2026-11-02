(function () {
  'use strict';

  var HEROES = [
    { name: 'RECONCILER', concept: 'Control loop, desired vs actual' },
    { name: 'LIFEGIVER', concept: 'Pod lifecycle, conditions, events' },
    { name: 'RELAY', concept: 'Services, endpoints, kube-proxy' },
    { name: 'RESOLVER', concept: 'DNS, ndots, search path' },
    { name: 'HADES', concept: 'Ingress/ALB, readiness vs target health' },
    { name: 'IRONCLAD', concept: 'Requests, limits, QoS, OOM vs throttle' },
    { name: 'TRAPPER', concept: 'Taints, affinity, spread, PDB' },
    { name: 'CARPENTER', concept: 'HPA, KEDA, Karpenter, rollouts' },
    { name: 'BOUNCER', concept: 'RBAC, IRSA, Pod Security, secrets' },
    { name: 'BEATBOX', concept: 'Probes, shutdown, GitOps/Helm review' }
  ];
  // "3. HADES": the hero's place in HEROES, shown wherever heroes are listed.
  function heroLabel(name) {
    var i = HEROES.map(function (x) { return x.name; }).indexOf(name);
    return i < 0 ? name : (i + 1) + '. ' + name;
  }
  var LEVELS = [
    { n: 1, label: 'Easy' },
    { n: 2, label: 'Medium' },
    { n: 3, label: 'Hard' }
  ];
  var COUNTS = [5, 10, 20, 30, 50];
  var STORE_KEY = 'k8sHeroesQuiz.v1';

  var BANK = (window.QUIZ_QUESTIONS || []).slice();
  var counters = {};
  BANK.forEach(function (q) {
    var key = q.h + '-' + q.l;
    counters[key] = (counters[key] || 0) + 1;
    q.id = q.h.slice(0, 3).toLowerCase() + '-' + q.l + '-' + String(counters[key]).padStart(2, '0');
  });
  var BY_ID = {};
  BANK.forEach(function (q) { BY_ID[q.id] = q; });

  // ---------- storage (per browser; every access is guarded) ----------
  function loadStore() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.answers) {
          parsed.sessions = parsed.sessions || [];
          parsed.sessions.forEach(function (s, i) {
            if (!s.id) s.id = 'old-' + i;
          });
          return parsed;
        }
      }
    } catch (e) { /* storage blocked or corrupt: start clean */ }
    return { answers: {}, sessions: [] };
  }
  function saveStore() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) { /* storage blocked: progress lives only for this page view */ }
  }
  var store = loadStore();

  // ---------- tiny DOM helper ----------
  function h(tag, attrs, kids) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === false || v == null) return;
      if (k === 'class') node.className = v;
      else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : String(v));
    });
    if (kids == null) kids = [];
    if (!Array.isArray(kids)) kids = [kids];
    kids.forEach(function (c) {
      if (c == null || c === false) return;
      node.appendChild(typeof c === 'string' || typeof c === 'number'
        ? document.createTextNode(String(c))
        : c);
    });
    return node;
  }

  function shuffle(list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function levelLabel(n) {
    return LEVELS[n - 1].label;
  }

  // ---------- state ----------
  var state = {
    view: 'setup',
    setup: {
      mode: 'multi',
      heroes: HEROES.map(function (x) { return x.name; }),
      levels: [1, 2, 3],
      count: 10,
      weak: true
    },
    session: null,
    last: null
  };

  function poolFor(s) {
    return BANK.filter(function (q) {
      return s.heroes.indexOf(q.h) >= 0 && s.levels.indexOf(q.l) >= 0;
    });
  }

  function priority(q) {
    var a = store.answers[q.id];
    if (!a || !a.seen) return 1;      // never seen
    return a.lastWrong ? 0 : 2;       // missed last time first, then the rest
  }

  function startSession(list, meta) {
    var s = state.setup;
    var picked;
    if (list) {
      picked = list.slice();
    } else {
      var pool = shuffle(poolFor(s));
      if (s.weak) {
        pool = pool.map(function (q, i) { return { q: q, i: i }; })
          .sort(function (a, b) { return (priority(a.q) - priority(b.q)) || (a.i - b.i); })
          .map(function (x) { return x.q; });
      }
      var n = s.count > 0 ? Math.min(s.count, pool.length) : pool.length;
      picked = pool.slice(0, n);
    }
    if (!picked.length) return;
    state.session = {
      started: new Date().toISOString(),
      heroes: meta ? meta.heroes : s.heroes.slice(),
      levels: meta ? meta.levels : s.levels.slice(),
      items: picked.map(function (q) { return { q: q, opts: null, picked: null, ok: null }; }),
      i: 0
    };
    state.view = 'quiz';
    render();
  }

  function record(q, ok) {
    var a = store.answers[q.id] || { seen: 0, right: 0, wrong: 0, lastWrong: false };
    a.seen += 1;
    if (ok) a.right += 1; else a.wrong += 1;
    a.lastWrong = !ok;
    a.last = new Date().toISOString();
    store.answers[q.id] = a;
    saveStore();
  }

  function answer(idx) {
    var S = state.session;
    var item = S.items[S.i];
    if (item.picked !== null) return;
    item.picked = idx;
    item.ok = item.opts[idx].ok;
    record(item.q, item.ok);
    render();
  }

  function next() {
    var S = state.session;
    S.i += 1;
    if (S.i >= S.items.length) finish(false);
    else render();
  }

  function finish(ended) {
    var S = state.session;
    var summary = summarize(S);
    if (summary.total > 0) {
      store.sessions.unshift({
        id: String(Date.now()) + Math.random().toString(36).slice(2, 7),
        date: S.started,
        heroes: S.heroes,
        levels: S.levels,
        planned: summary.planned,
        total: summary.total,
        right: summary.right,
        ended: !!ended,
        byHero: summary.byHero,
        items: summary.items
      });
      store.sessions = store.sessions.slice(0, 300);
      saveStore();
    }
    state.last = summary;
    resultFilter = 'all';
    state.session = null;
    state.view = 'results';
    render();
  }

  function summarize(S) {
    var answered = S.items.filter(function (it) { return it.picked !== null; });
    var byHero = {};
    answered.forEach(function (it) {
      var k = it.q.h;
      byHero[k] = byHero[k] || { n: 0, r: 0 };
      byHero[k].n += 1;
      if (it.ok) byHero[k].r += 1;
    });
    var byLevel = {};
    answered.forEach(function (it) {
      var k = it.q.l;
      byLevel[k] = byLevel[k] || { n: 0, r: 0 };
      byLevel[k].n += 1;
      if (it.ok) byLevel[k].r += 1;
    });
    return {
      total: answered.length,
      planned: S.items.length,
      items: answered.map(function (it) { return { id: it.q.id, ok: it.ok }; }),
      right: answered.filter(function (it) { return it.ok; }).length,
      byHero: byHero,
      byLevel: byLevel,
      answers: answered.map(function (it) {
        return {
          q: it.q,
          chose: it.opts[it.picked].t,
          correct: it.opts.filter(function (o) { return o.ok; })[0].t,
          ok: it.ok
        };
      }),
      missed: answered.filter(function (it) { return !it.ok; }).map(function (it) {
        return { q: it.q, chose: it.opts[it.picked].t, correct: it.opts.filter(function (o) { return o.ok; })[0].t };
      })
    };
  }

  // ---------- views ----------
  function render() {
    var app = document.getElementById('app');
    app.innerHTML = '';
    app.classList.remove('lab-wide');
    document.querySelectorAll('.navbtn').forEach(function (b) {
      var active = ['progress', 'history', 'learn'].indexOf(state.view) >= 0 ? state.view : 'setup';
      b.classList.toggle('on', b.getAttribute('data-nav') === active);
    });
    if (state.view === 'learn' && window.HeroLab) {
      window.HeroLab.mount(app, function () { state.view = 'setup'; render(); });
      return;
    }
    if (state.view === 'quiz') app.appendChild(viewQuiz());
    else if (state.view === 'results') app.appendChild(viewResults());
    else if (state.view === 'progress') app.appendChild(viewProgress());
    else if (state.view === 'history') app.appendChild(viewHistory());
    else app.appendChild(viewSetup());
  }

  function segBtn(label, on, fn) {
    return h('button', { class: on ? 'on' : '', onclick: fn }, label);
  }

  function setMode(mode) {
    state.setup.mode = mode;
    if (mode === 'single' && state.setup.heroes.length > 1) {
      state.setup.heroes = state.setup.heroes.slice(0, 1);
    }
    render();
  }

  function toggleHero(name) {
    var s = state.setup;
    if (s.mode === 'single') {
      s.heroes = [name];
    } else {
      var i = s.heroes.indexOf(name);
      if (i >= 0) s.heroes.splice(i, 1); else s.heroes.push(name);
    }
    render();
  }

  function toggleLevel(n) {
    var s = state.setup;
    var i = s.levels.indexOf(n);
    if (i >= 0) s.levels.splice(i, 1); else s.levels.push(n);
    s.levels.sort();
    render();
  }

  function viewSetup() {
    var s = state.setup;
    var pool = poolFor(s);
    var n = s.count > 0 ? Math.min(s.count, pool.length) : pool.length;
    var countInput = h('input', {
      type: 'number', min: '1', max: String(BANK.length), value: String(s.count || ''),
      placeholder: 'All',
      oninput: function (e) {
        var v = parseInt(e.target.value, 10);
        s.count = v > 0 ? v : 0;
        refreshStart();
      }
    });

    var startBtn = h('button', { class: 'primary', disabled: n === 0, onclick: function () { startSession(); } },
      n === 0 ? 'Nothing selected' : 'Start test (' + n + ' questions)');
    var info = h('p', { class: 'small muted' }, 'Matching questions in the bank: ' + pool.length + ' of ' + BANK.length + '.');

    function refreshStart() {
      var p = poolFor(s);
      var m = s.count > 0 ? Math.min(s.count, p.length) : p.length;
      info.textContent = 'Matching questions in the bank: ' + p.length + ' of ' + BANK.length + '.';
      startBtn.textContent = m === 0 ? 'Nothing selected' : 'Start test (' + m + ' questions)';
      startBtn.disabled = m === 0;
    }

    var heroChips = h('div', { class: 'hero-list' }, HEROES.map(function (hero) {
      var on = s.heroes.indexOf(hero.name) >= 0;
      return h('button', {
        class: 'hero-card' + (on ? ' on' : ''),
        onclick: function () { toggleHero(hero.name); }
      }, [h('strong', {}, heroLabel(hero.name)), h('span', { class: 'theme' }, hero.concept)]);
    }));

    var heroTools = s.mode === 'multi'
      ? h('div', { class: 'row small' }, [
          h('button', { class: 'ghost', onclick: function () { s.heroes = HEROES.map(function (x) { return x.name; }); render(); } }, 'All ten'),
          h('button', { class: 'ghost', onclick: function () { s.heroes = []; render(); } }, 'None')
        ])
      : h('p', { class: 'small muted' }, 'Pick one hero from the list.');

    var levelChips = h('div', { class: 'chips' }, LEVELS.map(function (L) {
      var on = s.levels.indexOf(L.n) >= 0;
      return h('button', { class: 'chip' + (on ? ' on' : ''), onclick: function () { toggleLevel(L.n); } }, L.label);
    }));

    var countChips = h('div', { class: 'chips' }, COUNTS.map(function (c) {
      return h('button', {
        class: 'chip' + (s.count === c ? ' on' : ''),
        onclick: function () { s.count = c; render(); }
      }, String(c));
    }).concat([
      h('button', { class: 'chip' + (s.count === 0 ? ' on' : ''), onclick: function () { s.count = 0; render(); } }, 'All')
    ]));

    var weakBox = h('label', { class: 'check' }, [
      h('input', {
        type: 'checkbox',
        checked: s.weak,
        onchange: function (e) { s.weak = e.target.checked; }
      }),
      'Start with questions I missed last time, then ones I have not seen yet'
    ]);

    return h('section', { class: 'card' }, [
      h('h2', {}, 'Build a test'),
      h('div', { class: 'field' }, [
        h('span', { class: 'lbl' }, 'Heroes'),
        h('div', { class: 'seg' }, [
          segBtn('Single hero', s.mode === 'single', function () { setMode('single'); }),
          segBtn('Multi hero', s.mode === 'multi', function () { setMode('multi'); })
        ]),
        heroChips,
        heroTools
      ]),
      h('div', { class: 'field' }, [
        h('span', { class: 'lbl' }, 'Difficulty'),
        levelChips
      ]),
      h('div', { class: 'field' }, [
        h('span', { class: 'lbl' }, 'Number of questions'),
        countChips,
        h('div', { class: 'row small' }, [
          h('span', { class: 'muted' }, 'or type a number:'),
          countInput
        ])
      ]),
      h('div', { class: 'field' }, [weakBox]),
      info,
      h('div', { class: 'actions' }, [startBtn])
    ]);
  }

  function viewQuiz() {
    var S = state.session;
    var item = S.items[S.i];
    var q = item.q;
    if (!item.opts) {
      item.opts = shuffle(q.o.map(function (t, idx) { return { t: t, ok: idx === q.c }; }));
    }
    var answered = item.picked !== null;
    var pct = (S.i / S.items.length) * 100;

    var optionButtons = item.opts.map(function (o, idx) {
      var cls = 'opt';
      if (answered) {
        if (o.ok) cls += ' right';
        else if (item.picked === idx) cls += ' wrong';
      }
      return h('button', {
        class: cls,
        disabled: answered,
        onclick: function () { answer(idx); }
      }, [h('kbd', {}, String(idx + 1)), h('span', {}, o.t)]);
    });

    var feedback = answered
      ? h('div', { class: 'why ' + (item.ok ? 'ok' : 'bad') }, [
          h('strong', {}, item.ok ? 'Correct. ' : 'Not quite. '),
          q.w
        ])
      : null;

    var last = S.i + 1 >= S.items.length;
    return h('section', { class: 'card' }, [
      h('div', { class: 'quiz-top' }, [
        h('span', { class: 'pill hero' }, q.h),
        h('span', { class: 'pill l' + q.l }, levelLabel(q.l)),
        h('span', { class: 'count' }, (S.i + 1) + ' / ' + S.items.length)
      ]),
      h('div', { class: 'bar' }, [h('div', { class: 'fill', style: 'width:' + pct + '%' })]),
      h('h3', { class: 'q' }, q.q),
      h('div', { class: 'opts' }, optionButtons),
      feedback,
      h('div', { class: 'actions' }, [
        h('button', { class: 'ghost', onclick: function () { finish(true); } }, 'End test'),
        h('button', { class: 'primary', disabled: !answered, onclick: next },
          last ? 'See results (Enter)' : 'Next (Enter)')
      ]),
      h('p', { class: 'small muted' }, 'Keys: 1 to 4 answer, Enter goes on.')
    ]);
  }

  var resultFilter = 'all';

  function bandFor(pct) {
    if (pct >= 90) return 'Strong';
    if (pct >= 75) return 'Solid';
    if (pct >= 50) return 'Getting there';
    return 'Needs review';
  }

  function viewResults() {
    var R = state.last;
    if (!R) return viewSetup();
    var pct = R.total ? Math.round((R.right / R.total) * 100) : 0;
    var wrong = R.total - R.right;

    var heroRows = Object.keys(R.byHero).map(function (name) {
      var v = R.byHero[name];
      return h('tr', {}, [
        h('td', {}, heroLabel(name)),
        h('td', { class: 'num' }, v.r + ' / ' + v.n),
        h('td', { class: 'num' }, pctText(v.r, v.n))
      ]);
    });

    var weakHeroes = Object.keys(R.byHero)
      .map(function (name) {
        var v = R.byHero[name];
        var meta = HEROES.filter(function (x) { return x.name === name; })[0] || { concept: '' };
        return { name: name, concept: meta.concept, r: v.r, n: v.n, p: v.r / v.n };
      })
      .filter(function (x) { return x.p < 1; })
      .sort(function (a, b) { return (a.p - b.p) || ((b.n - b.r) - (a.n - a.r)); });

    var areas = weakHeroes.length
      ? h('ul', { class: 'areas' }, weakHeroes.map(function (x) {
          return h('li', {}, [
            h('strong', {}, heroLabel(x.name)), ' · ' + x.concept + ' — ',
            h('span', { class: 'bad-txt' }, (x.n - x.r) + ' wrong'), ' of ' + x.n
          ]);
        }))
      : h('p', { class: 'muted' }, 'No weak spots in this test. Every answer was right.');

    var levelRows = [1, 2, 3].filter(function (l) { return R.byLevel[l]; }).map(function (l) {
      var v = R.byLevel[l];
      return h('tr', {}, [
        h('td', {}, levelLabel(l)),
        h('td', { class: 'num' }, v.r + ' / ' + v.n),
        h('td', { class: 'num' }, pctText(v.r, v.n))
      ]);
    });

    var levelHint = null;
    var weakLevels = [1, 2, 3].filter(function (l) { return R.byLevel[l] && R.byLevel[l].r < R.byLevel[l].n; });
    if (weakLevels.length) {
      var worst = weakLevels.map(function (l) {
        return { l: l, p: R.byLevel[l].r / R.byLevel[l].n };
      }).sort(function (a, b) { return a.p - b.p; })[0];
      levelHint = h('p', { class: 'small muted', style: 'margin-top:10px' },
        'Weakest level: ' + levelLabel(worst.l) + ' (' + Math.round(worst.p * 100) + '%). Practice that level next.');
    }

    var shown = R.answers.filter(function (a) {
      return resultFilter === 'all' || (resultFilter === 'wrong' ? !a.ok : a.ok);
    });

    var answerCards = shown.map(function (a) {
      var q = a.q;
      return h('div', { class: 'ans ' + (a.ok ? 'ok' : 'bad') }, [
        h('div', { class: 'ans-top' }, [
          h('span', { class: 'mark ' + (a.ok ? 'good-txt' : 'bad-txt') }, a.ok ? '✓ Right' : '✗ Wrong'),
          h('span', { class: 'pill hero' }, q.h),
          h('span', { class: 'pill l' + q.l }, levelLabel(q.l))
        ]),
        h('p', { class: 'ans-q' }, q.q),
        a.ok ? null : h('div', { class: 'small' }, [h('span', { class: 'bad-txt' }, 'Your answer: '), a.chose]),
        h('div', { class: 'small' }, [h('span', { class: 'good-txt' }, 'Correct answer: '), a.correct]),
        h('div', { class: 'small muted ans-why' }, q.w)
      ]);
    });

    var filterSeg = h('div', { class: 'seg' }, [
      segBtn('All (' + R.total + ')', resultFilter === 'all', function () { resultFilter = 'all'; render(); }),
      segBtn('Wrong (' + wrong + ')', resultFilter === 'wrong', function () { resultFilter = 'wrong'; render(); }),
      segBtn('Right (' + R.right + ')', resultFilter === 'right', function () { resultFilter = 'right'; render(); })
    ]);

    var actions = [
      h('button', { class: 'primary', onclick: function () { state.view = 'setup'; render(); } }, 'New test'),
      h('button', { onclick: function () { state.view = 'history'; render(); } }, 'View history')
    ];
    if (R.missed.length) {
      actions.unshift(h('button', {
        onclick: function () {
          startSession(R.missed.map(function (m) { return m.q; }), {
            heroes: state.setup.heroes.slice(),
            levels: state.setup.levels.slice()
          });
        }
      }, 'Retry missed (' + R.missed.length + ')'));
    }

    return h('section', {}, [
      h('div', { class: 'card' }, [
        h('h2', {}, R.total === R.planned ? 'Test finished' : 'Test ended early'),
        h('div', { class: 'row' }, [
          h('div', {}, [h('div', { class: 'score' }, R.right + ' / ' + R.total), h('div', { class: 'muted' }, pct + '% correct')]),
          h('div', {}, [h('div', { class: 'band' }, bandFor(pct)), h('div', { class: 'muted small' }, 'rough band from your score')])
        ]),
        R.total < R.planned ? h('p', { class: 'notice' }, 'Only the ' + R.total + ' answered questions count.') : null,
        R.total === 0 ? h('p', { class: 'muted' }, 'No questions were answered.') : null
      ]),
      R.total ? h('div', { class: 'card' }, [
        h('h3', {}, 'Areas to improve'),
        areas,
        h('div', { class: 'row small', style: 'margin-top:8px' }, [
          h('div', { style: 'flex:1;min-width:220px' }, [
            h('table', {}, [
              h('thead', {}, h('tr', {}, [h('th', {}, 'Level'), h('th', { class: 'num' }, 'Right'), h('th', { class: 'num' }, 'Score')])),
              h('tbody', {}, levelRows)
            ]),
            levelHint
          ]),
          h('div', { style: 'flex:1;min-width:220px' }, [
            h('table', {}, [
              h('thead', {}, h('tr', {}, [h('th', {}, 'Hero'), h('th', { class: 'num' }, 'Right'), h('th', { class: 'num' }, 'Score')])),
              h('tbody', {}, heroRows)
            ])
          ])
        ])
      ]) : null,
      R.total ? h('div', { class: 'card' }, [
        h('div', { class: 'row between' }, [h('h3', {}, 'Your answers'), filterSeg]),
        shown.length ? answerCards : h('p', { class: 'muted' }, 'Nothing to show for this filter.')
      ]) : null,
      h('div', { class: 'actions' }, actions)
    ]);
  }

  function statsFor(list) {
    var seen = 0, attempts = 0, right = 0, missedNow = 0;
    list.forEach(function (q) {
      var a = store.answers[q.id];
      if (!a || !a.seen) return;
      seen += 1;
      attempts += a.seen;
      right += a.right;
      if (a.lastWrong) missedNow += 1;
    });
    return { bank: list.length, seen: seen, attempts: attempts, right: right, missedNow: missedNow };
  }

  function pctText(right, total) {
    return total ? Math.round((right / total) * 100) + '%' : '-';
  }

  function meterClass(right, total) {
    if (!total) return '';
    var p = right / total;
    return p >= 0.8 ? 'good' : p >= 0.6 ? 'mid' : 'low';
  }

  function viewProgress() {
    var all = statsFor(BANK);
    var overallPct = all.attempts ? (all.right / all.attempts) : 0;

    var heroRows = HEROES.map(function (hero) {
      var list = BANK.filter(function (q) { return q.h === hero.name; });
      var st = statsFor(list);
      var perLevel = LEVELS.map(function (L) {
        var ls = statsFor(list.filter(function (q) { return q.l === L.n; }));
        return ls.attempts ? pctText(ls.right, ls.attempts) : '-';
      });
      return h('tr', {}, [
        h('td', {}, [h('strong', {}, heroLabel(hero.name)), h('div', { class: 'small muted' }, hero.concept)]),
        h('td', { class: 'num' }, st.seen + ' / ' + st.bank),
        h('td', {}, h('div', { class: 'meter ' + meterClass(st.right, st.attempts) },
          h('div', { style: 'width:' + (st.attempts ? Math.round(st.right / st.attempts * 100) : 0) + '%' }))),
        h('td', { class: 'num' }, pctText(st.right, st.attempts)),
        h('td', { class: 'num' }, perLevel[0]),
        h('td', { class: 'num' }, perLevel[1]),
        h('td', { class: 'num' }, perLevel[2]),
        h('td', { class: 'num' }, String(st.missedNow))
      ]);
    });

    var sessionRows = store.sessions.slice(0, 20).map(function (s) {
      var d = new Date(s.date);
      return h('tr', {}, [
        h('td', {}, isNaN(d) ? '' : d.toLocaleString()),
        h('td', {}, s.heroes.length === 1 ? s.heroes[0] : s.heroes.length + ' heroes'),
        h('td', {}, s.levels.map(levelLabel).join(', ')),
        h('td', { class: 'num' }, s.right + ' / ' + s.total),
        h('td', { class: 'num' }, pctText(s.right, s.total) + (s.ended ? ' (ended)' : ''))
      ]);
    });

    return h('section', {}, [
      h('div', { class: 'card' }, [
        h('h2', {}, 'Your progress'),
        h('div', { class: 'row' }, [
          h('div', {}, [h('div', { class: 'score' }, String(all.seen)), h('div', { class: 'muted small' }, 'of ' + all.bank + ' questions seen')]),
          h('div', {}, [h('div', { class: 'score' }, pctText(all.right, all.attempts)), h('div', { class: 'muted small' }, 'accuracy over ' + all.attempts + ' answers')]),
          h('div', {}, [h('div', { class: 'score' }, String(all.missedNow)), h('div', { class: 'muted small' }, 'last answer was wrong')])
        ]),
        h('p', { class: 'small muted', style: 'margin-top:12px' },
          'Progress is saved in this browser only (localStorage). Clearing site data or using another browser starts from zero.')
      ]),
      h('div', { class: 'card' }, [
        h('h3', {}, 'By hero'),
        h('div', { style: 'overflow-x:auto' }, [
          h('table', {}, [
            h('thead', {}, h('tr', {}, [
              h('th', {}, 'Hero'),
              h('th', { class: 'num' }, 'Seen'),
              h('th', {}, ''),
              h('th', { class: 'num' }, 'Accuracy'),
              h('th', { class: 'num' }, 'Easy'),
              h('th', { class: 'num' }, 'Medium'),
              h('th', { class: 'num' }, 'Hard'),
              h('th', { class: 'num' }, 'Missed now')
            ])),
            h('tbody', {}, heroRows)
          ])
        ]),
        h('p', { class: 'small muted' }, 'Missed now = questions whose last answer was wrong. Start a test with the "missed" option to retry them.')
      ]),
      h('div', { class: 'card' }, [
        h('h3', {}, 'Recent tests'),
        sessionRows.length
          ? h('div', { style: 'overflow-x:auto' }, [
              h('table', {}, [
                h('thead', {}, h('tr', {}, [h('th', {}, 'Date'), h('th', {}, 'Heroes'), h('th', {}, 'Levels'), h('th', { class: 'num' }, 'Right'), h('th', { class: 'num' }, 'Score')])),
                h('tbody', {}, sessionRows)
              ])
            ])
          : h('p', { class: 'muted' }, 'No tests yet.'),
        h('div', { class: 'actions' }, [
          h('button', { class: 'danger', onclick: resetProgress }, 'Reset progress'),
          h('button', { class: 'primary', onclick: function () { state.view = 'setup'; render(); } }, 'Back to practice')
        ])
      ])
    ]);
  }

  var openSessionId = null;

  function statBlock(value, label) {
    return h('div', {}, [h('div', { class: 'score' }, String(value)), h('div', { class: 'muted small' }, label)]);
  }

  function viewHistory() {
    var list = store.sessions;
    var answered = 0, right = 0;
    list.forEach(function (s) { answered += s.total; right += s.right; });
    var header = h('div', { class: 'card' }, [
      h('h2', {}, 'Test history'),
      h('div', { class: 'row' }, [
        statBlock(list.length, 'tests taken'),
        statBlock(answered, 'questions answered'),
        statBlock(pctText(right, answered), 'overall accuracy')
      ]),
      h('p', { class: 'small muted', style: 'margin-top:12px' },
        'Tap a test to see each question and whether you got it right. Tests saved before this view existed show totals only.')
    ]);
    if (!list.length) {
      return h('section', {}, [header, h('div', { class: 'card muted' }, 'No tests yet. Run one from Practice.')]);
    }
    return h('section', {}, [header, h('div', { class: 'card' }, list.map(historyRow))]);
  }

  function historyRow(s) {
    var open = openSessionId === s.id;
    var d = new Date(s.date);
    var heroLabel = s.heroes.length === 1 ? s.heroes[0] : s.heroes.length + ' heroes';
    var head = h('button', {
      class: 'hist-head',
      onclick: function () { openSessionId = open ? null : s.id; render(); }
    }, [
      h('span', { class: 'hist-date' }, isNaN(d) ? 'Unknown date' : d.toLocaleString()),
      h('span', { class: 'hist-meta' }, heroLabel + ' · ' + s.levels.map(levelLabel).join(', ')),
      h('span', { class: 'hist-score' }, s.right + ' / ' + s.total + ' · ' + pctText(s.right, s.total) + (s.ended ? ' · ended early' : ''))
    ]);
    return h('div', { class: 'hist' + (open ? ' open' : '') }, [head, open ? historyDetail(s) : null]);
  }

  function historyDetail(s) {
    if (!s.items) return h('p', { class: 'small muted hist-body' }, 'Question details were not saved for this test.');
    var perHero = Object.keys(s.byHero || {}).map(function (name) {
      var v = s.byHero[name];
      return h('tr', {}, [
        h('td', {}, heroLabel(name)),
        h('td', { class: 'num' }, v.r + ' / ' + v.n),
        h('td', { class: 'num' }, pctText(v.r, v.n))
      ]);
    });
    var qs = s.items.map(function (it) {
      var q = BY_ID[it.id];
      if (!q) return null;
      return h('div', { class: 'hist-q ' + (it.ok ? 'ok' : 'bad') }, [
        h('span', { class: 'mark' }, it.ok ? '✓' : '✗'),
        h('div', {}, [
          h('div', {}, [h('span', { class: 'pill hero' }, q.h), ' ', h('span', { class: 'pill l' + q.l }, levelLabel(q.l))]),
          h('div', { class: 'hist-qtext' }, q.q)
        ])
      ]);
    });
    return h('div', { class: 'hist-body' }, [
      perHero.length ? h('table', {}, [
        h('thead', {}, h('tr', {}, [h('th', {}, 'Hero'), h('th', { class: 'num' }, 'Right'), h('th', { class: 'num' }, 'Score')])),
        h('tbody', {}, perHero)
      ]) : null,
      h('div', { class: 'hist-qs' }, qs)
    ]);
  }

  function resetProgress() {
    if (!window.confirm('Delete all saved answers and test history in this browser?')) return;
    store = { answers: {}, sessions: [] };
    saveStore();
    render();
  }

  // ---------- navigation and keys ----------
  document.querySelectorAll('.navbtn').forEach(function (b) {
    b.addEventListener('click', function () {
      state.view = b.getAttribute('data-nav');
      render();
    });
  });

  document.addEventListener('keydown', function (e) {
    if (state.view !== 'quiz' || !state.session) return;
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    var item = state.session.items[state.session.i];
    if (e.key >= '1' && e.key <= '4' && item.picked === null) {
      answer(parseInt(e.key, 10) - 1);
    } else if (e.key === 'Enter' && item.picked !== null) {
      next();
    }
  });

  if (!BANK.length) {
    document.getElementById('app').appendChild(h('p', { class: 'card' }, 'No questions loaded. Check that the data/ scripts are next to index.html.'));
  } else {
    render();
  }
})();
