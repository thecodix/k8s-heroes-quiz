// Hero 7 - TRAPPER. Story in three chapters: Pending, Placement, Drain.
// Tasks are in lab/backlog/07-trapper.js. Each chapter's start() builds its fixture.
// Deployments are built from the same YAML the learner sees, parsed with the engine's parser.
window.LAB_CHAPTERS = (window.LAB_CHAPTERS || []).concat((function () {
  'use strict';

  var NS = 'shop';
  var YAML = window.LabEngine;

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function ev(ts, type, reason, object, from, message) {
    return { ts: ts, type: type, reason: reason, object: object, from: from, message: message };
  }

  // extra: lines placed under the pod template spec (tolerations, nodeSelector).
  function manifest(replicas, extra) {
    return [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: web',
      '  namespace: shop',
      '  labels:',
      '    app: web',
      'spec:',
      '  replicas: ' + replicas,
      '  selector:',
      '    matchLabels:',
      '      app: web',
      '  template:',
      '    metadata:',
      '      labels:',
      '        app: web',
      '    spec:'
    ].concat(extra || []).concat([
      '      containers:',
      '      - name: web',
      '        image: shop/web:1.4',
      '        ports:',
      '        - containerPort: 8080',
      '      affinity:',
      '        podAntiAffinity:',
      '          preferredDuringSchedulingIgnoredDuringExecution:',
      '          - weight: 100',
      '            podAffinityTerm:',
      '              labelSelector:',
      '                matchLabels:',
      '                  app: web',
      '              topologyKey: topology.kubernetes.io/zone',
      ''
    ]).join('\n');
  }

  var TOLERATION = [
    '      tolerations:',
    '      - key: dedicated',
    '        operator: Equal',
    '        value: batch',
    '        effect: NoSchedule'
  ];

  function nodeSelector(zone) {
    return ['      nodeSelector:', '        zone: ' + zone];
  }

  var PDB_MIN = [
    'apiVersion: policy/v1', 'kind: PodDisruptionBudget', 'metadata:', '  name: web-pdb', '  namespace: shop',
    'spec:', '  minAvailable: 2', '  selector:', '    matchLabels:', '      app: web', ''
  ].join('\n');
  var PDB_MAX = PDB_MIN.replace('minAvailable: 2', 'maxUnavailable: 1');

  function deploymentFrom(text) {
    return { kind: 'Deployment', metadata: { name: 'web', namespace: NS, labels: { app: 'web' } }, spec: YAML.parseYaml(text).spec, status: {}, _born: -4320 };
  }

  function replicaSet(d) {
    return {
      kind: 'ReplicaSet',
      metadata: { name: 'web-7f9c', namespace: NS, labels: { app: 'web' }, ownerReferences: [{ kind: 'Deployment', name: 'web' }] },
      spec: { replicas: d.spec.replicas, template: clone(d.spec.template) },
      status: {},
      _born: -4300
    };
  }

  function pod(name, nodeName, blocked) {
    var p = {
      kind: 'Pod',
      metadata: { name: name, namespace: NS, labels: { app: 'web' }, ownerReferences: [{ kind: 'ReplicaSet', name: 'web-7f9c' }] },
      spec: { containers: [{ name: 'web', image: 'shop/web:1.4', ports: [{ containerPort: 8080 }] }] },
      status: { phase: 'Running', ready: true },
      _born: -4000,
      _t: 10
    };
    if (nodeName) p.spec.nodeName = nodeName;
    if (blocked) {
      p.status = { phase: 'Pending', ready: false };
      p._blocked = blocked;
    }
    return p;
  }

  // Three nodes. The batch node carries a NoSchedule taint.
  function node(name, zone, batch) {
    var labels = { zone: zone }, spec = {};
    if (batch) { labels.pool = 'batch'; spec.taints = [{ key: 'dedicated', value: 'batch', effect: 'NoSchedule' }]; }
    var pairs = Object.keys(labels).map(function (k) { return k + '=' + labels[k]; }).join(',');
    return {
      kind: 'Node',
      metadata: { name: name, labels: labels },
      spec: spec,
      _version: 'v1.30.4',
      _born: -9000,
      _describe: [
        'Name:               ' + name,
        'Labels:             ' + pairs,
        'Taints:             ' + (batch ? 'dedicated=batch:NoSchedule' : '<none>')
      ]
    };
  }

  function nodes() {
    return [
      node('ip-10-0-1-5', 'eu-west-1a', false),
      node('ip-10-0-2-9', 'eu-west-1b', false),
      node('ip-10-0-3-17', 'eu-west-1a', true)
    ];
  }

  function pdb(minAvailable, maxUnavailable) {
    var spec = { selector: { matchLabels: { app: 'web' } } };
    if (minAvailable !== undefined) spec.minAvailable = minAvailable;
    if (maxUnavailable !== undefined) spec.maxUnavailable = maxUnavailable;
    return { kind: 'PodDisruptionBudget', metadata: { name: 'web-pdb', namespace: NS }, spec: spec, _born: -4000 };
  }

  var PENDING_MESSAGE = '0/3 nodes are available: 2 Insufficient cpu, 1 node(s) had untolerated taint {dedicated: batch}.';
  var SELECTOR_MESSAGE = "0/3 nodes are available: 3 node(s) didn't match Pod's node affinity/selector.";

  function schedulingEvent(message) {
    return ev(-120, 'Warning', 'FailedScheduling', 'pod/web-7f9c-p3q8n', 'default-scheduler', message);
  }

  // ---------- Chapter 1 fixture: a pod waits for the batch node, which needs a toleration ----------
  var MANIFEST_TAINT = manifest(3, []);
  var TOLERATION_FIX = manifest(3, TOLERATION);

  // ---------- Chapter 2 fixture: the selector asks for a zone no node has ----------
  var MANIFEST_SELECTOR = manifest(3, nodeSelector('eu-west-1c'));
  var SELECTOR_FIX = manifest(3, nodeSelector('eu-west-1b'));

  // ---------- Chapter 3 fixture: a budget that protects both web pods ----------
  var MANIFEST_PLAIN = manifest(2, []);

  function start(opts) {
    var d = deploymentFrom(opts.manifest);
    return {
      files: clone(opts.files),
      cwd: '/work',
      ns: NS,
      cluster: {
        objects: [d, replicaSet(d),
          pod('web-7f9c-k4x9q', 'ip-10-0-1-5'),
          pod('web-7f9c-m2v7w', 'ip-10-0-2-9')]
          .concat(opts.pending ? [pod('web-7f9c-p3q8n', null, opts.pending)] : [])
          .concat(nodes())
          .concat(opts.pdb ? [pdb(2, undefined)] : []),
        events: opts.events ? clone(opts.events) : [],
        suffixes: []
      }
    };
  }

  var README = '# shop\n\nWeb replicas live in deployment.yaml. Git is the source of truth.\n';

  return [
    // ---------- Chapter 1 ----------
    {
      id: 'tra-1',
      h: 'TRAPPER',
      n: 1,
      title: 'Pending',
      skill: 'Find a Pending pod. Read the scheduler message. Read node taints. Add a toleration and apply it.',
      intro: [
        'A new web pod has been Pending for ten minutes. The deploy finished, two replicas run, and the third will not start.',
        'Find the pod, then ask the scheduler why it did not place it.'
      ],
      concept: 'The **scheduler** places a Pod on a node that has room, that matches its selectors, and whose **taints** the pod **tolerates**. A **taint** keeps pods off a node unless they carry a matching toleration. The scheduler writes its reason in the Events of a Pending pod.',
      tasks: ['tra-t-01', 'tra-t-02', 'tra-t-03', 'tra-t-05', 'tra-t-04'],
      learned: [
        'A Pending pod is one the scheduler could not place. Its events say why.',
        'A taint on a node pushes pods away unless they tolerate it.',
        'Count the nodes that really are open to the pod before you change anything.'
      ],
      outro: [
        'Two nodes were full, and the third node had a batch taint the web pods did not tolerate. The toleration fixed the one pod that waited, and the pod landed on the batch node.',
        'Next: the placement rules themselves: labels, selectors, and affinity.'
      ],
      start: function () { return start({ manifest: MANIFEST_TAINT, files: { '/work/shop/deployment.yaml': MANIFEST_TAINT, '/work/shop/fix/deployment.yaml': TOLERATION_FIX, '/work/shop/README.md': README }, pending: { kind: 'taint', key: 'dedicated' }, events: [schedulingEvent(PENDING_MESSAGE)] }); }
    },

    // ---------- Chapter 2 ----------
    {
      id: 'tra-2',
      h: 'TRAPPER',
      n: 2,
      title: 'Placement',
      skill: 'List node labels. Compare a nodeSelector with the labels that exist. Fix the selector. Read the kind of affinity rule.',
      intro: [
        'The third web pod is still Pending. The scheduler now says no node matches its selector. The selector asks for a zone that does not exist in this cluster.',
        'Read the zone labels on the nodes, fix the selector, and apply it.'
      ],
      concept: 'A **nodeSelector** is a hard rule: the pod runs only on a node with every label it names. **Affinity** is softer when it says **preferred**: the scheduler tries to honour it and still places the pod when it cannot.',
      tasks: ['tra-t-06', 'tra-t-07', 'tra-t-08', 'tra-t-09'],
      learned: [
        'Labels on nodes are what selectors match against. Show them with --show-labels.',
        'A nodeSelector that names a label no node has leaves the pod Pending.',
        'Preferred affinity is a hint. Required affinity is a rule the scheduler must keep.'
      ],
      outro: [
        'The selector asked for zone=eu-west-1c. The nodes are in eu-west-1a and eu-west-1b. Choosing eu-west-1b let the scheduler place the pod on the node in that zone.',
        'Next: check how the pods spread across zones, and how a disruption budget protects them during drains.'
      ],
      start: function () { return start({ manifest: MANIFEST_SELECTOR, files: { '/work/shop/deployment.yaml': MANIFEST_SELECTOR, '/work/shop/fix/deployment.yaml': SELECTOR_FIX, '/work/shop/README.md': README }, pending: { kind: 'selector' }, events: [schedulingEvent(SELECTOR_MESSAGE)] }); }
    },

    // ---------- Chapter 3 ----------
    {
      id: 'tra-3',
      h: 'TRAPPER',
      n: 3,
      title: 'Drain',
      skill: 'Read pod spread across zones. Read a PodDisruptionBudget. Cordon and uncordon a node. Drain a node and read why it stops.',
      intro: [
        'The cluster needs a node upgrade. Before you drain a node, check how the web pods are spread, and what the budget allows.',
        'Read the pods and the budget, then try the drain. Expect it to stop.'
      ],
      concept: 'A **PodDisruptionBudget** limits how many pods of an app may be down at once. **Cordon** stops new pods from landing on a node. **Drain** cordons the node and evicts its pods, but it cannot evict a pod that a budget protects.',
      tasks: ['tra-t-10', 'tra-t-14', 'tra-t-11', 'tra-t-12', 'tra-t-13'],
      learned: [
        'Spread across zones is what keeps one zone outage from taking every replica.',
        'A PodDisruptionBudget is a rule for voluntary evictions, such as drain.',
        'A drain that stops is doing its job. Change the budget on purpose, not to get past it.'
      ],
      outro: [
        'Both web pods were in different zones, and the budget required two of them to stay up. The drain could not evict a pod without breaking that, so it stopped. Allowing one disruption in the budget let the drain go ahead.',
        'End of TRAPPER, for now. You can find why a pod is Pending, fix placement, and drain a node without taking the app down.'
      ],
      start: function () { return start({ manifest: MANIFEST_PLAIN, files: { '/work/shop/deployment.yaml': MANIFEST_PLAIN, '/work/shop/pdb.yaml': PDB_MIN, '/work/shop/fix/pdb.yaml': PDB_MAX, '/work/shop/README.md': README }, pdb: true }); }
    }
  ];
})());
