// Learn section: story chapters played in a fake terminal.
// app.js mounts it in the Learn tab through window.HeroLab.mount(root, onExit).
// The terminal logic lives in lab/engine.js. Chapters live in lab/story-*.js.
// Tasks live in lab/backlog/*.js. Progress is stored in this browser only.
//
// Text markup used in story, concept, goals and hints:
//   **bold accent**   a point that needs attention
//   `code`            a command, path or field name (task goals and hints hide it as a spoiler until clicked)
(function () {
  'use strict';

  var E = window.LabEngine;
  var KEY = 'k8sHeroesLab.v1';
  var START = 'START';   // the Get started section: not a hero, shown above the list
  var BANNER = [
    'Lab shell. Type help for commands.',
    'Every command you type advances the cluster clock by one minute.'
  ];

  var S = {
    root: null,
    onExit: null,
    screen: 'menu',   // menu | chapters | play
    hero: null,
    chapter: null,
    sess: null,
    idx: 0,           // index of the current task in the chapter
    from: 0,          // history index where the current task started
    hints: {},        // task id -> hints revealed
    revealed: {},     // spoiler key -> true when the command is shown
    term: [],         // terminal lines: { t, c } with c = cmd | out | err | ok | note
    hist: [],
    histPos: 0,
    flash: null       // 'task' or 'chapter': plays one completion animation on the next render
  };

  // ---------- helpers ----------
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
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return node;
  }

  // A command hidden as a spoiler: shows dashes until it is clicked (or Enter is pressed).
  function spoiler(text, key) {
    var open = !!S.revealed[key];
    var dashes = new Array(Math.max(6, Math.min(text.length, 24)) + 1).join('-');
    function toggle() {
      S.revealed[key] = !open;
      render();
    }
    return h('span', {
      class: 'spoiler' + (open ? ' open' : ''),
      role: 'button',
      tabindex: '0',
      title: open ? '' : 'Click to show the command',
      onclick: toggle,
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }
    }, [open ? h('code', {}, [text]) : dashes]);
  }

  // Turns **attention** and `code` markup into styled nodes. Plain text stays plain.
  // With a spoiler context ({ key }), every `code` part becomes a clickable spoiler.
  function rich(text, spoilerCtx) {
    var nodes = [], n = 0;
    String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/).forEach(function (part) {
      if (!part) return;
      if (part.indexOf('**') === 0 && part.length > 4) nodes.push(h('strong', { class: 'attn' }, [part.slice(2, -2)]));
      else if (part.charAt(0) === '`' && part.length > 2) {
        if (spoilerCtx) nodes.push(spoiler(part.slice(1, -1), spoilerCtx.key + ':' + (n++)));
        else nodes.push(h('code', {}, [part.slice(1, -1)]));
      }
      else nodes.push(part);
    });
    return nodes;
  }

  function loadProgress() {
    try {
      var raw = window.localStorage.getItem(KEY);
      var p = raw ? JSON.parse(raw) : {};
      return { chapters: p.chapters || {}, tasks: p.tasks || {} };
    } catch (e) { return { chapters: {}, tasks: {} }; }
  }

  function saveProgress(p) {
    try { window.localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* storage blocked: progress lasts this page view */ }
  }

  var PROGRESS = loadProgress();

  function backlog() { return window.LAB_BACKLOG || []; }
  function chapters() { return window.LAB_CHAPTERS || []; }

  function taskById(id) {
    return backlog().filter(function (t) { return t.id === id; })[0] || null;
  }

  // The ten heroes, in order. START is not a hero.
  function heroNames() {
    var names = [];
    backlog().forEach(function (t) {
      if (t.h !== START && names.indexOf(t.h) < 0) names.push(t.h);
    });
    return names;
  }

  // "Get started" or "3. HADES": the number is the hero's place in the list (1 to 10).
  function heroTitle(name) {
    if (name === START) return 'Get started';
    var i = heroNames().indexOf(name);
    return i < 0 ? name : (i + 1) + '. ' + name;
  }

  // Task numbers: chapter.task, for example 1.1 and 1.2. Get started is section 0.
  function taskNumber(ch, i) {
    return (ch.h === START ? 0 : ch.n) + '.' + (i + 1);
  }

  function chaptersOf(hero) {
    return chapters().filter(function (c) { return c.h === hero; }).sort(function (a, b) { return a.n - b.n; });
  }

  function chapterDone(ch) { return !!(PROGRESS.chapters[ch.id] && PROGRESS.chapters[ch.id].done); }

  function chapterOpen(list, i) {
    return i === 0 || chapterDone(list[i - 1]);
  }

  // ---------- progress percentages ----------
  // A task counts once it is completed, even if its chapter is replayed later.
  function countTasks(list) {
    var total = 0, done = 0;
    list.forEach(function (ch) {
      total += ch.tasks.length;
      ch.tasks.forEach(function (id) { if (PROGRESS.tasks[id]) done += 1; });
    });
    return { total: total, done: done };
  }

  function pctOf(c) { return c.total ? Math.round((c.done / c.total) * 100) : 0; }

  function chapterPct(ch) {
    return chapterDone(ch) ? 100 : pctOf(countTasks([ch]));
  }

  function barEl(pct) {
    return h('div', { class: 'bar lab-bar', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' }, [
      h('div', { class: 'fill', style: 'width:' + pct + '%' })
    ]);
  }

  function lines(text) {
    var a = String(text || '').split('\n');
    if (a.length && a[a.length - 1] === '') a.pop();
    return a;
  }

  function promptText() {
    return 'learner@lab:' + S.sess.cwd + '$ ';
  }

  // Status line for a section: percent, then chapters done, or how many backlog tasks wait.
  function sectionStatus(name) {
    var list = chaptersOf(name);
    if (list.length) {
      var c = countTasks(list);
      var done = list.filter(chapterDone).length;
      return pctOf(c) + '% · ' + done + ' of ' + list.length + ' chapters done';
    }
    var tasks = backlog().filter(function (t) { return t.h === name; });
    return 'Not built yet. ' + tasks.length + ' tasks in the backlog.';
  }

  // ---------- mount and render ----------
  function mount(root, onExit) {
    S.root = root;
    S.onExit = onExit || null;
    S.screen = 'menu';
    render();
  }

  function render() {
    var root = S.root, flash = S.flash;
    S.flash = null;
    root.classList.toggle('lab-wide', S.screen === 'play');
    while (root.firstChild) root.removeChild(root.firstChild);
    if (S.screen === 'play') root.appendChild(playView(flash));
    else if (S.screen === 'chapters') root.appendChild(chaptersView());
    else root.appendChild(menuView());
    if (S.screen === 'play') focusTerminal();
  }

  function openSection(name) {
    S.hero = name;
    S.screen = 'chapters';
    render();
  }

  function menuView() {
    var all = countTasks(chapters());
    var overall = h('div', { class: 'card lab-overall' }, [
      h('div', { class: 'row between' }, [
        h('strong', {}, ['Your learning path']),
        h('span', { class: 'pct' }, [pctOf(all) + '%'])
      ]),
      barEl(pctOf(all)),
      h('p', { class: 'muted small' }, [all.done + ' of ' + all.total + ' tasks done across all chapters'])
    ]);
    var startDone = chaptersOf(START).length && chaptersOf(START).every(chapterDone);
    var start = h('button', { class: 'start-card' + (startDone ? ' done' : ''), onclick: function () { openSection(START); } }, [
      h('span', { class: 'start-badge' }, [startDone ? '✓ Done' : 'Start here']),
      h('strong', {}, ['Get started']),
      h('span', { class: 'theme' }, [sectionStatus(START) + '. Learn the terminal before the first page.'])
    ]);
    var rows = heroNames().map(function (name, i) {
      var list = chaptersOf(name);
      var built = list.length > 0;
      var done = built && list.every(chapterDone);
      return h('button', {
        class: 'hero-row' + (built ? '' : ' muted-card') + (done ? ' done' : ''),
        onclick: function () { openSection(name); }
      }, [
        h('span', { class: 'hero-no' }, [String(i + 1)]),
        h('span', { class: 'hero-txt' }, [
          h('strong', {}, [name]),
          h('span', { class: 'theme' }, [sectionStatus(name)])
        ])
      ]);
    });
    return h('div', { class: 'lab' }, [
      h('div', { class: 'card' }, [
        h('h2', {}, ['Learn']),
        h('p', {}, ['Each hero is a story in chapters. You fix a real (simulated) cluster from a terminal. Type commands, read the output, and finish each chapter in order.']),
        h('p', { class: 'muted small' }, ['The terminal is a sandbox. It runs the commands it knows, in the shop namespace. Anything else says so.']),
        S.onExit ? h('div', { class: 'row' }, [h('button', { class: 'ghost', onclick: function () { S.onExit(); } }, ['← Back to practice'])]) : null
      ]),
      overall,
      start,
      h('div', { class: 'hero-list' }, rows)
    ]);
  }

  function chaptersView() {
    var list = chaptersOf(S.hero);
    var tasks = backlog().filter(function (t) { return t.h === S.hero; });
    var head = h('div', { class: 'row between lab-top' }, [
      h('button', { class: 'ghost', onclick: function () { S.screen = 'menu'; render(); } }, ['← Learn']),
      h('strong', {}, [heroTitle(S.hero)])
    ]);
    if (!list.length) {
      return h('div', { class: 'lab' }, [
        head,
        h('div', { class: 'card' }, [
          h('p', {}, ['This hero is not built yet. These are the terminal tasks planned for it:']),
          h('ol', { class: 'backlog' }, tasks.map(function (t) {
            return h('li', {}, [h('span', { class: 'pill l' + t.l }, ['L' + t.l]), ' ch' + t.ch + ' · ' + t.title]);
          }))
        ])
      ]);
    }
    var sec = countTasks(list);
    var summary = h('div', { class: 'card' }, [
      h('div', { class: 'row between' }, [
        h('strong', {}, ['Progress in ' + heroTitle(S.hero)]),
        h('span', { class: 'pct' }, [pctOf(sec) + '%'])
      ]),
      barEl(pctOf(sec)),
      h('p', { class: 'muted small' }, [sec.done + ' of ' + sec.total + ' tasks done'])
    ]);
    var cards = list.map(function (ch, i) {
      var open = chapterOpen(list, i), done = chapterDone(ch);
      var pct = chapterPct(ch);
      var cnt = countTasks([ch]);
      var state = done ? '✓ Done' : open ? pct + '%' : 'Locked';
      return h('div', { class: 'card chapter-card' + (done ? ' done' : '') }, [
        h('div', { class: 'row between' }, [
          h('strong', {}, ['Chapter ' + ch.n + ' · ' + ch.title]),
          h('span', { class: 'pill ' + (done ? 'ok-pill' : open ? 'hero' : '') }, [state])
        ]),
        h('p', { class: 'muted small' }, [ch.skill]),
        barEl(pct),
        h('p', { class: 'muted small' }, [
          done ? 'All ' + cnt.total + ' tasks done' : cnt.done + ' of ' + cnt.total + ' tasks done' + (open ? '' : '. Finish the previous chapter to unlock this one.')
        ]),
        h('div', { class: 'row' }, [
          h('button', {
            class: open ? 'primary' : '',
            disabled: !open,
            onclick: function () { startChapter(ch); }
          }, [done ? 'Replay chapter' : cnt.done ? 'Continue chapter' : 'Start chapter'])
        ])
      ]);
    });
    return h('div', { class: 'lab' }, [head, summary].concat(cards));
  }

  function playView(flash) {
    return h('div', { class: 'lab-grid' }, [storyPanel(flash), terminalPanel()]);
  }

  function storyPanel(flash) {
    var ch = S.chapter, tasks = ch.tasks.map(taskById);
    var pct = chapterPct(ch);
    var kids = [
      h('div', { class: 'row between lab-top' }, [
        h('button', { class: 'ghost', onclick: function () { leaveChapter(); } }, ['← Chapters']),
        h('span', { class: 'muted small' }, [heroTitle(S.hero) + ' · chapter ' + ch.n + ' of ' + chaptersOf(S.hero).length])
      ]),
      h('h2', { class: 'lab-title' }, [ch.title]),
      h('div', { class: 'row between chapter-pct' }, [
        h('span', { class: 'muted small' }, [countTasks([ch]).done + ' of ' + ch.tasks.length + ' tasks done']),
        h('span', { class: 'pct' }, [pct + '%'])
      ]),
      barEl(pct),
      h('p', { class: 'muted small' }, [ch.skill])
    ];
    ch.intro.forEach(function (p) { kids.push(h('p', { class: 'story' }, rich(p))); });
    kids.push(h('div', { class: 'concept' }, [
      h('span', { class: 'concept-label' }, ['Core idea']),
      h('div', {}, rich(ch.concept))
    ]));
    kids.push(h('ol', { class: 'tasks' }, tasks.map(function (t, i) { return taskItem(t, i, flash); })));
    if (S.idx >= tasks.length) kids.push(outroBox(flash === 'chapter'));
    return h('div', { class: 'lab-story card' }, kids);
  }

  function taskItem(t, i, flash) {
    var state = i < S.idx ? 'done' : i === S.idx ? 'current' : 'next';
    var shown = S.hints[t.id] || 0;
    var justDone = flash === 'task' && i === S.idx - 1;
    var num = taskNumber(S.chapter, i);
    var kids = [h('div', { class: 'row between' }, [
      h('strong', {}, [h('span', { class: 'tnum' }, [num]), ' ' + (state === 'done' ? '✓ ' : '') + t.title]),
      h('span', { class: 'pill l' + t.l }, ['L' + t.l])
    ])];
    if (state === 'current') {
      kids.push(h('p', { class: 'goal' }, rich(t.q, { key: t.id + ':goal' })));
      if (t.hints.length) {
        var hintLines = t.hints.slice(0, shown).map(function (x, n) {
          return h('div', { class: 'hint' }, ['Hint ' + (n + 1) + ': '].concat(rich(x, { key: t.id + ':hint' + n })));
        });
        kids = kids.concat(hintLines);
        if (shown < t.hints.length) {
          kids.push(h('button', {
            class: 'ghost small-btn',
            onclick: function () { S.hints[t.id] = shown + 1; render(); }
          }, ['Show hint ' + (shown + 1) + ' of ' + t.hints.length]));
        }
      }
    }
    return h('li', { class: 'task task-' + state + (justDone ? ' task-flash' : '') }, kids);
  }

  function outroBox(celebrate) {
    var ch = S.chapter, all = chaptersOf(S.hero), idx = all.indexOf(ch);
    var next = all[idx + 1];
    var nav;
    if (next) {
      nav = h('button', { class: 'primary', onclick: function () { startChapter(next); } }, ['Next: chapter ' + next.n + ' · ' + next.title]);
    } else if (S.hero === START) {
      nav = h('button', { class: 'primary', onclick: function () { S.screen = 'menu'; render(); } }, ['Choose a hero']);
    } else {
      nav = h('span', { class: 'pill ok-pill' }, ['The end of ' + heroTitle(S.hero) + ' (for now)']);
    }
    var burst = null;
    if (celebrate) {
      var dots = [];
      for (var i = 0; i < 12; i++) {
        var a = (i / 12) * Math.PI * 2;
        var dx = Math.round(Math.cos(a) * 70), dy = Math.round(Math.sin(a) * 50);
        dots.push(h('span', { style: 'left:50%;top:40px;--dx:' + dx + 'px;--dy:' + dy + 'px;background:' + (i % 3 === 0 ? 'var(--ok)' : i % 3 === 1 ? 'var(--accent)' : 'var(--warn)') }));
      }
      burst = h('div', { class: 'burst', 'aria-hidden': 'true' }, dots);
    }
    return h('div', { class: 'outro' + (celebrate ? ' celebrate' : '') }, [
      burst,
      h('div', { class: 'badge' }, ['✓']),
      h('h3', {}, ['Chapter complete']),
      h('div', {}, ch.outro.map(function (p) { return h('p', { class: 'story' }, rich(p)); })),
      h('h4', {}, ['What you learned']),
      h('ul', {}, ch.learned.map(function (x) { return h('li', {}, rich(x)); })),
      h('div', { class: 'row' }, [nav, h('button', { class: 'ghost', onclick: function () { leaveChapter(); } }, ['Back to chapters'])])
    ]);
  }

  function terminalPanel() {
    var out = h('div', { class: 'term-out' }, S.term.map(function (line) {
      if (line.c === 'out') return h('div', { class: 'tl out' }, nameLinks(line.t));
      return h('div', { class: 'tl ' + line.c }, [line.t === '' ? ' ' : line.t]);
    }));
    var input = h('input', {
      class: 'term-in',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      'aria-label': 'terminal input',
      onkeydown: onKey
    });
    var bar = h('div', { class: 'term-bar' }, [
      h('span', {}, ['shop · sandbox · click a name in the output to add it to the command']),
      h('span', { class: 'row' }, [
        h('button', { class: 'ghost small-btn', onclick: function () { startChapter(S.chapter); } }, ['Restart chapter'])
      ])
    ]);
    var line = h('div', { class: 'term-line' }, [h('span', { class: 'prompt' }, [promptText()]), input]);
    // A click focuses the input only when no text is selected, so the output can be highlighted and copied.
    return h('div', { class: 'term', onclick: function (e) {
      if (hasSelection()) return;
      if (e && e.target && e.target.classList && e.target.classList.contains('pick')) return;
      input.focus();
    } }, [bar, out, line]);
  }

  // ---------- terminal output: selectable text and clickable names ----------
  function hasSelection() {
    var sel = window.getSelection ? window.getSelection() : null;
    return !!(sel && String(sel).length);
  }

  // Names of objects in the cluster (pods, deployments, services...), longest first so web-7f9c-k4x9q wins over web.
  function clusterNames() {
    var objs = S.sess && S.sess.cluster ? S.sess.cluster.objects : [];
    var names = [];
    objs.forEach(function (o) { if (o.metadata && names.indexOf(o.metadata.name) < 0) names.push(o.metadata.name); });
    return names.sort(function (a, b) { return b.length - a.length; });
  }

  // Output text with each cluster name wrapped in a clickable span. A click puts the name into the command line.
  function nameLinks(text) {
    var names = clusterNames();
    if (!names.length || !text) return [text || ' '];
    var escaped = names.map(function (n) { return n.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&'); });
    var re = new RegExp('(' + escaped.join('|') + ')', 'g');
    return String(text).split(re).map(function (part, i) {
      if (!part) return null;
      if (names.indexOf(part) < 0) return part;
      return h('span', {
        class: 'pick',
        title: 'Click to add ' + part + ' to the command line',
        onclick: function (e) {
          if (hasSelection()) return;
          e.stopPropagation();
          var input = S.root.querySelector('.term-in');
          if (!input) return;
          input.value = input.value && !/\s$/.test(input.value) ? input.value + ' ' + part : input.value + part;
          input.focus();
        }
      }, [part]);
    }).filter(function (x) { return x !== null; });
  }

  // ---------- terminal behavior ----------
  function focusTerminal() {
    var input = S.root.querySelector('.term-in');
    var out = S.root.querySelector('.term-out');
    if (out) out.scrollTop = out.scrollHeight;
    if (input) input.focus();
  }

  function onKey(e) {
    var input = e.target;
    if (e.key === 'Enter') {
      e.preventDefault();
      var text = input.value;
      input.value = '';
      submit(text);
    } else if (e.key === 'ArrowUp') {
      if (!S.hist.length) return;
      e.preventDefault();
      S.histPos = Math.max(0, S.histPos - 1);
      input.value = S.hist[S.histPos];
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      S.histPos = Math.min(S.hist.length, S.histPos + 1);
      input.value = S.hist[S.histPos] || '';
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      S.term = [];
      render();
    }
  }

  function submit(text) {
    if (!S.sess) return;
    S.term.push({ t: promptText() + text, c: 'cmd' });
    var trimmed = text.trim();
    if (trimmed) {
      if (S.hist[S.hist.length - 1] !== trimmed) S.hist.push(trimmed);
    }
    S.histPos = S.hist.length;
    var r = E.run(S.sess, text);
    if (r.clear) {
      S.term = [];
    } else {
      lines(r.out).forEach(function (t) { S.term.push({ t: t, c: 'out' }); });
      lines(r.err).forEach(function (t) { S.term.push({ t: t, c: 'err' }); });
    }
    advance();
    render();
  }

  // Completes at most one task per command, so the story stays in order.
  function advance() {
    var ch = S.chapter;
    if (!ch || S.idx >= ch.tasks.length) return;
    var t = taskById(ch.tasks[S.idx]);
    if (!t || !E.check(S.sess, t.checks, S.from)) return;
    PROGRESS.tasks[t.id] = true;
    S.term.push({ t: '✓ Task ' + taskNumber(ch, S.idx) + ' complete: ' + t.title, c: 'ok' });
    S.idx += 1;
    S.from = S.sess.history.length;
    S.flash = 'task';
    if (S.idx >= ch.tasks.length) {
      PROGRESS.chapters[ch.id] = { done: true, at: new Date().toISOString() };
      S.term.push({ t: '✓ ' + (ch.h === START ? 'Get started' : 'Chapter ' + ch.n) + ' complete.', c: 'ok' });
      S.flash = 'chapter';
    }
    saveProgress(PROGRESS);
  }

  function startChapter(ch) {
    if (!ch.start) return;
    S.chapter = ch;
    S.sess = E.createSession(ch.start());
    S.idx = 0;
    S.from = 0;
    S.hints = {};
    S.term = BANNER.map(function (t) { return { t: t, c: 'note' }; });
    S.hist = [];
    S.histPos = 0;
    S.flash = null;
    S.screen = 'play';
    render();
  }

  function leaveChapter() {
    S.sess = null;
    S.chapter = null;
    S.screen = 'chapters';
    render();
  }

  window.HeroLab = { mount: mount };
})();
