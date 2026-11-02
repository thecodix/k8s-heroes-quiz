// Hero 6 - IRONCLAD. Story in three chapters: Requests and Limits, Out of Memory, CPU and Defaults.
// Tasks are in lab/backlog/06-ironclad.js. Each chapter's start() builds its fixture.
window.LAB_CHAPTERS = (window.LAB_CHAPTERS || []).concat((function () {
  'use strict';

  var NS = 'shop';

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function ev(ts, type, reason, object, from, message) {
    return { ts: ts, type: type, reason: reason, object: object, from: from, message: message };
  }

  // The web container sets requests and limits. The log-shipper sets requests only, so it is Burstable.
  function containers() {
    return [
      {
        name: 'web',
        image: 'shop/web:1.4',
        ports: [{ containerPort: 8080 }],
        resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '250m', memory: '256Mi' } }
      },
      {
        name: 'log-shipper',
        image: 'shop/log-shipper:0.9',
        resources: { requests: { cpu: '50m', memory: '64Mi' } }
      }
    ];
  }

  function deployment() {
    return {
      kind: 'Deployment',
      metadata: { name: 'web', namespace: NS, labels: { app: 'web' } },
      spec: {
        replicas: 2,
        selector: { matchLabels: { app: 'web' } },
        template: { metadata: { labels: { app: 'web' } }, spec: { containers: containers() } }
      },
      status: {},
      _born: -4320
    };
  }

  function replicaSet() {
    return {
      kind: 'ReplicaSet',
      metadata: { name: 'web-7f9c', namespace: NS, labels: { app: 'web' }, ownerReferences: [{ kind: 'Deployment', name: 'web' }] },
      spec: { replicas: 2, template: clone(deployment().spec.template) },
      status: {},
      _born: -4300
    };
  }

  // Pod A is healthy. Pod B was killed for memory and restarted three times.
  function podA() {
    return {
      kind: 'Pod',
      metadata: { name: 'web-7f9c-k4x9q', namespace: NS, labels: { app: 'web' }, ownerReferences: [{ kind: 'ReplicaSet', name: 'web-7f9c' }] },
      spec: { containers: containers() },
      status: { phase: 'Running', ready: true },
      _usage: { cpu: '240m', mem: '180Mi' },
      _born: -4000,
      _t: 10
    };
  }

  function podB() {
    return {
      kind: 'Pod',
      metadata: { name: 'web-7f9c-m2v7w', namespace: NS, labels: { app: 'web' }, ownerReferences: [{ kind: 'ReplicaSet', name: 'web-7f9c' }] },
      spec: { containers: containers() },
      status: { phase: 'Running', ready: true },
      _restarts: 3,
      _last: { reason: 'OOMKilled', exitCode: 137 },
      _usage: { cpu: '90m', mem: '250Mi' },
      _born: -4000,
      _t: 10
    };
  }

  function limitRange() {
    return {
      kind: 'LimitRange',
      metadata: { name: 'shop-defaults', namespace: NS },
      spec: { limits: [{ type: 'Container', default: { cpu: '500m', memory: '512Mi' }, defaultRequest: { cpu: '100m', memory: '128Mi' } }] },
      _cells: ['shop-defaults'],
      _describe: [
        'Name:         shop-defaults',
        'Namespace:    shop',
        'Type         Resource  Min  Max  Default Request  Default Limit',
        '----         --------  ---  ---  ---------------  -------------',
        'Container    cpu       -    -    100m             500m',
        'Container    memory    -    -    128Mi            512Mi'
      ],
      _born: -5000
    };
  }

  var MANIFEST = [
    'apiVersion: apps/v1',
    'kind: Deployment',
    'metadata:',
    '  name: web',
    '  namespace: shop',
    '  labels:',
    '    app: web',
    'spec:',
    '  replicas: 2',
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
    '        image: shop/web:1.4',
    '        ports:',
    '        - containerPort: 8080',
    '        resources:',
    '          requests:',
    '            cpu: 100m',
    '            memory: 128Mi',
    '          limits:',
    '            cpu: 250m',
    '            memory: 256Mi',
    '      - name: log-shipper',
    '        image: shop/log-shipper:0.9',
    '        resources:',
    '          requests:',
    '            cpu: 50m',
    '            memory: 64Mi',
    ''
  ].join('\n');

  // Chapter 2: only the memory limit changes.
  var MEMORY = MANIFEST.replace('memory: 256Mi', 'memory: 512Mi');

  // Chapter 1: requests equal limits in both containers, so every container is Guaranteed.
  var GUARANTEED = [
    'apiVersion: apps/v1',
    'kind: Deployment',
    'metadata:',
    '  name: web',
    '  namespace: shop',
    '  labels:',
    '    app: web',
    'spec:',
    '  replicas: 2',
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
    '        image: shop/web:1.4',
    '        ports:',
    '        - containerPort: 8080',
    '        resources:',
    '          requests:',
    '            cpu: 250m',
    '            memory: 256Mi',
    '          limits:',
    '            cpu: 250m',
    '            memory: 256Mi',
    '      - name: log-shipper',
    '        image: shop/log-shipper:0.9',
    '        resources:',
    '          requests:',
    '            cpu: 50m',
    '            memory: 64Mi',
    '          limits:',
    '            cpu: 50m',
    '            memory: 64Mi',
    ''
  ].join('\n');

  // Chapter 3: no CPU limit, memory limit 512Mi, CPU request kept.
  var FINAL = MANIFEST
    .replace('          limits:\n            cpu: 250m\n            memory: 256Mi', '          limits:\n            memory: 512Mi');

  var FILES = {
    '/work/shop/deployment.yaml': MANIFEST,
    '/work/shop/fix/memory.yaml': MEMORY,
    '/work/shop/fix/guaranteed.yaml': GUARANTEED,
    '/work/shop/fix/deployment.yaml': FINAL,
    '/work/shop/README.md': '# shop\n\nWeb replicas live in deployment.yaml. Git is the source of truth.\n'
  };

  var EVENTS = [
    ev(-1500, 'Warning', 'OOMKilling', 'pod/web-7f9c-m2v7w', 'kubelet', 'Memory cgroup out of memory: Killed process (web)'),
    ev(-300, 'Warning', 'OOMKilling', 'pod/web-7f9c-m2v7w', 'kubelet', 'Memory cgroup out of memory: Killed process (web)')
  ];

  function start(withEvents) {
    return {
      files: clone(FILES),
      cwd: '/work',
      ns: NS,
      cluster: {
        objects: [deployment(), replicaSet(), podA(), podB(), limitRange()],
        events: withEvents ? clone(EVENTS) : [],
        suffixes: []
      }
    };
  }

  return [
    // ---------- Chapter 1 ----------
    {
      id: 'iro-1',
      h: 'IRONCLAD',
      n: 1,
      title: 'Requests and Limits',
      skill: 'Read requests and limits per container in describe. Read the QoS class. Make a pod Guaranteed.',
      intro: [
        'The shop web pods keep getting moved to other nodes. The scheduler plans with requests, not with what the pods use. Start by reading what the pods ask for.',
        'Describe one web pod. Each container lists its own requests and limits.'
      ],
      concept: '**Requests** are what the scheduler reserves for a container. **Limits** are the most it may use. The **QoS class** follows from them: **Guaranteed** when every container sets limits equal to requests, **Burstable** when some are set, **BestEffort** when none are.',
      tasks: ['iro-t-01', 'iro-t-02', 'iro-t-03', 'iro-t-12'],
      learned: [
        'Requests are reserved on a node. Limits cap what a container may use.',
        'Read requests and limits per container. One pod can hold a container with no limit.',
        'The QoS class is one word at the bottom of describe, and it follows from the numbers.'
      ],
      outro: [
        'The web container has requests and limits, but log-shipper has no limit, so the pod was Burstable. Setting limits equal to requests in both containers made the pod Guaranteed.',
        'Next: find out what a pod does when it runs past its memory limit.'
      ],
      start: function () { return start(false); }
    },

    // ---------- Chapter 2 ----------
    {
      id: 'iro-2',
      h: 'IRONCLAD',
      n: 2,
      title: 'Out of Memory',
      skill: 'Read Last State, the exit code and the restart count in describe. Find OOMKilled events. Raise a memory limit and apply it.',
      intro: [
        'Pod web-7f9c-m2v7w keeps restarting, and the pager says nothing about the cause. A restart with no error in the app usually means the kernel stopped the container.',
        'Read what the last run of the container ended with, then read the events.'
      ],
      concept: 'A container that uses more memory than its limit is killed by the kernel. The pod shows **Last State: Terminated**, with reason **OOMKilled** and exit code **137** (128 plus SIGKILL). The **restart count** grows each time it happens.',
      tasks: ['iro-t-04', 'iro-t-05', 'iro-t-13', 'iro-t-07', 'iro-t-06'],
      learned: [
        'OOMKilled and exit code 137 mean the kernel killed the container for memory.',
        'Restart count tells you how often it happened. The events tell you when.',
        'Raise the memory limit in git, then apply the change.'
      ],
      outro: [
        'The web container used more memory than its 256Mi limit. The kernel killed it three times, and each kill showed up as an OOMKilling event. Raising the limit to 512Mi in git and applying it fixed the restarts.',
        'Next: check live use and CPU, and find the namespace defaults.'
      ],
      start: function () { return start(true); }
    },

    // ---------- Chapter 3 ----------
    {
      id: 'iro-3',
      h: 'IRONCLAD',
      n: 3,
      title: 'CPU and Defaults',
      skill: 'Read live usage with kubectl top. Compare usage with a CPU limit. Sum requests. Read a LimitRange.',
      intro: [
        'Memory is fixed. Now the CPU side: one pod seems slow even though the node has room. Check what the pods use right now.',
        'Use top for live numbers, then compare them with what describe says each pod may use.'
      ],
      concept: 'A **CPU limit** does not kill a container. The kernel **throttles** it: the container waits for its next slice even when the node is idle. A **LimitRange** in a namespace sets defaults for containers that set no limits of their own.',
      tasks: ['iro-t-08', 'iro-t-09', 'iro-t-10', 'iro-t-11', 'iro-t-15'],
      learned: [
        '`kubectl top` shows live CPU and memory use per pod.',
        'Usage close to a CPU limit gets throttled, which shows up as slowness and not as a restart.',
        'A LimitRange sets defaults for the namespace. Read it when a container has no limit.'
      ],
      outro: [
        'Pod web-7f9c-k4x9q used 240m of its 250m CPU limit, so it was throttled. Removing the CPU limit and keeping the request lets the container use idle CPU, and the memory limit stays at 512Mi.',
        'End of IRONCLAD, for now. You can read requests, limits, QoS, OOM kills and throttling from describe and top.'
      ],
      start: function () { return start(true); }
    }
  ];
})());
