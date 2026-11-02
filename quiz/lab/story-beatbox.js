// Hero 10 - BEATBOX. Story in three chapters: Probes, Shutdown, Review.
// Tasks are in lab/backlog/10-beatbox.js. Each chapter's start() builds its fixture.
// Deployments are built from the same YAML the learner sees, parsed with the engine's parser.
window.LAB_CHAPTERS = (window.LAB_CHAPTERS || []).concat((function () {
  'use strict';

  var NS = 'shop';
  var YAML = window.LabEngine;

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function ev(ts, type, reason, object, from, message) {
    return { ts: ts, type: type, reason: reason, object: object, from: from, message: message };
  }

  // opts: initialDelay (readiness delay 5s), preStop (sleep 5 before stop), image (release tag).
  function manifest(opts) {
    opts = opts || {};
    var lines = [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: web',
      '  namespace: shop',
      '  labels:',
      '    app: web',
      'spec:',
      '  replicas: ' + (opts.replicas || 3),
      '  selector:',
      '    matchLabels:',
      '      app: web',
      '  template:',
      '    metadata:',
      '      labels:',
      '        app: web',
      '    spec:',
      '      terminationGracePeriodSeconds: 30',
      '      containers:',
      '      - name: web',
      '        image: shop/web:' + (opts.image || '1.4'),
      '        ports:',
      '        - containerPort: 8080',
      '        readinessProbe:'
    ];
    if (opts.initialDelay) lines.push('          initialDelaySeconds: 5');
    lines = lines.concat([
      '          httpGet:',
      '            path: /healthz',
      '            port: 8080',
      '          periodSeconds: 10',
      '        livenessProbe:',
      '          httpGet:',
      '            path: /healthz',
      '            port: 8080',
      '          initialDelaySeconds: 10',
      '          periodSeconds: 20'
    ]);
    if (opts.preStop) {
      lines = lines.concat([
        '        lifecycle:',
        '          preStop:',
        '            exec:',
        '              command:',
        '              - sleep',
        '              - "5"'
      ]);
    }
    return lines.join('\n') + '\n';
  }

  var MANIFEST = manifest({});

  function deployment(text, replicas) {
    var spec = YAML.parseYaml(text).spec;
    if (replicas !== undefined) spec.replicas = replicas;
    return { kind: 'Deployment', metadata: { name: 'web', namespace: NS, labels: { app: 'web' } }, spec: spec, status: {}, _born: -4320 };
  }

  function replicaSet(d, count) {
    return {
      kind: 'ReplicaSet',
      metadata: { name: 'web-7f9c', namespace: NS, labels: { app: 'web' }, ownerReferences: [{ kind: 'Deployment', name: 'web' }] },
      spec: { replicas: count, template: clone(d.spec.template) },
      status: {},
      _born: -4300
    };
  }

  // Each pod carries the probes and grace period of the template it was made from.
  function pod(name, d, extra) {
    var p = {
      kind: 'Pod',
      metadata: { name: name, namespace: NS, labels: { app: 'web' }, ownerReferences: [{ kind: 'ReplicaSet', name: 'web-7f9c' }] },
      spec: clone(d.spec.template.spec),
      status: { phase: 'Running', ready: true },
      _born: -4000,
      _t: 10
    };
    Object.keys(extra || {}).forEach(function (k) { p[k] = extra[k]; });
    return p;
  }

  function unhealthy(object, ts) {
    return ev(ts, 'Warning', 'Unhealthy', object, 'kubelet', 'Readiness probe failed: HTTP probe failed with statuscode: 503');
  }

  var README = '# shop\n\nWeb replicas live in deployment.yaml. Git is the source of truth.\n';

  function start(opts) {
    var d = deployment(opts.manifest, opts.replicas);
    var count = opts.replicas || 3;
    return {
      files: clone(opts.files),
      cwd: '/work',
      ns: NS,
      cluster: {
        objects: [d, replicaSet(d, count)].concat(opts.pods.map(function (p) { return pod(p.name, d, p.extra); })),
        events: opts.events ? clone(opts.events) : [],
        suffixes: []
      }
    };
  }

  var FIX_DELAY = manifest({ initialDelay: true });
  var FIX_PRESTOP = manifest({ preStop: true });
  var LAST_APPLIED = manifest({ image: '1.3' });

  return [
    // ---------- Chapter 1 ----------
    {
      id: 'bea-1',
      h: 'BEATBOX',
      n: 1,
      title: 'Probes',
      skill: 'Read readiness and liveness probes in describe. Count Unhealthy events. Set an initial delay and apply it.',
      intro: [
        'One web pod is Running but not Ready, and the events are full of probe failures. Nothing is crashing. The app just answers too late for its probe.',
        'Read the probes on the healthy pod first, then count the failures.'
      ],
      concept: 'A **readiness probe** decides if a pod gets traffic. A **liveness probe** decides if the container is restarted. Each probe has an **initialDelaySeconds** (wait before the first check) and a **periodSeconds** (time between checks). Failing probes leave an **Unhealthy** event.',
      tasks: ['bea-t-01', 'bea-t-02', 'bea-t-03', 'bea-t-04', 'bea-t-05'],
      learned: [
        'describe shows each probe with its delay and period.',
        'Unhealthy events count the failed probes. Read them before you change the probe.',
        'A liveness probe that calls a shared dependency can take every pod down at once.'
      ],
      outro: [
        'The readiness probe checked too early, before the app was up. A five-second initial delay gave it time to start, and the second pod became Ready.',
        'Next: what happens when a pod stops: the grace period, the exit codes, and the preStop hook.'
      ],
      start: function () {
        return start({
          manifest: MANIFEST,
          files: { '/work/shop/deployment.yaml': MANIFEST, '/work/shop/fix/deployment.yaml': FIX_DELAY, '/work/shop/README.md': README },
          pods: [{ name: 'web-7f9c-k4x9q' }, { name: 'web-7f9c-m2v7w', extra: { _notReady: true, _readyAfter: 5 } }],
          events: [unhealthy('pod/web-7f9c-m2v7w', -600), unhealthy('pod/web-7f9c-m2v7w', -420), unhealthy('pod/web-7f9c-m2v7w', -240)]
        });
      }
    },

    // ---------- Chapter 2 ----------
    {
      id: 'bea-2',
      h: 'BEATBOX',
      n: 2,
      title: 'Shutdown',
      skill: 'Read the grace period in the pod yaml. Read exit codes 143 and 137. Add a preStop hook. Delete a pod and read the Killing event.',
      intro: [
        'A rollout restarted the web pods, and two of them exited with odd codes. The customers saw a few dropped requests during each restart.',
        'Read the grace period, what the exit codes mean, and add a hook so the pods finish their requests first.'
      ],
      concept: 'When a pod stops, the kubelet sends **SIGTERM** (exit 143, which is 128 plus 15) and waits for the **terminationGracePeriodSeconds** (30 by default). If the container is still running after that, it is sent **SIGKILL** (exit 137, which is 128 plus 9). A **preStop** hook runs before SIGTERM, so the pod can drain its connections.',
      tasks: ['bea-t-06', 'bea-t-07', 'bea-t-08', 'bea-t-09', 'bea-t-10'],
      learned: [
        'The grace period is the time a pod has to stop cleanly.',
        'Exit 143 is SIGTERM: the container stopped when asked. Exit 137 is SIGKILL: it did not.',
        'A preStop hook gives load balancers time to stop sending new requests.',
        '`kubectl delete pod` shows a Killing event for the container.'
      ],
      outro: [
        'The grace period is 30 seconds. One pod stopped on SIGTERM, which is what we want. Another ran past its grace period and was killed with SIGKILL, so its requests were cut off. The preStop sleep gives the load balancer time to take the pod out first.',
        'Next: review a change in git before it reaches the cluster.'
      ],
      start: function () {
        return start({
          manifest: MANIFEST,
          files: { '/work/shop/deployment.yaml': MANIFEST, '/work/shop/fix/deployment.yaml': FIX_PRESTOP, '/work/shop/README.md': README },
          pods: [
            { name: 'web-7f9c-k4x9q', extra: { _last: { reason: 'Error', exitCode: 143 } } },
            { name: 'web-7f9c-m2v7w' },
            { name: 'web-7f9c-r8t1z', extra: { _last: { reason: 'Error', exitCode: 137 } } }
          ],
          events: []
        });
      }
    },

    // ---------- Chapter 3 ----------
    {
      id: 'bea-3',
      h: 'BEATBOX',
      n: 3,
      title: 'Review',
      skill: 'Diff the manifest in git against the last applied copy. Find drift between git and the cluster. Write a review checklist.',
      intro: [
        'The web store has a new image in git, and the cluster was scaled by hand during the last incident. Before the change ships, check what git says against what the cluster and the last apply have.',
        'Diff the files, find the object that drifted, and write the checklist you would use for the next manifest change.'
      ],
      concept: 'A **GitOps** setup keeps git as the source of truth. **Drift** is any difference between git and the live object, such as a replica count changed by hand. A **diff** of two manifests shows the change before it is applied. A review checks the probes, the shutdown, and where the config comes from.',
      tasks: ['bea-t-11', 'bea-t-14', 'bea-t-15'],
      learned: [
        'diff shows which lines changed between two manifests. Count the changes, not the header.',
        'Drift is a difference between git and the live cluster. A hand scale causes it.',
        'A review checks probes, shutdown and the source of the config, in that order.'
      ],
      outro: [
        'The new image is the only change between git and the last apply. The cluster drifted in replicas, because someone scaled web by hand. Git is the source of truth, so the next sync puts replicas back to 3.',
        'End of BEATBOX, for now. You can read probes and exit codes, trace a shutdown, and review a change before it reaches the cluster. Tasks 12 and 13 need helm, and they are not built yet.'
      ],
      start: function () {
        return start({
          manifest: MANIFEST,
          replicas: 2,
          files: { '/work/shop/deployment.yaml': MANIFEST, '/work/shop/last-applied.yaml': LAST_APPLIED, '/work/shop/README.md': README },
          pods: [{ name: 'web-7f9c-k4x9q' }, { name: 'web-7f9c-m2v7w' }]
        });
      }
    }
  ];
})());
