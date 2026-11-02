// Hero 8 - CARPENTER. Story in three chapters: Scale Targets, Rollouts, Scalers.
// Tasks are in lab/backlog/08-carpenter.js. Each chapter's start() builds its fixture.
window.LAB_CHAPTERS = (window.LAB_CHAPTERS || []).concat((function () {
  'use strict';

  var NS = 'shop';
  var YAML = window.LabEngine;

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function ev(ts, type, reason, object, from, message) {
    return { ts: ts, type: type, reason: reason, object: object, from: from, message: message };
  }

  // The web Deployment as git holds it. The image is the one revision 2 runs.
  function manifest(image) {
    return [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: web',
      '  namespace: shop',
      '  labels:',
      '    app: web',
      'spec:',
      '  replicas: 3',
      '  strategy:',
      '    rollingUpdate:',
      '      maxSurge: 25%',
      '      maxUnavailable: 25%',
      '  selector:',
      '    matchLabels:',
      '      app: web',
      '  template:',
      '    metadata:',
      '      labels:',
      '        app: web',
      '    spec:',
      '      containers:',
      '      - name: web',
      '        image: ' + image,
      '        ports:',
      '        - containerPort: 8080',
      ''
    ].join('\n');
  }

  var MANIFEST = manifest('shop/web:1.4');
  var PREVIOUS = manifest('shop/web:1.3');

  function deployment(name, text, extra) {
    var spec = YAML.parseYaml(text).spec;
    var d = { kind: 'Deployment', metadata: { name: name, namespace: NS, labels: { app: name } }, spec: spec, status: {}, _born: -4320 };
    Object.keys(extra || {}).forEach(function (k) { d[k] = extra[k]; });
    return d;
  }

  function replicaSet(d, name) {
    return {
      kind: 'ReplicaSet',
      metadata: { name: name, namespace: NS, labels: { app: 'web' }, ownerReferences: [{ kind: 'Deployment', name: 'web' }] },
      spec: { replicas: d.spec.replicas, template: clone(d.spec.template) },
      status: {},
      _born: -4300
    };
  }

  function pod(name) {
    return {
      kind: 'Pod',
      metadata: { name: name, namespace: NS, labels: { app: 'web' }, ownerReferences: [{ kind: 'ReplicaSet', name: 'web-7f9c' }] },
      spec: { containers: [{ name: 'web', image: 'shop/web:1.4', ports: [{ containerPort: 8080 }] }] },
      status: { phase: 'Running', ready: true },
      _born: -4000,
      _t: 10
    };
  }

  // HPA: CPU at 62% of a 70% target, between 2 and 6 replicas.
  function hpa() {
    return {
      kind: 'HPA',
      metadata: { name: 'web', namespace: NS, labels: { app: 'web' } },
      spec: { scaleTargetRef: { kind: 'Deployment', name: 'web' }, minReplicas: 2, maxReplicas: 6 },
      _cells: ['web', 'Deployment/web', '62%/70%', '2', '6', '3'],
      _describe: [
        'Name:                                                  web',
        'Namespace:                                             shop',
        'Reference:                                             Deployment/web',
        'Metrics:                                               ( current / target )',
        '  resource cpu on pods  (as a percentage of request):  62% (current) / 70% (target)',
        'Min replicas:                                          2',
        'Max replicas:                                          6',
        'Deployment pods:                                       3 current / 3 desired'
      ],
      _born: -4000
    };
  }

  // KEDA: scales web from a queue. Minimum 0 means it can scale to zero.
  function scaledObject() {
    return {
      kind: 'ScaledObject',
      metadata: { name: 'web-queue', namespace: NS, labels: { app: 'web' } },
      spec: {
        scaleTargetRef: { name: 'web' },
        minReplicaCount: 0,
        maxReplicaCount: 20,
        triggers: [{ type: 'aws-sqs-queue', metadata: { queueLength: '5' } }]
      },
      _cells: ['web-queue', 'Deployment/web', 'aws-sqs-queue', '0', '20'],
      _describe: [
        'Name:           web-queue',
        'Namespace:      shop',
        'Scale Target:   Deployment/web',
        'Min Replicas:   0',
        'Max Replicas:   20',
        'Triggers:',
        '  Type:         aws-sqs-queue',
        '  Queue Length: 5'
      ],
      _born: -3000
    };
  }

  // Karpenter NodeClaims: cluster-wide. The newer one was launched for pending web pods.
  function nodeClaim(name, node, born) {
    return {
      kind: 'NodeClaim',
      metadata: { name: name },
      spec: { nodeClassRef: { name: 'default' } },
      _cells: [name, 'default', node, 'True'],
      _describe: ['Name:         ' + name, 'Node Class:   default', 'Node:         ' + node],
      _born: born
    };
  }

  function nodeClaims() {
    return [
      nodeClaim('default-7x2kq', 'ip-10-0-4-12.eu-west-1.compute.internal', -3000),
      nodeClaim('default-p9m4z', 'ip-10-0-5-40.eu-west-1.compute.internal', -400)
    ];
  }

  // Revision 1 ran the previous image; revision 2 is the one live now.
  function revisions() {
    return [
      { rev: 1, template: clone(YAML.parseYaml(PREVIOUS).spec.template), cause: '<none>' },
      { rev: 2, template: clone(YAML.parseYaml(MANIFEST).spec.template), cause: '<none>' }
    ];
  }

  function webObjects(extra) {
    var d = deployment('web', MANIFEST, extra);
    return [d, replicaSet(d, 'web-7f9c'), pod('web-7f9c-k4x9q'), pod('web-7f9c-m2v7w'), pod('web-7f9c-r8t1z')];
  }

  function start(objs, events, files) {
    return {
      files: clone(files),
      cwd: '/work',
      ns: NS,
      cluster: { objects: objs, events: events ? clone(events) : [], suffixes: [] }
    };
  }

  var FILES = {
    '/work/shop/deployment.yaml': MANIFEST,
    '/work/shop/README.md': '# shop\n\nWeb replicas live in deployment.yaml. Git is the source of truth.\n'
  };

  return [
    // ---------- Chapter 1 ----------
    {
      id: 'car-1',
      h: 'CARPENTER',
      n: 1,
      title: 'Scale Targets',
      skill: 'Find an HPA. Read its target, current CPU, and min and max replicas. Find the object it scales.',
      intro: [
        'The web store is busy in the evening. The pods scale up, but nobody can say what triggers it. The autoscaler is in the cluster already.',
        'Find the HorizontalPodAutoscaler, then read what it aims for and what it scales.'
      ],
      concept: 'A **HorizontalPodAutoscaler** (HPA) changes the replica count of a target, such as a Deployment. It compares the **current** metric with the **target** and keeps the count between **minReplicas** and **maxReplicas**.',
      tasks: ['car-t-01', 'car-t-02', 'car-t-03', 'car-t-14'],
      learned: [
        'An HPA compares current with target, and keeps the count between min and max.',
        'The TARGETS column reads current over target.',
        'An HPA scales one object. Its reference names it.'
      ],
      outro: [
        'The HPA aims for 70% CPU and sits at 62%, so it keeps the three web pods. It may go between 2 and 6 replicas, and it scales the Deployment web.',
        'Next: roll the Deployment back and read what a rollout changed.'
      ],
      start: function () {
        return start(webObjects({}).concat([hpa()]), [], FILES);
      }
    },

    // ---------- Chapter 2 ----------
    {
      id: 'car-2',
      h: 'CARPENTER',
      n: 2,
      title: 'Rollouts',
      skill: 'Read rollout history. Undo a rollout. Read the strategy. Find a rollout that is waiting.',
      intro: [
        'The last deploy of web broke the checkout. The fix is to go back. Before you do, check what the history says and how the rollout replaces pods.',
        'Read the history, undo the last rollout, then check the strategy and look for a rollout that is stuck.'
      ],
      concept: 'Each change to a Deployment template is a **revision**. `rollout history` lists them. `rollout undo` makes the previous template live again, as a new revision. The **strategy** sets **maxSurge** (extra pods allowed during a rollout) and **maxUnavailable** (pods allowed down).',
      tasks: ['car-t-04', 'car-t-05', 'car-t-06', 'car-t-07', 'car-t-08'],
      learned: [
        '`rollout history` lists the revisions. Each change to the template makes one.',
        '`rollout undo` makes the previous template live again, as a new revision.',
        'maxSurge and maxUnavailable decide how a rollout replaces pods.',
        '`rollout status` says Waiting when the new pods are not ready yet.'
      ],
      outro: [
        'The undo put the image of revision 1 back, as revision 3. The strategy lets one more pod than desired run during a rollout. The search deployment is still waiting for its new pods, and rollout status says so.',
        'Next: the scalers that KEDA and Karpenter add to the cluster.'
      ],
      start: function () {
        var d = deployment('web', MANIFEST, { _revisions: revisions() });
        var search = deployment('search', manifest('shop/search:2.0').replace(/web/g, 'search'), { _stuck: true });
        return start([d, replicaSet(d, 'web-7f9c'), pod('web-7f9c-k4x9q'), pod('web-7f9c-m2v7w'), pod('web-7f9c-r8t1z'), search], [], FILES);
      }
    },

    // ---------- Chapter 3 ----------
    {
      id: 'car-3',
      h: 'CARPENTER',
      n: 3,
      title: 'Scalers',
      skill: 'Find a KEDA ScaledObject and read its trigger. Count Karpenter NodeClaims. Find the event that added a node.',
      intro: [
        'The queue backlog grew at night, and the cluster added a node on its own. Nobody on the team asked for it. Two other kinds of scaler are running here.',
        'Read the ScaledObject for the queue, then count the NodeClaims and find the event that launched the newest node.'
      ],
      concept: 'A **ScaledObject** (KEDA) scales a target from an external trigger, such as a queue. It can go to zero. **NodeClaims** (Karpenter) are requests for nodes: each one launches a node for pods that cannot be placed.',
      tasks: ['car-t-09', 'car-t-10', 'car-t-11', 'car-t-12'],
      learned: [
        'A ScaledObject scales from a trigger, not from CPU. Its trigger type says what it watches.',
        'A NodeClaim is a node that Karpenter asked for. Events say which pods caused it.',
        'Read which scaler owns each count before you change one.'
      ],
      outro: [
        'The queue trigger scaled the web pods, and the pods that could not fit caused a new NodeClaim. The event names the reason, and the node joined the cluster.',
        'End of CARPENTER, for now. You can read HPA targets, roll back a bad deploy, and trace where new nodes come from.'
      ],
      start: function () {
        var objs = webObjects({}).concat([hpa(), scaledObject()], nodeClaims());
        var events = [ev(-400, 'Normal', 'Launched', 'nodeclaim/default-p9m4z', 'karpenter', 'Launched instance m6i.large for pending pods of web')];
        return start(objs, events, FILES);
      }
    }
  ];
})());
