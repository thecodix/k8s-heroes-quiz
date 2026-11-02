// Lab engine: a fake terminal over a virtual filesystem and a simulated cluster.
// Plain JavaScript, no DOM, no network, so it can be tested outside the browser.
// Exposes window.LabEngine. Every command returns { out, err, code, clear }.
//
// Clock rule: every command line advances the cluster clock by one tick (one minute
// of cluster time). Controllers run once per tick: the Deployment controller keeps a
// ReplicaSet at the desired count, the ReplicaSet controller creates or removes one
// pod per tick, and pods go Pending -> Running -> Ready one step per tick.
(function () {
  'use strict';

  var HOME = '/home/learner';
  var KIND = {
    pod: 'Pod', pods: 'Pod', po: 'Pod',
    deployment: 'Deployment', deployments: 'Deployment', deploy: 'Deployment',
    replicaset: 'ReplicaSet', replicasets: 'ReplicaSet', rs: 'ReplicaSet',
    event: 'Event', events: 'Event', ev: 'Event',
    service: 'Service', services: 'Service', svc: 'Service',
    endpoints: 'Endpoints', endpoint: 'Endpoints', ep: 'Endpoints',
    ingress: 'Ingress', ingresses: 'Ingress', ing: 'Ingress',
    limitrange: 'LimitRange', limitranges: 'LimitRange', limits: 'LimitRange',
    node: 'Node', nodes: 'Node', no: 'Node',
    hpa: 'HPA', horizontalpodautoscaler: 'HPA', horizontalpodautoscalers: 'HPA',
    scaledobject: 'ScaledObject', scaledobjects: 'ScaledObject', so: 'ScaledObject',
    nodeclaim: 'NodeClaim', nodeclaims: 'NodeClaim', nc: 'NodeClaim',
    namespace: 'Namespace', namespaces: 'Namespace', ns: 'Namespace',
    rolebinding: 'RoleBinding', rolebindings: 'RoleBinding', rb: 'RoleBinding',
    clusterrolebinding: 'ClusterRoleBinding', clusterrolebindings: 'ClusterRoleBinding',
    secret: 'Secret', secrets: 'Secret',
    serviceaccount: 'ServiceAccount', serviceaccounts: 'ServiceAccount', sa: 'ServiceAccount',
    poddisruptionbudget: 'PodDisruptionBudget', poddisruptionbudgets: 'PodDisruptionBudget', pdb: 'PodDisruptionBudget'
  };
  var PLURAL = { Pod: 'pods', Deployment: 'deployments.apps', ReplicaSet: 'replicasets.apps', Service: 'services', Endpoints: 'endpoints', Ingress: 'ingresses.networking.k8s.io', LimitRange: 'limitranges', Node: 'nodes', PodDisruptionBudget: 'poddisruptionbudgets.policy', HPA: 'horizontalpodautoscalers.autoscaling', ScaledObject: 'scaledobjects.keda.sh', NodeClaim: 'nodeclaims.karpenter.sh',
    Namespace: 'namespaces', RoleBinding: 'rolebindings.rbac.authorization.k8s.io', ClusterRoleBinding: 'clusterrolebindings.rbac.authorization.k8s.io',
    Secret: 'secrets', ServiceAccount: 'serviceaccounts' };
  var SINGULAR = { Pod: 'pod', Deployment: 'deployment.apps', ReplicaSet: 'replicaset.apps', Service: 'service', Ingress: 'ingress.networking.k8s.io' };
  var DEFAULT_FILES = { '/home/learner/.bashrc': '# lab shell\n' };

  // ---------- helpers ----------
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }

  function res(out, err, code) { return { out: out || '', err: err || '', code: code || 0, clear: false }; }
  function fail(msg, code) { return res('', msg + '\n', code === undefined ? 1 : code); }

  function ageText(min) {
    min = Math.max(0, Math.floor(min));
    if (min < 120) return min + 'm';
    if (min < 2880) return Math.floor(min / 60) + 'h';
    return Math.floor(min / 1440) + 'd';
  }

  function splitLines(text) {
    var a = String(text || '').split('\n');
    if (a.length && a[a.length - 1] === '') a.pop();
    return a;
  }

  function table(rows) {
    var widths = [];
    rows.forEach(function (r) {
      r.forEach(function (cell, i) { widths[i] = Math.max(widths[i] || 0, String(cell).length); });
    });
    return rows.map(function (r) {
      return r.map(function (cell, i) {
        var s = String(cell);
        if (i === r.length - 1) return s;
        return s + new Array(widths[i] - s.length + 4).join(' ');
      }).join('') + '\n';
    }).join('');
  }

  function getPath(obj, path) {
    var cur = obj, parts = path.split('.');
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || typeof cur !== 'object' || !(parts[i] in cur)) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function deepMerge(dst, src) {
    Object.keys(src).forEach(function (k) {
      var v = src[k];
      var plain = v && typeof v === 'object' && !Array.isArray(v);
      if (plain && dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) deepMerge(dst[k], v);
      else dst[k] = clone(v);
    });
    return dst;
  }

  // ---------- YAML subset: block maps, block lists, scalars ----------
  function parseYaml(text) {
    var lines = [];
    String(text).split('\n').forEach(function (raw) {
      var m = raw.replace(/\s+$/, '').match(/^( *)(.*)$/);
      if (m[2] === '' || m[2].charAt(0) === '#') return;
      lines.push({ ind: m[1].length, t: m[2] });
    });
    var pos = 0;

    function isItem(t) { return t === '-' || t.indexOf('- ') === 0; }

    function scalar(s) {
      s = s.trim();
      if (s === '' || s === '~' || s === 'null') return null;
      if (s === 'true') return true;
      if (s === 'false') return false;
      if (s === '[]') return [];
      if (s === '{}') return {};
      if (/^-?\d+$/.test(s)) return parseInt(s, 10);
      if (s.length >= 2 && /^["'].*["']$/.test(s)) return s.slice(1, -1);
      return s;
    }

    function node(ind) {
      return isItem(lines[pos].t) ? seq(ind) : map(ind);
    }

    function map(ind) {
      var obj = {};
      while (pos < lines.length && lines[pos].ind === ind && !isItem(lines[pos].t)) {
        var m = lines[pos].t.match(/^([^:]+):(.*)$/);
        if (!m) throw new Error('expected "key: value" on line ' + (pos + 1));
        var key = m[1].trim(), rest = m[2].trim();
        pos++;
        if (rest !== '') {
          obj[key] = scalar(rest);
        } else if (pos < lines.length && (lines[pos].ind > ind || (lines[pos].ind === ind && isItem(lines[pos].t)))) {
          obj[key] = node(lines[pos].ind);
        } else {
          obj[key] = null;
        }
      }
      return obj;
    }

    function seq(ind) {
      var arr = [];
      while (pos < lines.length && lines[pos].ind === ind && isItem(lines[pos].t)) {
        var rest = lines[pos].t.slice(1).trim();
        if (rest === '') {
          pos++;
          arr.push(pos < lines.length ? node(lines[pos].ind) : null);
        } else if (/^[^:"']+:(\s|$)/.test(rest)) {
          lines[pos] = { ind: ind + 2, t: rest };
          arr.push(map(ind + 2));
        } else {
          arr.push(scalar(rest));
          pos++;
        }
      }
      return arr;
    }

    if (!lines.length) return null;
    var doc = node(lines[0].ind);
    if (pos < lines.length) throw new Error('bad indentation on line ' + (pos + 1));
    return doc;
  }

  function scalarText(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'string') {
      var plain = /^[\w./:@%-]+$/.test(v) && !/^(true|false|null|-?\d+)$/.test(v);
      return plain ? v : JSON.stringify(v);
    }
    return String(v);
  }

  function emitYaml(v, ind, out) {
    var pad = new Array(ind + 1).join(' ');
    if (Array.isArray(v)) {
      v.forEach(function (item) {
        if (item !== null && typeof item === 'object' && Object.keys(item).length) {
          var sub = [];
          emitYaml(item, ind + 2, sub);
          if (!sub.length) { out.push(pad + '- {}'); return; }
          sub[0] = pad + '- ' + sub[0].slice(ind + 2);
          Array.prototype.push.apply(out, sub);
        } else {
          out.push(pad + '- ' + scalarText(item));
        }
      });
      return;
    }
    Object.keys(v).forEach(function (k) {
      if (k.charAt(0) === '_') return;
      var x = v[k];
      if (x !== null && typeof x === 'object' && Object.keys(x).length) {
        out.push(pad + k + ':');
        emitYaml(x, ind + 2, out);
      } else if (x !== null && typeof x === 'object') {
        out.push(pad + k + ': ' + (Array.isArray(x) ? '[]' : '{}'));
      } else {
        out.push(pad + k + ': ' + scalarText(x));
      }
    });
  }

  function toYaml(v) {
    var out = [];
    emitYaml(v, 0, out);
    return out.join('\n') + '\n';
  }

  // ---------- shell: tokenizer, pipes, redirects ----------
  function tokenize(line) {
    var toks = [], cur = '', has = false, quote = null;
    function flush() {
      if (has) toks.push({ w: cur });
      cur = '';
      has = false;
    }
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (quote) {
        if (c === quote) quote = null;
        else if (c === '\\' && quote === '"' && i + 1 < line.length) cur += line.charAt(++i);
        else cur += c;
        has = true;
      } else if (c === '"' || c === "'") {
        quote = c;
        has = true;
      } else if (c === '\\' && i + 1 < line.length) {
        cur += line.charAt(++i);
        has = true;
      } else if (c === ' ' || c === '\t') {
        flush();
      } else if (c === '|') {
        flush();
        toks.push({ op: '|' });
      } else if (c === '>') {
        flush();
        if (line.charAt(i + 1) === '>') { i++; toks.push({ op: '>>' }); }
        else toks.push({ op: '>' });
      } else {
        cur += c;
        has = true;
      }
    }
    if (quote) throw new Error('unexpected EOF while looking for matching `' + quote + "'");
    flush();
    return toks;
  }

  function parsePipeline(toks) {
    var stages = [], st = { argv: [], file: null, op: null };
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.op === '|') {
        if (!st.argv.length) throw new Error("syntax error near unexpected token `|'");
        stages.push(st);
        st = { argv: [], file: null, op: null };
      } else if (t.op) {
        if (!toks[i + 1] || !toks[i + 1].w) throw new Error('syntax error near unexpected token `' + t.op + "'");
        st.op = t.op;
        st.file = toks[++i].w;
      } else {
        st.argv.push(t.w);
      }
    }
    if (!st.argv.length && stages.length) throw new Error("syntax error near unexpected token `|'");
    if (st.argv.length || st.file) stages.push(st);
    return stages;
  }

  // ---------- virtual filesystem (flat map of absolute file paths) ----------
  function normalize(cwd, p) {
    if (p === '~' || p.indexOf('~/') === 0) p = HOME + p.slice(1);
    var full = p.charAt(0) === '/' ? p : cwd.replace(/\/$/, '') + '/' + p;
    var out = [];
    full.split('/').forEach(function (seg) {
      if (seg === '' || seg === '.') return;
      if (seg === '..') out.pop();
      else out.push(seg);
    });
    return '/' + out.join('/');
  }

  function isDir(files, p) {
    if (p === '/') return true;
    var pre = p + '/';
    return Object.keys(files).some(function (k) { return k.indexOf(pre) === 0; });
  }

  function listDir(files, p) {
    var pre = p === '/' ? '/' : p + '/', seen = {};
    Object.keys(files).forEach(function (k) {
      if (k.indexOf(pre) !== 0) return;
      var rest = k.slice(pre.length), i = rest.indexOf('/');
      seen[i < 0 ? rest : rest.slice(0, i) + '/'] = true;
    });
    return Object.keys(seen).sort();
  }

  // ---------- cluster model ----------
  function owns(o, kind, name) {
    return (o.metadata.ownerReferences || []).some(function (r) { return r.kind === kind && r.name === name; });
  }

  function readyPod(p) { return !!(p.status && p.status.ready); }

  function podsOf(c, rsName) {
    return c.objects.filter(function (o) { return o.kind === 'Pod' && owns(o, 'ReplicaSet', rsName); });
  }

  function rsOf(c, depName) {
    return c.objects.filter(function (o) { return o.kind === 'ReplicaSet' && owns(o, 'Deployment', depName); })[0] || null;
  }

  // Kinds that have no namespace. Namespace flags are ignored for them.
  var CLUSTER_SCOPED = { Node: true, NodeClaim: true, Namespace: true, ClusterRoleBinding: true };

  function findObj(s, kind, name, ns) {
    return s.cluster.objects.filter(function (o) {
      return o.kind === kind && o.metadata.name === name && (CLUSTER_SCOPED[kind] || o.metadata.namespace === ns);
    })[0] || null;
  }

  function matchSel(labels, sel) {
    if (!sel) return true;
    return sel.split(',').every(function (kv) {
      var p = kv.split('=');
      return labels[p[0]] === p[1];
    });
  }

  function listObjs(s, kind, ns, sel) {
    return s.cluster.objects.filter(function (o) {
      if (o.kind !== kind) return false;
      if (ns && !CLUSTER_SCOPED[kind] && o.metadata.namespace !== ns) return false;
      return matchSel(o.metadata.labels || {}, sel);
    });
  }

  function emit(c, type, reason, object, from, message) {
    c.events.push({ ts: c.clock, type: type, reason: reason, object: object, from: from, message: message });
  }

  function nextSuffix(c) {
    if (c.suffixes && c.suffixes.length) return c.suffixes.shift();
    c.genCounter = (c.genCounter || 0) + 1;
    return 'gen' + c.genCounter;
  }

  function tick(c) {
    c.clock += 1;

    // pods move Pending -> Running -> Ready, one step per tick
    c.objects.forEach(function (o) {
      if (o.kind !== 'Pod') return;
      o._t = (o._t || 0) + 1;
      // A pod waiting on a scheduling rule stays Pending until a manifest change places it.
      if (o._blocked) { o.status = { phase: 'Pending', ready: false }; return; }
      // A pod with a probe path keeps the readiness that its last apply gave it.
      if (o._serves) { o.status = { phase: 'Running', ready: !!(o.status && o.status.ready) }; return; }
      o.status = { phase: o._phase || (o._t >= 1 ? 'Running' : 'Pending'), ready: !o._notReady && !o._reason && o._t >= 2 };
      if (o._reason) o.status.reason = o._reason;
    });

    // Deployment controller: one ReplicaSet per Deployment, at the desired count
    c.objects.filter(function (o) { return o.kind === 'Deployment'; }).forEach(function (d) {
      var name = d.metadata.name, rs = rsOf(c, name);
      if (!rs) {
        var rsName = name + '-' + (c.rsSuffix || 'a1b2c');
        c.objects.push({
          kind: 'ReplicaSet',
          metadata: { name: rsName, namespace: d.metadata.namespace, labels: clone(d.spec.template.metadata.labels), ownerReferences: [{ kind: 'Deployment', name: name }] },
          spec: { replicas: d.spec.replicas, template: clone(d.spec.template) },
          status: {}, _born: c.clock
        });
        emit(c, 'Normal', 'ScalingReplicaSet', 'deployment/' + name, 'deployment-controller', 'Scaled up replica set ' + rsName + ' to ' + d.spec.replicas);
      } else if (rs.spec.replicas !== d.spec.replicas) {
        var up = d.spec.replicas > rs.spec.replicas;
        emit(c, 'Normal', 'ScalingReplicaSet', 'deployment/' + name, 'deployment-controller',
          'Scaled ' + (up ? 'up' : 'down') + ' replica set ' + rs.metadata.name + ' to ' + d.spec.replicas);
        rs.spec.replicas = d.spec.replicas;
      }
    });

    // ReplicaSet controller: one pod created or removed per tick
    c.objects.filter(function (o) { return o.kind === 'ReplicaSet'; }).forEach(function (rs) {
      var rsName = rs.metadata.name, mine = podsOf(c, rsName), want = rs.spec.replicas;
      if (mine.length < want) {
        var pname = rsName + '-' + nextSuffix(c);
        c.objects.push({
          kind: 'Pod',
          metadata: { name: pname, namespace: rs.metadata.namespace, labels: clone(rs.spec.template.metadata.labels), ownerReferences: [{ kind: 'ReplicaSet', name: rsName }] },
          spec: clone(rs.spec.template.spec),
          status: { phase: 'Pending', ready: false },
          _born: c.clock, _t: 0
        });
        emit(c, 'Normal', 'SuccessfulCreate', 'replicaset/' + rsName, 'replicaset-controller', 'Created pod: ' + pname);
      } else if (mine.length > want) {
        // remove a not-ready pod first, otherwise the newest
        var victim = mine.slice().sort(function (a, b) {
          return (Number(readyPod(a)) - Number(readyPod(b))) || (b._born - a._born);
        })[0];
        c.objects = c.objects.filter(function (o) { return o !== victim; });
        emit(c, 'Normal', 'SuccessfulDelete', 'replicaset/' + rsName, 'replicaset-controller', 'Deleted pod: ' + victim.metadata.name);
      }
    });

    // status fields, computed from what exists now
    c.objects.filter(function (o) { return o.kind === 'ReplicaSet'; }).forEach(function (rs) {
      var pods = podsOf(c, rs.metadata.name);
      rs.status = { replicas: pods.length, readyReplicas: pods.filter(readyPod).length };
    });
    c.objects.filter(function (o) { return o.kind === 'Deployment'; }).forEach(function (d) {
      var rs = rsOf(c, d.metadata.name);
      var pods = rs ? podsOf(c, rs.metadata.name) : [];
      var ready = pods.filter(readyPod).length;
      d.status = { replicas: pods.length, updatedReplicas: pods.length, readyReplicas: ready, availableReplicas: ready };
    });
  }

  // ---------- generic objects (heroes 5 to 10) ----------
  // Kinds with fixed columns. Each object carries its own _cells (every column but AGE)
  // and _describe (lines for kubectl describe). Private fields (leading underscore) are hidden in yaml.
  var GENERIC_COLS = {
    Ingress: ['NAME', 'CLASS', 'HOSTS', 'ADDRESS', 'PORTS', 'AGE'],
    LimitRange: ['NAME', 'AGE'],
    Node: ['NAME', 'STATUS', 'ROLES', 'VERSION', 'AGE'],
    HPA: ['NAME', 'REFERENCE', 'TARGETS', 'MINPODS', 'MAXPODS', 'REPLICAS', 'AGE'],
    ScaledObject: ['NAME', 'SCALETARGET', 'TRIGGER', 'MIN', 'MAX', 'AGE'],
    NodeClaim: ['NAME', 'NODECLASS', 'NODE', 'READY', 'AGE'],
    Namespace: ['NAME', 'STATUS', 'AGE'],
    RoleBinding: ['NAME', 'ROLE', 'AGE'],
    ClusterRoleBinding: ['NAME', 'ROLE', 'AGE'],
    Secret: ['NAME', 'TYPE', 'DATA', 'AGE'],
    ServiceAccount: ['NAME', 'SECRETS', 'AGE']
  };

  function pub(x) {
    return JSON.parse(JSON.stringify(x, function (k, v) { return k.charAt(0) === '_' ? undefined : v; }));
  }

  function resourceLines(ct) {
    var r = ct.resources || {}, out = [];
    ['limits', 'requests'].forEach(function (kind) {
      if (!r[kind]) return;
      out.push('    ' + (kind === 'limits' ? 'Limits:' : 'Requests:'));
      Object.keys(r[kind]).forEach(function (k) { out.push('      ' + k + ':  ' + r[kind][k]); });
    });
    return out;
  }

  // Liveness and readiness as describe prints them: the probe, its initial delay and its period.
  function probeLines(ct) {
    var out = [];
    [['Liveness', ct.livenessProbe], ['Readiness', ct.readinessProbe]].forEach(function (pair) {
      var p = pair[1];
      if (!p) return;
      var how = p.httpGet ? 'http-get http://:' + p.httpGet.port + p.httpGet.path : 'exec';
      out.push('    ' + pair[0] + ':  ' + how + ' delay=' + (p.initialDelaySeconds || 0) + 's timeout=1s period=' +
        (p.periodSeconds || 10) + 's #success=1 #failure=3');
    });
    return out;
  }

  // Guaranteed: every container sets cpu and memory limits equal to requests. BestEffort: nothing is set.
  function qosOf(containers) {
    var all = containers.map(function (ct) { return ct.resources || {}; });
    if (!all.some(function (r) { return r.requests || r.limits; })) return 'BestEffort';
    var guaranteed = all.every(function (r) {
      return r.limits && r.requests && ['cpu', 'memory'].every(function (k) { return r.limits[k] && r.limits[k] === r.requests[k]; });
    });
    return guaranteed ? 'Guaranteed' : 'Burstable';
  }

  // Applying the web Deployment re-syncs its pods with the template: probe readiness (pods with _serves)
  // and container resources. Rollouts are not modelled, so the change shows at once.
  function syncToTemplate(s) {
    var d = findObj(s, 'Deployment', 'web', s.ns);
    if (!d) return;
    var tpl = d.spec.template.spec.containers, c0 = tpl[0];
    var path = c0.readinessProbe && c0.readinessProbe.httpGet ? c0.readinessProbe.httpGet.path : null;
    var rs = rsOf(s.cluster, 'web');
    s.cluster.objects.forEach(function (p) {
      if (p.kind !== 'Pod') return;
      if (p._serves) p.status = { phase: 'Running', ready: path === p._serves };
      var owned = rs && (p.metadata.ownerReferences || []).some(function (r) { return r.name === rs.metadata.name; });
      if (!owned) return;
      placeBlocked(s, p, d);
      p.spec.containers.forEach(function (ct, i) {
        ['resources', 'readinessProbe', 'livenessProbe', 'lifecycle'].forEach(function (f) {
          if (tpl[i] && tpl[i][f]) ct[f] = clone(tpl[i][f]);
          else delete ct[f];
        });
      });
      // A pod that needs _readyAfter seconds to start is Ready once the readiness delay covers that time.
      if (owned && p._readyAfter !== undefined) {
        var delay = c0.readinessProbe && c0.readinessProbe.initialDelaySeconds || 0;
        if (delay >= p._readyAfter) delete p._notReady;
      }
      if (d.spec.template.spec.terminationGracePeriodSeconds !== undefined) {
        p.spec.terminationGracePeriodSeconds = d.spec.template.spec.terminationGracePeriodSeconds;
      }
    });
  }

  // A pod with _blocked is placed when the template fixes its reason: a toleration for the taint,
  // or a nodeSelector that matches a node. Placement sets its nodeName and makes it Running.
  function placeBlocked(s, pod, d) {
    var b = pod._blocked;
    if (!b) return;
    var spec = d.spec.template.spec, node = null;
    var nodes = s.cluster.objects.filter(function (x) { return x.kind === 'Node'; });
    if (b.kind === 'taint' && (spec.tolerations || []).some(function (t) { return t.key === b.key; })) {
      node = nodes.filter(function (n) { return (n.spec.taints || []).some(function (t) { return t.key === b.key; }); })[0];
    }
    if (b.kind === 'selector') {
      var sel = spec.nodeSelector || {};
      node = nodes.filter(function (n) {
        return Object.keys(sel).every(function (k) { return n.metadata.labels[k] === sel[k]; });
      })[0];
    }
    if (!node) return;
    delete pod._blocked;
    pod.spec.nodeName = node.metadata.name;
    pod.status = { phase: 'Running', ready: true };
  }

  // PodDisruptionBudget: allowed disruptions from the pods it selects.
  function pdbPods(s, pdb) {
    var ml = (pdb.spec.selector && pdb.spec.selector.matchLabels) || {};
    var sel = Object.keys(ml).map(function (k) { return k + '=' + ml[k]; }).join(',');
    return listObjs(s, 'Pod', pdb.metadata.namespace, sel);
  }

  function pdbAllowed(s, pdb) {
    var pods = pdbPods(s, pdb), healthy = pods.filter(readyPod).length;
    if (pdb.spec.minAvailable !== undefined) return Math.max(0, healthy - pdb.spec.minAvailable);
    return Math.max(0, pdb.spec.maxUnavailable - (pods.length - healthy));
  }

  function nodeNameOf(o) { return String(o.pos[0] || '').replace(/^node\//, ''); }

  function kCordon(s, o, on) {
    var name = nodeNameOf(o);
    var node = s.cluster.objects.filter(function (x) { return x.kind === 'Node' && x.metadata.name === name; })[0];
    if (!node) return fail('Error from server (NotFound): nodes "' + name + '" not found');
    node.spec.unschedulable = on;
    return res('node/' + name + (on ? ' cordoned' : ' uncordoned') + '\n');
  }

  // Drain cordons the node, then evicts its pods. A pod is refused when a budget that covers it has no
  // disruptions left for the pods on this node. Evicted pods are removed; the ReplicaSet makes new ones.
  function kDrain(s, o) {
    var name = nodeNameOf(o);
    var node = s.cluster.objects.filter(function (x) { return x.kind === 'Node' && x.metadata.name === name; })[0];
    if (!node) return fail('Error from server (NotFound): nodes "' + name + '" not found');
    node.spec.unschedulable = true;
    var onNode = s.cluster.objects.filter(function (x) { return x.kind === 'Pod' && x.spec.nodeName === name; });
    var blocked = null;
    s.cluster.objects.filter(function (x) { return x.kind === 'PodDisruptionBudget'; }).forEach(function (pdb) {
      var covered = pdbPods(s, pdb).filter(function (p) { return onNode.indexOf(p) >= 0; });
      if (!blocked && covered.length && covered.length > pdbAllowed(s, pdb)) blocked = covered[0];
    });
    if (blocked) {
      return res('', 'error when evicting pods/"' + blocked.metadata.name + '" -n "' + blocked.metadata.namespace +
        '" (will retry after 5s): Cannot evict pod as it would violate the pod\'s disruption budget.\n', 1);
    }
    s.cluster.objects = s.cluster.objects.filter(function (x) { return onNode.indexOf(x) < 0; });
    return res('node/' + name + ' drained\n');
  }

  // kubectl auth can-i VERB RESOURCE [--as SUBJECT]. Answers from the session's rbac fixture:
  // rbac[subject][resource] lists the verbs granted. It prints yes or no and exits 0.
  function kAuth(s, o) {
    if (o.pos[0] !== 'can-i' || o.pos.length < 3) return fail('error: this lab supports kubectl auth can-i VERB RESOURCE');
    var who = o.as || 'learner';
    var granted = ((s.rbac && s.rbac[who]) || {})[o.pos[2]] || [];
    return res((granted.indexOf(o.pos[1]) >= 0 ? 'yes' : 'no') + '\n');
  }

  // Revisions of a Deployment: a template change records the new template as the next revision.
  // The first change also records the template it replaced, as revision 1.
  function recordRevision(d, oldTemplateJson) {
    if (!d._revisions) d._revisions = [{ rev: 1, template: JSON.parse(oldTemplateJson), cause: '<none>' }];
    d._revisions.push({ rev: d._revisions[d._revisions.length - 1].rev + 1, template: clone(d.spec.template), cause: '<none>' });
  }

  // kubectl top pods: usage is a fixture (_usage), the sandbox does not compute it.
  function kTop(s, o) {
    var t = target(o.pos);
    if (t.kind !== 'Pod') return fail('error: in this lab, use kubectl top pods');
    var ns = o.ns || s.ns;
    var pods = listObjs(s, 'Pod', ns, o.sel);
    if (!pods.length) return res('', 'No resources found in ' + ns + ' namespace.\n', 0);
    return res(table([['NAME', 'CPU(cores)', 'MEMORY(bytes)']].concat(pods.map(function (p) {
      var u = p._usage || { cpu: '1m', mem: '10Mi' };
      return [p.metadata.name, u.cpu, u.mem];
    }))));
  }

  // ---------- kubectl ----------
  function parseKube(args) {
    var o = { pos: [], ns: null, all: false, out: null, sel: null, file: null, replicas: null, previous: false };
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (a === '-n' || a === '--namespace') o.ns = args[++i];
      else if (a.indexOf('--namespace=') === 0) o.ns = a.slice(12);
      else if (a === '-A' || a === '--all-namespaces') o.all = true;
      else if (a === '-o' || a === '--output') o.out = args[++i];
      else if (a.indexOf('-o') === 0 && a.indexOf('--') !== 0 && a.length > 2) o.out = a.slice(2);
      else if (a === '-l' || a === '--selector') o.sel = args[++i];
      else if (a.indexOf('--selector=') === 0) o.sel = a.slice(11);
      else if (a === '-f' || a === '--filename') o.file = args[++i];
      else if (a.indexOf('--filename=') === 0) o.file = a.slice(11);
      else if (a === '--replicas') o.replicas = parseInt(args[++i], 10);
      else if (a.indexOf('--replicas=') === 0) o.replicas = parseInt(a.slice(11), 10);
      else if (a === '-p' || a === '--previous') o.previous = true;
      else if (a === '--show-labels') o.showLabels = true;
      else if (a === '--ignore-daemonsets') o.ignoreDS = true;
      else if (a === '--as') o.as = args[++i];
      else if (a.charAt(0) === '-' && a.length > 1) throw new Error('unknown flag: ' + a);
      else o.pos.push(a);
    }
    return o;
  }

  // "deployment web", "deployment/web" or "pod/x" -> { kind, tok, name }
  function target(pos) {
    var kindTok, name;
    if (pos[0] && pos[0].indexOf('/') > 0) {
      kindTok = pos[0].split('/')[0];
      name = pos[0].split('/')[1];
    } else {
      kindTok = pos[0];
      name = pos[1];
    }
    return { kind: KIND[String(kindTok || '').toLowerCase()] || null, tok: kindTok, name: name || null };
  }

  function notFound(t) {
    return fail('Error from server (NotFound): ' + PLURAL[t.kind] + ' "' + t.name + '" not found');
  }

  function podRows(c, items) {
    return [['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE']].concat(items.map(function (p) {
      return [p.metadata.name, readyPod(p) ? '1/1' : '0/1', p.status.reason || p.status.phase, String(p._restarts || 0), ageText(c.clock - p._born)];
    }));
  }

  function deploymentRows(c, items) {
    return [['NAME', 'READY', 'UP-TO-DATE', 'AVAILABLE', 'AGE']].concat(items.map(function (d) {
      var st = d.status || {};
      return [d.metadata.name, (st.readyReplicas || 0) + '/' + d.spec.replicas, st.updatedReplicas || 0, st.availableReplicas || 0, ageText(c.clock - d._born)];
    }));
  }

  function replicaSetRows(c, items) {
    return [['NAME', 'DESIRED', 'CURRENT', 'READY', 'AGE']].concat(items.map(function (r) {
      var st = r.status || {};
      return [r.metadata.name, r.spec.replicas, st.replicas || 0, st.readyReplicas || 0, ageText(c.clock - r._born)];
    }));
  }

  function eventList(c, objectFilter) {
    return c.events.slice().sort(function (a, b) { return a.ts - b.ts; }).filter(function (e) {
      return !objectFilter || e.object === objectFilter;
    });
  }

  // Ready pods that a service selects. The sandbox computes endpoints from these.
  function endpointPods(s, svc) {
    var sel = Object.keys(svc.spec.selector || {}).map(function (k) { return k + '=' + svc.spec.selector[k]; }).join(',');
    return listObjs(s, 'Pod', svc.metadata.namespace, sel).filter(readyPod);
  }

  function endpointList(s, svc) {
    var port = svc.spec.ports && svc.spec.ports[0] ? svc.spec.ports[0].targetPort : 0;
    return endpointPods(s, svc).map(function (p) {
      var hash = 0;
      p.metadata.name.split('').forEach(function (ch) { hash = (hash * 31 + ch.charCodeAt(0)) % 200; });
      return '10.244.1.' + (10 + hash) + ':' + port;
    });
  }

  function serviceRows(c, items) {
    return [['NAME', 'TYPE', 'CLUSTER-IP', 'PORT(S)', 'AGE']].concat(items.map(function (sv) {
      var ports = (sv.spec.ports || []).map(function (p) { return p.port + '/TCP'; }).join(',');
      return [sv.metadata.name, sv.spec.type || 'ClusterIP', sv.spec.clusterIP || '<none>', ports, ageText(c.clock - sv._born)];
    }));
  }

  function kGet(s, o) {
    var t = target(o.pos), c = s.cluster;
    if (!o.pos.length) return fail('You must specify the type of resource to get. See "kubectl get -h" for help.');
    if (!t.kind) return fail('error: the server doesn\'t have a resource type "' + t.tok + '"');
    var ns = o.all ? null : (o.ns || s.ns);

    if (t.kind === 'Event') {
      var evs = eventList(c);
      if (!evs.length) return res('', 'No resources found in ' + ns + ' namespace.\n', 0);
      return res(table([['LAST SEEN', 'TYPE', 'REASON', 'OBJECT', 'MESSAGE']].concat(evs.map(function (e) {
        return [ageText(c.clock - e.ts), e.type, e.reason, e.object, e.message];
      }))));
    }

    if (t.kind === 'Node') {
      var nodes = listObjs(s, 'Node', null, o.sel).filter(function (x) { return !t.name || x.metadata.name === t.name; });
      if (!nodes.length) return t.name ? notFound(t) : res('', 'No resources found\n', 0);
      var nh = ['NAME', 'STATUS', 'ROLES', 'VERSION', 'AGE'];
      if (o.showLabels) nh.push('LABELS');
      return res(table([nh].concat(nodes.map(function (x) {
        var row = [x.metadata.name, x.spec.unschedulable ? 'Ready,SchedulingDisabled' : 'Ready', 'worker', x._version || '', ageText(c.clock - x._born)];
        if (o.showLabels) row.push(Object.keys(x.metadata.labels || {}).map(function (k) { return k + '=' + x.metadata.labels[k]; }).join(','));
        return row;
      }))));
    }

    if (t.kind === 'PodDisruptionBudget') {
      var pdbs = listObjs(s, 'PodDisruptionBudget', ns, null).filter(function (x) { return !t.name || x.metadata.name === t.name; });
      if (!pdbs.length) return t.name ? notFound(t) : res('', 'No resources found in ' + ns + ' namespace.\n', 0);
      return res(table([['NAME', 'MIN AVAILABLE', 'MAX UNAVAILABLE', 'ALLOWED DISRUPTIONS', 'AGE']].concat(pdbs.map(function (x) {
        return [x.metadata.name,
          x.spec.minAvailable === undefined ? 'N/A' : String(x.spec.minAvailable),
          x.spec.maxUnavailable === undefined ? 'N/A' : String(x.spec.maxUnavailable),
          String(pdbAllowed(s, x)), ageText(c.clock - x._born)];
      }))));
    }

    if (t.kind === 'Endpoints') {
      var svcs = listObjs(s, 'Service', ns, null).filter(function (x) { return !t.name || x.metadata.name === t.name; });
      if (!svcs.length && t.name) return notFound(t);
      if (!svcs.length) return res('', 'No resources found in ' + ns + ' namespace.\n', 0);
      return res(table([['NAME', 'ENDPOINTS', 'AGE']].concat(svcs.map(function (sv) {
        return [sv.metadata.name, endpointList(s, sv).join(',') || '<none>', ageText(c.clock - sv._born)];
      }))));
    }

    var items = listObjs(s, t.kind, ns, o.sel);
    if (t.name) {
      items = items.filter(function (x) { return x.metadata.name === t.name; });
      if (!items.length) return notFound(t);
    }
    if (o.out === 'yaml') {
      return res(toYaml(pub(items.length === 1 && t.name ? items[0] : { apiVersion: 'v1', kind: 'List', items: items })));
    }
    if (o.out === 'name') {
      return res(items.map(function (x) { return x.kind.toLowerCase() + '/' + x.metadata.name + '\n'; }).join(''));
    }
    if (!items.length) return res('', 'No resources found in ' + ns + ' namespace.\n', 0);
    if (GENERIC_COLS[t.kind]) {
      return res(table([GENERIC_COLS[t.kind]].concat(items.map(function (x) {
        return (x._cells || []).concat([ageText(c.clock - x._born)]);
      }))));
    }
    var rows =t.kind === 'Pod' ? podRows(c, items) : t.kind === 'Deployment' ? deploymentRows(c, items) : t.kind === 'Service' ? serviceRows(c, items) : replicaSetRows(c, items);
    return res(table(rows));
  }

  function kDescribe(s, o) {
    var t = target(o.pos), c = s.cluster;
    if (!t.kind || !t.name) return fail('error: describe needs a resource type and a name, e.g. kubectl describe pod <name>');
    var obj = findObj(s, t.kind, t.name, o.ns || s.ns);
    if (!obj) return notFound(t);
    if (GENERIC_COLS[t.kind]) {
      var gl = (obj._describe || []).slice();
      var gEvs = eventList(c, t.kind.toLowerCase() + '/' + t.name);
      gl.push('Events:');
      if (!gEvs.length) gl.push('  <none>');
      gEvs.forEach(function (e) { gl.push('  ' + e.type + '\t' + e.reason + '\t' + e.message); });
      return res(gl.join('\n') + '\n');
    }
    var labels = obj.metadata.labels || {}, st = obj.status || {};
    var lines = [
      'Name:           ' + obj.metadata.name,
      'Namespace:      ' + obj.metadata.namespace,
      'Labels:         ' + (Object.keys(labels).map(function (k) { return k + '=' + labels[k]; }).join(',') || '<none>')
    ];
    var owners = (obj.metadata.ownerReferences || []).map(function (r) { return r.kind + '/' + r.name; });
    if (owners.length) lines.push('Controlled By:  ' + owners.join(', '));
    if (t.kind === 'Pod') {
      var ready = readyPod(obj) ? 'True' : 'False', waiting = !!st.reason;
      lines.push('Node:           ' + (obj.spec.nodeName || '<none>'));
      lines.push('Service Account: ' + (obj.spec.serviceAccountName || 'default'));
      lines.push('Status:         ' + (st.reason || st.phase));
      lines.push('Containers:');
      obj.spec.containers.forEach(function (ct, i) {
        lines.push('  ' + ct.name + ':');
        lines.push('    Image:          ' + ct.image);
        if (i === 0) {
          lines.push('    State:          ' + (waiting ? 'Waiting' : 'Running'));
          if (waiting) lines.push('      Reason:       ' + st.reason);
          if (obj._last) {
            lines.push('    Last State:     Terminated');
            lines.push('      Reason:       ' + obj._last.reason);
            lines.push('      Exit Code:    ' + obj._last.exitCode);
          }
        }
        resourceLines(ct).forEach(function (l) { lines.push(l); });
        probeLines(ct).forEach(function (l) { lines.push(l); });
        if (i === 0) {
          lines.push('    Ready:          ' + ready);
          lines.push('    Restart Count:  ' + (obj._restarts || 0));
        }
      });
      lines.push('QoS Class:      ' + qosOf(obj.spec.containers));
      lines.push('Conditions:');
      lines.push('  Type              Status');
      lines.push('  PodScheduled      True');
      lines.push('  ContainersReady   ' + ready);
      lines.push('  Ready             ' + ready);
    }
    if (t.kind === 'Service') {
      var sel = Object.keys(obj.spec.selector || {}).map(function (k) { return k + '=' + obj.spec.selector[k]; }).join(',');
      var pt = obj.spec.ports && obj.spec.ports[0] ? obj.spec.ports[0] : {};
      lines.push('Selector:       ' + (sel || '<none>'));
      lines.push('Type:           ' + (obj.spec.type || 'ClusterIP'));
      lines.push('IP:             ' + (obj.spec.clusterIP || '<none>'));
      lines.push('Port:           ' + (pt.port ? pt.port + '/TCP' : '<unset>'));
      lines.push('TargetPort:     ' + (pt.targetPort ? pt.targetPort + '/TCP' : '<unset>'));
      lines.push('Endpoints:      ' + (endpointList(s, obj).join(',') || '<none>'));
    }
    if (t.kind === 'Deployment') {
      var dwant = obj.spec.replicas, avail = st.availableReplicas || 0;
      lines.push('Replicas:       ' + dwant + ' desired | ' + (st.updatedReplicas || 0) + ' updated | ' + (st.replicas || 0) +
        ' total | ' + avail + ' available | ' + Math.max(0, dwant - avail) + ' unavailable');
    }
    if (t.kind === 'ReplicaSet') {
      lines.push('Replicas:       ' + obj.spec.replicas + ' desired | ' + (st.replicas || 0) + ' current | ' + (st.readyReplicas || 0) + ' ready');
    }
    lines.push('Events:');
    var evs = eventList(c, t.kind.toLowerCase() + '/' + t.name);
    if (!evs.length) lines.push('  <none>');
    else {
      var evText = table([['Type', 'Reason', 'Age', 'From', 'Message']].concat(evs.map(function (e) {
        return [e.type, e.reason, ageText(c.clock - e.ts), e.from, e.message];
      })));
      evText.split('\n').filter(Boolean).forEach(function (l) { lines.push('  ' + l); });
    }
    return res(lines.join('\n') + '\n');
  }

  function kScale(s, o) {
    var t = target(o.pos);
    if (t.kind !== 'Deployment' || !t.name) return fail('error: in this lab, scale a deployment: kubectl scale deployment <name> --replicas=N');
    if (o.replicas === null || isNaN(o.replicas)) return fail('error: must specify --replicas');
    var d = findObj(s, 'Deployment', t.name, o.ns || s.ns);
    if (!d) return notFound(t);
    d.spec.replicas = o.replicas;
    return res('deployment.apps/' + t.name + ' scaled\n');
  }

  function kDelete(s, o) {
    var t = target(o.pos), c = s.cluster;
    if (!t.kind || !t.name) return fail('error: delete needs a resource type and a name');
    var obj = findObj(s, t.kind, t.name, o.ns || s.ns);
    if (!obj) return notFound(t);
    if (t.kind === 'Pod') {
      emit(c, 'Normal', 'Killing', 'pod/' + t.name, 'kubelet', 'Stopping container web');
      c.objects = c.objects.filter(function (x) { return x !== obj; });
    } else if (t.kind === 'Deployment') {
      // deleting a Deployment removes its ReplicaSet and that ReplicaSet's pods
      var rs = rsOf(c, t.name);
      var doomed = rs ? [obj, rs].concat(podsOf(c, rs.metadata.name)) : [obj];
      c.objects = c.objects.filter(function (x) { return doomed.indexOf(x) < 0; });
    } else {
      c.objects = c.objects.filter(function (x) { return x !== obj; });
    }
    return res(SINGULAR[t.kind] + ' "' + t.name + '" deleted\n');
  }

  function kApply(s, o) {
    if (!o.file) return fail('error: must specify one of -f or -k');
    var full = normalize(s.cwd, o.file);
    if (s.files[full] === undefined) return fail('error: the path "' + o.file + '" does not exist');
    var c = s.cluster, outs = [];
    var docs = s.files[full].split(/^---\s*$/m);
    for (var i = 0; i < docs.length; i++) {
      if (!docs[i].trim()) continue;
      var m;
      try { m = parseYaml(docs[i]); } catch (e) { return fail('error: error parsing ' + o.file + ': ' + e.message); }
      if (!m || !m.kind) continue;
      if (m.kind === 'Pod') {
        // Pod Security admission: a restricted namespace refuses pods that do not set runAsNonRoot.
        var pns = m.metadata.namespace || s.ns;
        var nsObj = findObj(s, 'Namespace', pns, null);
        var enforce = nsObj && nsObj.metadata.labels ? nsObj.metadata.labels['pod-security.kubernetes.io/enforce'] : null;
        var psc = m.spec && m.spec.securityContext;
        if (enforce === 'restricted' && !(psc && psc.runAsNonRoot === true)) {
          return fail('Error from server (Forbidden): error when creating "' + o.file + '": pods "' + m.metadata.name +
            '" is forbidden: violates PodSecurity "restricted:latest": runAsNonRoot != true');
        }
        c.objects.push({ kind: 'Pod', metadata: { name: m.metadata.name, namespace: pns, labels: m.metadata.labels || {} }, spec: clone(m.spec), status: { phase: 'Running', ready: true }, _born: c.clock, _t: 10 });
        outs.push('pod/' + m.metadata.name + ' created');
        continue;
      }
      if (m.kind !== 'Deployment' && m.kind !== 'Service' && m.kind !== 'PodDisruptionBudget') return fail('error: resource kind "' + m.kind + '" is not supported in this lab');
      var name = m.metadata.name, ns = m.metadata.namespace || s.ns;
      var cur = findObj(s, m.kind, name, ns);
      var label = m.kind === 'Service' ? 'service/' : m.kind === 'PodDisruptionBudget' ? 'poddisruptionbudget.policy/' : 'deployment.apps/';
      if (!cur) {
        c.objects.push({ kind: m.kind, metadata: { name: name, namespace: ns, labels: m.metadata.labels || {} }, spec: clone(m.spec), status: {}, _born: c.clock });
        outs.push(label + name + ' created');
      } else {
        var before = JSON.stringify(cur.spec), tplBefore = JSON.stringify(cur.spec.template || null);
        if (m.kind === 'PodDisruptionBudget') cur.spec = clone(m.spec);
        else deepMerge(cur.spec, m.spec);
        if (m.kind === 'Deployment' && JSON.stringify(cur.spec.template || null) !== tplBefore) recordRevision(cur, tplBefore);
        outs.push(label + name + (before === JSON.stringify(cur.spec) ? ' unchanged' : ' configured'));
      }
    }
    syncToTemplate(s);
    syncResolv(s);
    return res(outs.map(function (x) { return x + '\n'; }).join(''));
  }

  function kRollout(s, o) {
    var sub = o.pos[0];
    if (['status', 'history', 'undo'].indexOf(sub) < 0) return fail('error: this lab supports rollout status, history and undo');
    var t = target(o.pos.slice(1));
    if (t.kind !== 'Deployment' || !t.name) return fail('error: rollout ' + sub + ' needs deployment/<name>');
    var d = findObj(s, 'Deployment', t.name, o.ns || s.ns);
    if (!d) return notFound(t);
    var revs = d._revisions || [{ rev: 1, template: null, cause: '<none>' }];
    if (sub === 'history') {
      return res('deployment.apps/' + t.name + '\n' + table([['REVISION', 'CHANGE-CAUSE']].concat(revs.map(function (r) {
        return [String(r.rev), r.cause || '<none>'];
      }))) + '\n');
    }
    if (sub === 'undo') {
      if (revs.length < 2) return fail('error: no rollout history found for deployment "' + t.name + '"');
      var prev = revs[revs.length - 2];
      d.spec.template = clone(prev.template);
      d._revisions = revs.concat([{ rev: revs[revs.length - 1].rev + 1, template: clone(prev.template), cause: '<none>' }]);
      syncToTemplate(s);
      return res('deployment.apps/' + t.name + ' rolled back\n');
    }
    if (d._stuck) {
      return res('Waiting for deployment "' + t.name + '" rollout to finish: 1 of ' + d.spec.replicas + ' updated replicas are available...\n');
    }
    var st = d.status || {}, want = d.spec.replicas;
    if ((st.replicas || 0) !== want) {
      return res('Waiting for deployment "' + t.name + '" rollout to finish: ' + (st.replicas || 0) + ' old replicas are pending termination...\n');
    }
    if ((st.readyReplicas || 0) !== want) {
      return res('Waiting for deployment "' + t.name + '" rollout to finish: ' + (st.readyReplicas || 0) + ' of ' + want + ' updated replicas are available...\n');
    }
    return res('deployment "' + t.name + '" successfully rolled out\n');
  }

  function kLogs(s, o) {
    var name = o.pos[0] && o.pos[0].indexOf('pod/') === 0 ? o.pos[0].slice(4) : o.pos[0];
    if (!name) return fail('error: expected a pod name, e.g. kubectl logs <pod> -n shop');
    var p = findObj(s, 'Pod', name, o.ns || s.ns);
    if (!p) return fail('Error from server (NotFound): pods "' + name + '" not found');
    var key = o.previous ? '_logsPrevious' : '_logs';
    if (!p[key]) return o.previous ? fail('previous terminated container "web" in pod "' + name + '" not found') : res();
    return res(p[key].map(function (l) { return l + '\n'; }).join(''));
  }

  function kPortForward(s, o) {
    var t = target(o.pos), m = /^(\d+):(\d+)$/.exec(o.pos[1] || '');
    if (t.kind !== 'Service' || !t.name) return fail('error: in this lab, port-forward needs svc/<name> <local>:<remote>');
    if (!m) return fail('error: ports must look like 8080:80');
    if (!findObj(s, 'Service', t.name, o.ns || s.ns)) return notFound(t);
    s.forward = { svc: t.name, local: m[1], ns: o.ns || s.ns };
    return res('Forwarding from 127.0.0.1:' + m[1] + ' -> ' + m[2] + '\n');
  }

  function kubectl(s, args) {
    if (!args.length) return res('kubectl controls the Kubernetes cluster. Try: kubectl get pods -n shop\n');
    var o;
    try { o = parseKube(args.slice(1)); } catch (e) { return fail(e.message); }
    switch (args[0]) {
      case 'get': return kGet(s, o);
      case 'describe': return kDescribe(s, o);
      case 'scale': return kScale(s, o);
      case 'delete': return kDelete(s, o);
      case 'apply': return kApply(s, o);
      case 'rollout': return kRollout(s, o);
      case 'logs': return kLogs(s, o);
      case 'port-forward': return kPortForward(s, o);
      case 'top': return kTop(s, o);
      case 'cordon': return kCordon(s, o, true);
      case 'uncordon': return kCordon(s, o, false);
      case 'drain': return kDrain(s, o);
      case 'auth': return kAuth(s, o);
      default: return fail('error: unknown command "' + args[0] + '" for "kubectl"');
    }
  }

  // Base64 decode for ASCII payloads. Non-alphabet characters, such as newlines, are skipped.
  function b64decode(input) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var s = String(input || '').replace(/[^A-Za-z0-9+\/]/g, ''), out = '', buf = 0, bits = 0;
    for (var i = 0; i < s.length; i++) {
      buf = ((buf << 6) | chars.indexOf(s.charAt(i))) & 0xffffff;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out += String.fromCharCode((buf >> bits) & 0xff);
      }
    }
    return out;
  }

  // ---------- DNS (hero 4) ----------
  // The sandbox shell runs inside a web pod. Its /etc/resolv.conf comes from the session's dns fixture,
  // and ndots is overridden by the dnsConfig of the web Deployment, as the kubelet writes it into pods.
  // Template rollouts are not modelled: the change shows at once, not pod by pod.
  function syncResolv(s) {
    if (!s.dns) return;
    var web = findObj(s, 'Deployment', 'web', s.ns);
    var dc = web && web.spec.template && web.spec.template.spec && web.spec.template.spec.dnsConfig;
    var ndots = s.dns.ndots;
    ((dc && dc.options) || []).forEach(function (o) { if (o.name === 'ndots') ndots = parseInt(o.value, 10); });
    s.dns.ndotsNow = ndots;
    s.files['/etc/resolv.conf'] = 'nameserver ' + s.dns.nameserver + '\nsearch ' + s.dns.search.join(' ') + '\noptions ndots:' + ndots + '\n';
  }

  // Queries in the order a glibc resolver sends them. A name with at least ndots dots is tried as-is
  // first; otherwise every search suffix goes first. A trailing dot means the name is absolute.
  function dnsAttempts(s, name, useSearch) {
    var list;
    if (/\.$/.test(name)) list = [name.slice(0, -1)];
    else if (!useSearch) list = [name];
    else {
      var dots = (name.match(/\./g) || []).length;
      var suffixed = s.dns.search.map(function (d) { return name + '.' + d; });
      list = dots >= s.dns.ndotsNow ? [name].concat(suffixed) : suffixed.concat([name]);
    }
    var attempts = [];
    for (var i = 0; i < list.length; i++) {
      var ip = Object.prototype.hasOwnProperty.call(s.dns.records, list[i]) ? s.dns.records[list[i]] : null;
      attempts.push({ fqdn: list[i], ip: ip });
      if (ip) break;
    }
    return attempts;
  }

  function dnsNames(a) {
    return a.filter(function (x) { return x.charAt(0) !== '+' && x.charAt(0) !== '-'; });
  }

  // ---------- shell builtins ----------
  var SHELL = {
    help: function () {
      return res([
        'Shell:      help  clear  pwd  cd  ls  cat  echo  grep  head  tail  wc',
        'Pipes:      |      Redirects: >  >>',
        'Kubernetes: kubectl get | describe | scale | delete | apply -f | rollout status | events',
        'DNS:        nslookup NAME  |  dig NAME +search +showsearch',
        'Namespace:  shop (default). Add -n shop to be explicit.',
        'Clock:      every command you type advances the cluster by one minute.'
      ].join('\n') + '\n');
    },
    clear: function () { var r = res(); r.clear = true; return r; },
    // diff FILE1 FILE2: line by line, in the normal format. Exit 1 when the files differ.
    diff: function (s, a) {
      var files = dnsNames(a);
      if (files.length !== 2) return fail('diff: needs two files');
      var A = s.files[normalize(s.cwd, files[0])], B = s.files[normalize(s.cwd, files[1])];
      if (A === undefined) return fail('diff: ' + files[0] + ': No such file or directory');
      if (B === undefined) return fail('diff: ' + files[1] + ': No such file or directory');
      var al = splitLines(A), bl = splitLines(B), out = '';
      for (var i = 0; i < Math.max(al.length, bl.length); i++) {
        if (al[i] === bl[i]) continue;
        out += (i + 1) + 'c' + (i + 1) + '\n';
        if (al[i] !== undefined) out += '< ' + al[i] + '\n';
        if (bl[i] !== undefined) out += '> ' + bl[i] + '\n';
      }
      return res(out, '', out ? 1 : 0);
    },
    base64: function (s, a, stdin) {
      var decode = a.indexOf('-d') >= 0 || a.indexOf('--decode') >= 0;
      if (!decode) return fail('base64: only decoding (-d) is supported in this lab');
      var files = a.filter(function (x) { return x.charAt(0) !== '-'; });
      var text = stdin;
      if (files.length) {
        var full = normalize(s.cwd, files[0]);
        if (s.files[full] === undefined) return fail('base64: ' + files[0] + ': No such file or directory');
        text = s.files[full];
      }
      return res(b64decode(text));
    },
    nslookup: function (s, a) {
      var name = dnsNames(a)[0];
      if (!name) return fail('nslookup: missing host');
      var head = 'Server:\t\t' + s.dns.nameserver + '\nAddress:\t' + s.dns.nameserver + '#53\n\n';
      var hit = dnsAttempts(s, name, true).pop();
      if (!hit.ip) return res(head + "** server can't find " + name + ': NXDOMAIN\n', '', 1);
      return res(head + 'Name:\t' + hit.fqdn + '\nAddress: ' + hit.ip + '\n');
    },
    dig: function (s, a) {
      var name = dnsNames(a)[0];
      if (!name) return fail('dig: no name given');
      var attempts = dnsAttempts(s, name, a.indexOf('+search') >= 0);
      var out = '';
      if (a.indexOf('+showsearch') >= 0) {
        attempts.forEach(function (t) {
          out += ';; trying ' + t.fqdn + ': ' + (t.ip ? 'NOERROR ' + t.ip : 'NXDOMAIN') + '\n';
        });
      }
      var last = attempts[attempts.length - 1];
      out += last.ip ? ';; ANSWER: ' + last.ip + '\n' : ';; status: NXDOMAIN\n';
      return res(out);
    },
    pwd: function (s) { return res(s.cwd + '\n'); },
    cd: function (s, a) {
      var target = a[0] === undefined ? HOME : normalize(s.cwd, a[0]);
      if (!isDir(s.files, target)) return fail('bash: cd: ' + (a[0] || '~') + ': No such file or directory');
      s.cwd = target;
      return res();
    },
    ls: function (s, a) {
      var paths = a.filter(function (x) { return x.charAt(0) !== '-'; });
      if (!paths.length) paths = ['.'];
      var out = '', err = '', code = 0;
      paths.forEach(function (p) {
        var full = normalize(s.cwd, p);
        if (isDir(s.files, full)) listDir(s.files, full).forEach(function (n) { out += n + '\n'; });
        else if (s.files[full] !== undefined) out += p + '\n';
        else { err += 'ls: cannot access \'' + p + '\': No such file or directory\n'; code = 2; }
      });
      return res(out, err, code);
    },
    cat: function (s, a, stdin) {
      if (!a.length) return res(stdin);
      var out = '', err = '', code = 0;
      a.forEach(function (p) {
        var full = normalize(s.cwd, p);
        if (s.files[full] !== undefined) out += s.files[full];
        else if (isDir(s.files, full)) { err += 'cat: ' + p + ': Is a directory\n'; code = 1; }
        else { err += 'cat: ' + p + ': No such file or directory\n'; code = 1; }
      });
      return res(out, err, code);
    },
    echo: function (s, a) { return res(a.join(' ') + '\n'); },
    cp: function (s, a) {
      var args = a.filter(function (x) { return x.charAt(0) !== '-'; });
      if (args.length !== 2) return fail('cp: usage: cp SOURCE DEST');
      var src = normalize(s.cwd, args[0]), dst = normalize(s.cwd, args[1]);
      if (s.files[src] === undefined) return fail("cp: cannot stat '" + args[0] + "': No such file or directory");
      if (isDir(s.files, dst)) dst = dst + '/' + src.split('/').pop();
      s.files[dst] = s.files[src];
      return res();
    },
    curl: function (s, a) {
      var url = a.filter(function (x) { return x.charAt(0) !== '-'; })[0] || '';
      var m = /^(?:https?:\/\/)?localhost:(\d+)(\/\S*)?$/.exec(url);
      if (!m) return res('', 'curl: (6) Could not resolve host: ' + url + '\n', 6);
      var refused = 'curl: (7) Failed to connect to localhost port ' + m[1] + ': Connection refused\n';
      if (!s.forward || s.forward.local !== m[1]) return res('', refused, 7);
      var svc = findObj(s, 'Service', s.forward.svc, s.forward.ns);
      var pods = svc ? endpointPods(s, svc) : [];
      if (!pods.length) return res('', refused, 7);
      var listens = pods[0].spec.containers[0].ports[0].containerPort;
      if (svc.spec.ports[0].targetPort !== listens) return res('', 'curl: (52) Empty reply from server\n', 52);
      // Pods serve '/' unless the fixture says otherwise (_serves).
      if ((m[2] || '/') !== (pods[0]._serves || '/')) return res('HTTP/1.1 404 Not Found\n');
      return res('HTTP/1.1 200 OK\n');
    },
    grep: function (s, a, stdin) {
      var ci = false, num = false, inv = false, pos = [];
      a.forEach(function (f) {
        if (/^-[a-zA-Z]+$/.test(f)) {
          if (f.indexOf('i') >= 0) ci = true;
          if (f.indexOf('n') >= 0) num = true;
          if (f.indexOf('v') >= 0) inv = true;
        } else pos.push(f);
      });
      if (!pos.length) return res('', 'Usage: grep [-inv] PATTERN [FILE...]\n', 2);
      var re;
      try { re = new RegExp(pos[0], ci ? 'i' : ''); } catch (e) { return fail('grep: invalid regular expression', 2); }
      var files = pos.slice(1), lines = [], err = '', code = 0, prefix = files.length > 1;
      if (!files.length) splitLines(stdin).forEach(function (l, i) { lines.push({ src: '', l: l, n: i + 1 }); });
      files.forEach(function (p) {
        var full = normalize(s.cwd, p);
        if (s.files[full] === undefined) { err += 'grep: ' + p + ': No such file or directory\n'; code = 2; return; }
        splitLines(s.files[full]).forEach(function (l, i) { lines.push({ src: p, l: l, n: i + 1 }); });
      });
      var out = '', hits = 0;
      lines.forEach(function (x) {
        if (re.test(x.l) === inv) return;
        hits++;
        out += (prefix ? x.src + ':' : '') + (num ? x.n + ':' : '') + x.l + '\n';
      });
      return res(out, err, code === 2 ? 2 : (hits ? 0 : 1));
    },
    head: function (s, a, stdin) { return headTail(s, a, stdin, false); },
    tail: function (s, a, stdin) { return headTail(s, a, stdin, true); },
    wc: function (s, a, stdin) {
      var onlyLines = a.indexOf('-l') >= 0, files = a.filter(function (x) { return x !== '-l'; });
      var text = stdin, name = '';
      if (files.length) {
        var full = normalize(s.cwd, files[0]);
        if (s.files[full] === undefined) return fail('wc: ' + files[0] + ': No such file or directory');
        text = s.files[full];
        name = ' ' + files[0];
      }
      var lines = splitLines(text).length;
      if (onlyLines) return res(lines + name + '\n');
      var words = String(text).split(/\s+/).filter(Boolean).length;
      return res(lines + ' ' + words + ' ' + text.length + name + '\n');
    }
  };

  function headTail(s, a, stdin, fromEnd) {
    var n = 10, files = [];
    for (var i = 0; i < a.length; i++) {
      if (a[i] === '-n') n = parseInt(a[++i], 10);
      else if (/^-\d+$/.test(a[i])) n = parseInt(a[i].slice(1), 10);
      else files.push(a[i]);
    }
    var text = stdin;
    if (files.length) {
      var full = normalize(s.cwd, files[0]);
      if (s.files[full] === undefined) return fail((fromEnd ? 'tail' : 'head') + ": cannot open '" + files[0] + "' for reading: No such file or directory");
      text = s.files[full];
    }
    var lines = splitLines(text);
    var part = fromEnd ? lines.slice(Math.max(0, lines.length - n)) : lines.slice(0, n);
    return res(part.map(function (l) { return l + '\n'; }).join(''));
  }

  function execStage(s, argv, stdin) {
    if (!argv.length) return res();
    var name = argv[0], rest = argv.slice(1);
    if (name === 'kubectl') return kubectl(s, rest);
    if (!Object.prototype.hasOwnProperty.call(SHELL, name)) return fail('bash: ' + name + ': command not found', 127);
    return SHELL[name](s, rest, stdin);
  }

  function writeFile(s, target, text, append) {
    var full = normalize(s.cwd, target);
    if (isDir(s.files, full)) throw new Error(target + ': Is a directory');
    s.files[full] = (append && s.files[full] !== undefined ? s.files[full] : '') + text;
  }

  // ---------- public: sessions and running lines ----------
  function createSession(fx) {
    var files = {}, k;
    for (k in DEFAULT_FILES) files[k] = DEFAULT_FILES[k];
    for (k in fx.files) files[k] = fx.files[k];
    var cluster = clone(fx.cluster);
    cluster.clock = 0;
    cluster.genCounter = 0;
    cluster.events = cluster.events || [];
    var sess = { cwd: fx.cwd || '/work', ns: fx.ns || 'shop', files: files, cluster: cluster, history: [], dns: fx.dns ? clone(fx.dns) : null, rbac: fx.rbac ? clone(fx.rbac) : {} };
    syncResolv(sess);
    return sess;
  }

  function run(s, line) {
    var text = String(line).trim();
    if (!text) return res();
    var stages;
    try { stages = parsePipeline(tokenize(text)); } catch (e) { return fail('bash: ' + e.message, 2); }
    var prev = '', last = '', code = 0, err = '', clear = false;
    stages.forEach(function (st) {
      var r = execStage(s, st.argv, prev);
      err += r.err;
      code = r.code;
      clear = clear || r.clear;
      if (st.file) {
        try { writeFile(s, st.file, r.out, st.op === '>>'); } catch (e) { err += 'bash: ' + e.message + '\n'; code = 1; }
        prev = '';
        last = '';
      } else {
        prev = r.out;
        last = r.out;
      }
    });
    tick(s.cluster);
    s.history.push({ cmd: text, ok: code === 0 });
    return { out: clear ? '' : last, err: clear ? '' : err, code: code, clear: clear };
  }

  // Checks used by chapter tasks. Every check in a task must pass.
  //  field:  { type, ref: 'deployment/web', path: 'spec.replicas', eq: 3 }
  //  count:  { type, kind: 'Pod', label: 'app=web', eq: 3 } or { min: 2 }
  //  absent: { type, ref: 'pod/web-x' }
  //  ran:    { type, re: '^kubectl get ...' }   a successful command since the task started
  //  file:   { type, path: '/work/x.txt', re: 'text' }
  //  event:  { type, reason: 'SuccessfulCreate', min: 2 }
  function refObj(s, ref) {
    var p = ref.split('/');
    var kind = KIND[p[0].toLowerCase()];
    return kind ? findObj(s, kind, p[1], s.ns) : null;
  }

  function one(s, c, from) {
    switch (c.type) {
      case 'field':
        var o = refObj(s, c.ref);
        return !!o && getPath(o, c.path) === c.eq;
      case 'count':
        var kind = KIND[String(c.kind).toLowerCase()] || c.kind;
        var n = listObjs(s, kind, s.ns, c.label).length;
        return (c.eq === undefined || n === c.eq) && (c.min === undefined || n >= c.min);
      case 'absent':
        return !refObj(s, c.ref);
      case 'ran':
        var re = new RegExp(c.re);
        return s.history.slice(from).some(function (h) { return h.ok && re.test(h.cmd); });
      case 'file':
        var body = s.files[c.path];
        return body !== undefined && new RegExp(c.re, 'mi').test(body);
      case 'event':
        return s.cluster.events.filter(function (e) { return e.reason === c.reason; }).length >= (c.min || 1);
      default:
        throw new Error('unknown check type: ' + c.type);
    }
  }

  function check(s, list, from) {
    return list.every(function (c) { return one(s, c, from || 0); });
  }

  window.LabEngine = {
    createSession: createSession,
    run: run,
    check: check,
    tokenize: tokenize,
    parseYaml: parseYaml,
    toYaml: toYaml
  };
})();
