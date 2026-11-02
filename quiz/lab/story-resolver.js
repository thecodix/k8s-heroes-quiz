// Hero 4 - RESOLVER. Story in three chapters: Search Path, Lookup Order, Fix It.
// Tasks are in lab/backlog/04-resolver.js. Each chapter's start() builds its fixture.
window.LAB_CHAPTERS = (window.LAB_CHAPTERS || []).concat((function () {
  'use strict';

  var NS = 'shop';

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  // The cluster's DNS as a pod sees it. records are the names that exist; everything else is NXDOMAIN.
  var DNS = {
    nameserver: '10.96.0.10',
    search: ['shop.svc.cluster.local', 'svc.cluster.local', 'cluster.local', 'ec2.internal'],
    ndots: 5,
    records: {
      'web-svc.shop.svc.cluster.local': '10.96.12.7',
      'web-svc.payments.svc.cluster.local': '10.96.40.2',
      'api.example.com': '93.184.216.34'
    }
  };

  function deployment() {
    return {
      kind: 'Deployment',
      metadata: { name: 'web', namespace: NS, labels: { app: 'web' } },
      spec: {
        replicas: 2,
        selector: { matchLabels: { app: 'web' } },
        template: { metadata: { labels: { app: 'web' } }, spec: { containers: [{ name: 'web', image: 'shop/web:1.4', ports: [{ containerPort: 8080 }] }] } }
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

  function service() {
    return {
      kind: 'Service',
      metadata: { name: 'web-svc', namespace: NS, labels: { app: 'web' } },
      spec: { type: 'ClusterIP', clusterIP: '10.96.12.7', selector: { app: 'web' }, ports: [{ port: 80, targetPort: 8080 }] },
      status: {},
      _born: -4000
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
    ''
  ].join('\n');

  // The same manifest with the dnsConfig block that lowers ndots for the web pods.
  var FIX = MANIFEST + [
    '      dnsConfig:',
    '        options:',
    '        - name: ndots',
    '          value: "2"',
    ''
  ].join('\n');

  var FILES = {
    '/work/shop/deployment.yaml': MANIFEST,
    '/work/shop/fix/deployment.yaml': FIX,
    '/work/shop/README.md': '# shop\n\nWeb replicas live in deployment.yaml. Git is the source of truth.\n'
  };

  function start() {
    return {
      files: clone(FILES),
      cwd: '/work',
      ns: NS,
      dns: clone(DNS),
      cluster: {
        objects: [deployment(), replicaSet(), pod('web-7f9c-k4x9q'), pod('web-7f9c-m2v7w'), service()],
        events: [],
        suffixes: []
      }
    };
  }

  return [
    // ---------- Chapter 1 ----------
    {
      id: 'res-1',
      h: 'RESOLVER',
      n: 1,
      title: 'Search Path',
      skill: 'Read /etc/resolv.conf. Find the search list and ndots. Count the search domains.',
      intro: [
        'Checkout is slow for some customers. The web pods are healthy. Their logs show a call to an outside payment API that waits about two seconds before it starts, every time.',
        'The first question is what a pod asks DNS for. Start with the file that tells it where to ask.'
      ],
      concept: 'Each pod has a **resolver config** in `/etc/resolv.conf`. It lists the **search** domains and **ndots**. A name with fewer dots than ndots gets each search domain added, in order, and only then is tried as it is. Every wrong guess is a real query to DNS.',
      tasks: ['res-t-01', 'res-t-02', 'res-t-03', 'res-t-04'],
      learned: [
        '`/etc/resolv.conf` sets where a pod looks up names: the search list and ndots.',
        '**ndots** is how many dots a name needs before it is tried as it is first.',
        'Count the search domains before you guess how many queries a name costs.'
      ],
      outro: [
        'ndots is 5. A name like api.example.com has two dots, which is less than 5. The resolver adds every search domain first, and asks DNS for each wrong name before it asks for the real one.',
        'Next: count what a lookup actually sends, one query at a time.'
      ],
      start: start
    },

    // ---------- Chapter 2 ----------
    {
      id: 'res-2',
      h: 'RESOLVER',
      n: 2,
      title: 'Lookup Order',
      skill: 'Resolve a service name with nslookup. Trace the queries with dig. Count NXDOMAIN answers. Use a trailing dot.',
      intro: [
        'The search list works for a service inside the namespace. For an outside name, it means several wrong guesses before the right one.',
        'Ask DNS the way the pod does. nslookup gives the answer. dig shows each query on the way.'
      ],
      concept: '**NXDOMAIN** means the name does not exist. A failed query still costs a round trip to DNS, even when the right name answers in the end. `dig NAME +search +showsearch` lists every query in order. A name with a **trailing dot** is absolute: nothing is added to it.',
      tasks: ['res-t-05', 'res-t-06', 'res-t-07', 'res-t-08'],
      learned: [
        'Short names go through the search list, in order. The first match wins.',
        '`dig +search +showsearch` lists the queries in order. `nslookup` gives only the answer.',
        'NXDOMAIN is a failed query, and each one costs a round trip.',
        'A trailing dot makes a name absolute, so no search domain is added.'
      ],
      outro: [
        'api.example.com needed four NXDOMAIN answers before the real name. Each one was a round trip to DNS, on every outbound call. The trailing dot skips the search list entirely.',
        'Next: change the workload so its pods ask the right name first.'
      ],
      start: start
    },

    // ---------- Chapter 3 ----------
    {
      id: 'res-3',
      h: 'RESOLVER',
      n: 3,
      title: 'Fix It',
      skill: 'Set dnsConfig for one workload. Apply it. Measure the lookups again. Check that short names still resolve.',
      intro: [
        'You know what the lookups cost now. The fix belongs to the web workload, not to the cluster DNS. The manifest is in git, and a fix file is already in /work/shop/fix/.',
        'Lower ndots for the web pods, apply the change, then measure the lookups again.'
      ],
      concept: '**dnsConfig** in a pod template sets resolver options for that workload only, with `options` and a name and value. With **ndots** set to 2, a name with two dots is tried as it is first, so DNS gets fewer wrong guesses. Short names in the namespace still go through the search list.',
      tasks: ['res-t-09', 'res-t-10', 'res-t-11', 'res-t-12'],
      learned: [
        '`dnsConfig` sets resolver options for one workload, in the pod template.',
        'A lower ndots means fewer wrong guesses for outside names. Short names still search the namespace.',
        'Apply the change, then measure it from the pod. Do not trust the file alone.'
      ],
      outro: [
        'The lookup for api.example.com asks the real name first and gets its answer with no NXDOMAIN. The short name web-svc.payments still resolves through the search list, so cross-namespace calls keep working.',
        'In a real cluster the new template rolls out pod by pod, so measure from a new pod. This sandbox shows the change at once.'
      ],
      start: start
    }
  ];
})());
