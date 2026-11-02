// Hero 3 - RELAY. Story in three chapters: No Answer, Ports, Reach It.
// Tasks are in lab/backlog/03-relay.js. Each chapter's start() builds its fixture.
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

  function pod(name, opts) {
    opts = opts || {};
    return {
      kind: 'Pod',
      metadata: { name: name, namespace: NS, labels: { app: 'web' }, ownerReferences: [{ kind: 'ReplicaSet', name: 'web-7f9c' }] },
      spec: { containers: [{ name: 'web', image: 'shop/web:1.4', ports: [{ containerPort: 8080 }] }] },
      status: opts._reason ? { phase: opts._phase || 'Pending', ready: false, reason: opts._reason } : { phase: 'Running', ready: !opts._notReady },
      _born: -4000,
      _t: 10
    };
  }

  // A Service as the cluster stores it. The selector and ports are what chapters change.
  function service(selector, port, targetPort) {
    return {
      kind: 'Service',
      metadata: { name: 'web-svc', namespace: NS, labels: { app: 'web' } },
      spec: {
        type: 'ClusterIP',
        clusterIP: '10.96.12.7',
        selector: selector,
        ports: [{ port: port, targetPort: targetPort }]
      },
      status: {},
      _born: -4000
    };
  }

  var SERVICE_YAML = function (selector, targetPort) {
    return [
      'apiVersion: v1',
      'kind: Service',
      'metadata:',
      '  name: web-svc',
      '  namespace: shop',
      'spec:',
      '  selector:',
      '    app: ' + selector,
      '  ports:',
      '  - port: 80',
      '    targetPort: ' + targetPort,
      ''
    ].join('\n');
  };

  var FILES = {
    '/work/shop/service.yaml': SERVICE_YAML('web-api', 8080),
    '/work/shop/fix/service.yaml': SERVICE_YAML('web', 8080),
    '/work/shop/README.md': '# shop\n\nWeb replicas live in deployment.yaml. Services live in service.yaml. Git is the source of truth.\n'
  };

  return [
    // ---------- Chapter 1 ----------
    {
      id: 'rel-1',
      h: 'RELAY',
      n: 1,
      title: 'No Answer',
      skill: 'Read services and endpoints. Compare a selector with pod labels. Fix the selector and apply it.',
      intro: [
        'A customer reports that the web store does not answer. The pods look healthy, and the service web-svc exists.',
        'Nothing is answering through the service. Start with the list of services, then ask the question that matters: which pods are behind it?'
      ],
      concept: 'A **Service** sends traffic to the pods whose labels match its **selector**. The matching ready pods are its **endpoints**. **No endpoints means no traffic**, even when the pods run fine.',
      tasks: ['rel-t-01', 'rel-t-02', 'rel-t-03', 'rel-t-04', 'rel-t-05'],
      learned: [
        'A Service finds its pods with labels, through the selector.',
        '`<none>` in the endpoints list means nothing is behind the service.',
        'Fix the selector in git, then apply the file.'
      ],
      outro: [
        'The selector asked for app=web-api, and the pods are labelled app=web. Nothing matched, so there were no endpoints. The fix is in git, and the endpoints now list both pods.',
        'Next: the service has pods behind it, but the port is still wrong.'
      ],
      start: function () {
        return {
          files: clone(FILES),
          cwd: '/work',
          ns: NS,
          cluster: {
            objects: [deployment(), replicaSet(), pod('web-7f9c-k4x9q'), pod('web-7f9c-m2v7w'), service({ app: 'web-api' }, 80, 8080)],
            events: [],
            suffixes: []
          }
        };
      }
    },

    // ---------- Chapter 2 ----------
    {
      id: 'rel-2',
      h: 'RELAY',
      n: 2,
      title: 'Ports',
      skill: 'Tell port from targetPort. Read the target port in describe and in the endpoints. Fix a port in git and apply it.',
      intro: [
        'The selector matches now, and traffic reaches the pods. The store still fails. The pods are listening on a different port than the service sends to.',
        'Find the two port numbers the service uses, and compare them with the container.'
      ],
      concept: 'A Service has a **port** (the number clients use) and a **targetPort** (the number on the pod that receives the traffic). If the **targetPort** is wrong, the traffic arrives and nothing answers. `describe` shows both, and the endpoints show the target port.',
      tasks: ['rel-t-06', 'rel-t-07', 'rel-t-08'],
      learned: [
        '**port** is what clients call. **targetPort** is what the pod listens on.',
        '`describe svc` shows both numbers. The endpoints show the target port.',
        'Check the container port before you change a targetPort.'
      ],
      outro: [
        'The service sent traffic to port 80 on the pods. The app listens on 8080. Once the targetPort pointed at 8080, the endpoints used the right port.',
        'Next: check the whole path the way a customer does.'
      ],
      start: function () {
        return {
          files: clone(FILES),
          cwd: '/work',
          ns: NS,
          cluster: {
            objects: [deployment(), replicaSet(), pod('web-7f9c-k4x9q'), pod('web-7f9c-m2v7w'), service({ app: 'web' }, 80, 80)],
            events: [],
            suffixes: []
          }
        };
      }
    },

    // ---------- Chapter 3 ----------
    {
      id: 'rel-3',
      h: 'RELAY',
      n: 3,
      title: 'Reach It',
      skill: 'Forward a local port to a service. Call it with curl. Read the service type and its in-cluster DNS name.',
      intro: [
        'Before you call the incident fixed, check the service the way a customer would. You do not have a load balancer in front of it, so you open your own door.',
        'Forward a local port to the service, then call it.'
      ],
      concept: '`kubectl port-forward svc/<name> <local>:<port>` opens a tunnel from your machine into a Service. **`curl localhost:<local>`** then tests the whole path: Service, endpoints, pod and port. **HTTP 200** means the path works.',
      tasks: ['rel-t-09', 'rel-t-10', 'rel-t-11', 'rel-t-12'],
      learned: [
        '`port-forward` links a local port to a Service for testing.',
        '`curl` through the tunnel tests the path a user would take.',
        'Service type says how it is reached. ClusterIP is inside the cluster only.',
        'Inside the cluster, a service has a DNS name: name.namespace.svc.'
      ],
      outro: [
        'The service answers with HTTP 200 through the tunnel. The path is Service, endpoints, pod, port, and every step works now.',
        'End of RELAY, for now. You know how a service finds its pods, which port it uses, and how to test the whole path.'
      ],
      start: function () {
        return {
          files: clone(FILES),
          cwd: '/work',
          ns: NS,
          cluster: {
            objects: [deployment(), replicaSet(), pod('web-7f9c-k4x9q'), pod('web-7f9c-m2v7w'), service({ app: 'web' }, 80, 8080)],
            events: [],
            suffixes: []
          }
        };
      }
    }
  ];
})());
