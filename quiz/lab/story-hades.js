// Hero 5 - HADES. Story in three chapters: Front Door, Targets, Readiness.
// Tasks are in lab/backlog/05-hades.js. Each chapter's start() builds its fixture.
window.LAB_CHAPTERS = (window.LAB_CHAPTERS || []).concat((function () {
  'use strict';

  var NS = 'shop';

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function deployment() {
    return {
      kind: 'Deployment',
      metadata: { name: 'web', namespace: NS, labels: { app: 'web' } },
      spec: {
        replicas: 2,
        selector: { matchLabels: { app: 'web' } },
        template: {
          metadata: { labels: { app: 'web' } },
          spec: {
            containers: [{
              name: 'web',
              image: 'shop/web:1.4',
              ports: [{ containerPort: 8080 }],
              readinessProbe: { httpGet: { path: '/healthz', port: 8080 } }
            }]
          }
        }
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

  // Pod A passed its probe earlier. Pod B is Running but not Ready. _serves is the path the app answers.
  function pod(name, ready) {
    return {
      kind: 'Pod',
      metadata: { name: name, namespace: NS, labels: { app: 'web' }, ownerReferences: [{ kind: 'ReplicaSet', name: 'web-7f9c' }] },
      spec: { containers: [{ name: 'web', image: 'shop/web:1.4', ports: [{ containerPort: 8080 }] }] },
      status: { phase: 'Running', ready: ready },
      _serves: '/health',
      _born: -4000,
      _t: 10
    };
  }

  function service(name, selector, clusterIP) {
    return {
      kind: 'Service',
      metadata: { name: name, namespace: NS, labels: { app: selector.app } },
      spec: { type: 'ClusterIP', clusterIP: clusterIP, selector: selector, ports: [{ port: 80, targetPort: 8080 }] },
      status: {},
      _born: -4000
    };
  }

  function ingressShopWeb() {
    return {
      kind: 'Ingress',
      metadata: { name: 'shop-web', namespace: NS, labels: { app: 'web' }, annotations: { 'alb.ingress.kubernetes.io/target-type': 'ip' } },
      spec: {
        ingressClassName: 'alb',
        rules: [{
          host: 'shop.example.com',
          http: { paths: [
            { path: '/', backend: 'web-svc:80' },
            { path: '/shop', backend: 'web-svc:80' },
            { path: '/admin', backend: 'admin-svc:80' }
          ] }
        }]
      },
      status: { loadBalancer: { ingress: [{ hostname: 'k8s-shop-1234.eu-west-1.elb.amazonaws.com' }] } },
      _cells: ['shop-web', 'alb', 'shop.example.com', 'k8s-shop-1234.eu-west-1.elb.amazonaws.com', '80'],
      _describe: [
        'Name:             shop-web',
        'Namespace:        shop',
        'Address:          k8s-shop-1234.eu-west-1.elb.amazonaws.com',
        'IngressClass:     alb',
        'Annotations:      alb.ingress.kubernetes.io/target-type: ip',
        'Rules:',
        '  Host                 Path     Backends',
        '  ----                 ----     --------',
        '  shop.example.com     /        web-svc:80',
        '                       /shop    web-svc:80',
        '                       /admin   admin-svc:80'
      ],
      _born: -4000
    };
  }

  function ingressShopLegacy() {
    return {
      kind: 'Ingress',
      metadata: { name: 'shop-legacy', namespace: NS, labels: { app: 'web' } },
      spec: {
        ingressClassName: 'nginx',
        rules: [{ host: 'shop.example.com', http: { paths: [{ path: '/old', backend: 'web-svc:80' }] } }]
      },
      status: { loadBalancer: { ingress: [{ hostname: 'ingress-nginx.example.net' }] } },
      _cells: ['shop-legacy', 'nginx', 'shop.example.com', 'ingress-nginx.example.net', '80'],
      _describe: [
        'Name:             shop-legacy',
        'Namespace:        shop',
        'Address:          ingress-nginx.example.net',
        'IngressClass:     nginx',
        'Rules:',
        '  Host                 Path     Backends',
        '  ----                 ----     --------',
        '  shop.example.com     /old     web-svc:80'
      ],
      _born: -3000
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
    '        readinessProbe:',
    '          httpGet:',
    '            path: /healthz',
    '            port: 8080',
    ''
  ].join('\n');

  // The fixed manifest: the probe asks for the path the app really serves.
  var FIX = MANIFEST.replace('path: /healthz', 'path: /health');

  var FILES = {
    '/work/shop/deployment.yaml': MANIFEST,
    '/work/shop/fix/deployment.yaml': FIX,
    '/work/shop/README.md': '# shop\n\nWeb replicas live in deployment.yaml. Ingress rules live in ingress.yaml. Git is the source of truth.\n'
  };

  function start() {
    return {
      files: clone(FILES),
      cwd: '/work',
      ns: NS,
      cluster: {
        objects: [
          deployment(), replicaSet(),
          pod('web-7f9c-k4x9q', true), pod('web-7f9c-m2v7w', false),
          service('web-svc', { app: 'web' }, '10.96.12.7'),
          service('admin-svc', { app: 'admin' }, '10.96.31.8'),
          ingressShopWeb(), ingressShopLegacy()
        ],
        events: [],
        suffixes: []
      }
    };
  }

  return [
    // ---------- Chapter 1 ----------
    {
      id: 'had-1',
      h: 'HADES',
      n: 1,
      title: 'Front Door',
      skill: 'List ingress objects. Read the rules and backends in describe. Count paths. Find every ingress for one host.',
      intro: [
        'Customers reach the shop through one address. Nothing in the pods explains a 502 yet, so start at the front door.',
        'Find the ingress objects in shop, then read which service each path goes to.'
      ],
      concept: 'An **Ingress** matches a **host** and a **path** and sends the request to a **backend** service. The service then sends it to its endpoints. Several ingresses can share one host, so check them all.',
      tasks: ['had-t-01', 'had-t-02', 'had-t-03', 'had-t-12'],
      learned: [
        'An ingress maps a host and a path to a backend service.',
        '`describe` lists the rules: host, path, and backend, in order.',
        'Several ingresses can share one host. Find them all before you change one.'
      ],
      outro: [
        'Two ingresses use shop.example.com. The request for /shop goes through shop-web to web-svc, so the front door is correct. The 502 starts further in.',
        'Next: follow the backend service to its endpoints.'
      ],
      start: start
    },

    // ---------- Chapter 2 ----------
    {
      id: 'had-2',
      h: 'HADES',
      n: 2,
      title: 'Targets',
      skill: 'Read endpoints of a service. Find services with no endpoints. Check READY on pods. Curl a health path through a port-forward.',
      intro: [
        'The 502 comes from the load balancer. Its target group sends traffic only to pods that the service reports as ready.',
        'Follow the backend. Check which services have endpoints, then look at the pods behind web-svc.'
      ],
      concept: 'A **target group** is built from the endpoints of a service. A pod that is not **Ready** has no endpoint, so the load balancer does not send it traffic. A path whose service has no endpoints gives a 502 at the edge.',
      tasks: ['had-t-04', 'had-t-13', 'had-t-05', 'had-t-06', 'had-t-07'],
      learned: [
        'A service with no endpoints has nothing to send traffic to.',
        'READY is the readiness of each pod. A pod can run and still be not Ready.',
        'A health path only answers when the app serves it. Check it with a port-forward and curl.'
      ],
      outro: [
        'The /admin path points at admin-svc, which has no pods. The web-svc has one ready pod out of two, and the health path /healthz answers 404, so the pod fails its probe.',
        'Next: fix the probe path in git and apply it.'
      ],
      start: start
    },

    // ---------- Chapter 3 ----------
    {
      id: 'had-3',
      h: 'HADES',
      n: 3,
      title: 'Readiness',
      skill: 'Read the ingress class, address, and target type. Fix a probe path in git and apply it. Write the cause of a 502.',
      intro: [
        'The ingress class and address look right. The one pod that is not Ready is the problem: its probe asks for a path the app does not serve.',
        'Read the ingress details for the record, then fix the probe in git and apply it.'
      ],
      concept: 'A **readiness probe** decides whether a pod gets traffic. If it asks for a path the app does not answer, the probe fails and the pod is never Ready, even when the process runs. Fix the path in the manifest, then apply it.',
      tasks: ['had-t-09', 'had-t-10', 'had-t-11', 'had-t-08', 'had-t-15'],
      learned: [
        'The ingress class, address and target type tell you how traffic enters the cluster.',
        'A readiness probe that asks for the wrong path keeps a healthy pod out of service.',
        'Write the 502 cause in terms of Ready and not Ready, not in terms of the load balancer.'
      ],
      outro: [
        'Both web pods are Ready now, and the target group sees two endpoints. The probe asked for /healthz, the app serves /health, so the fix was one path in git.',
        'End of HADES, for now. You can trace a request from the front door to a pod and see which step breaks.'
      ],
      start: start
    }
  ];
})());
