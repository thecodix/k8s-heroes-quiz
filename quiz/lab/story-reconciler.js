// Hero 1 - RECONCILER. A story in three chapters: The Gap, Owners, The Drift.
// Tasks are not defined here. Each chapter lists task ids from lab/backlog/01-reconciler.js.
// Each chapter's start() builds the fixture the terminal begins with.
window.LAB_CHAPTERS = (window.LAB_CHAPTERS || []).concat((function () {
  'use strict';

  var NS = 'shop';

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function deployment(replicas) {
    return {
      kind: 'Deployment',
      metadata: { name: 'web', namespace: NS, labels: { app: 'web' } },
      spec: {
        replicas: replicas,
        selector: { matchLabels: { app: 'web' } },
        template: {
          metadata: { labels: { app: 'web' } },
          spec: { containers: [{ name: 'web', image: 'shop/web:1.4', ports: [{ containerPort: 8080 }] }] }
        }
      },
      status: {},
      _born: -4320
    };
  }

  function replicaSet(replicas, dep) {
    return {
      kind: 'ReplicaSet',
      metadata: { name: 'web-7f9c', namespace: NS, labels: { app: 'web' }, ownerReferences: [{ kind: 'Deployment', name: 'web' }] },
      spec: { replicas: replicas, template: clone(dep.spec.template) },
      status: {},
      _born: -4300
    };
  }

  function pod(name, born) {
    return {
      kind: 'Pod',
      metadata: { name: name, namespace: NS, labels: { app: 'web' }, ownerReferences: [{ kind: 'ReplicaSet', name: 'web-7f9c' }] },
      spec: { containers: [{ name: 'web', image: 'shop/web:1.4', ports: [{ containerPort: 8080 }] }] },
      status: { phase: 'Running', ready: true },
      _born: born,
      _t: 10
    };
  }

  function ev(ts, type, reason, object, from, message) {
    return { ts: ts, type: type, reason: reason, object: object, from: from, message: message };
  }

  // The manifest in git. It always says 3 replicas.
  var MANIFEST = [
    'apiVersion: apps/v1',
    'kind: Deployment',
    'metadata:',
    '  name: web',
    '  namespace: shop',
    '  labels:',
    '    app: web',
    'spec:',
    '  replicas: 3',
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

  var GIT_FILES = {
    '/work/shop/deployment.yaml': MANIFEST,
    '/work/shop/README.md': '# shop\n\nWeb replicas live in deployment.yaml. Git is the source of truth for this namespace.\n'
  };

  // Events that happened before the chapter starts.
  var EARLIER = [
    ev(-4000, 'Normal', 'SuccessfulCreate', 'replicaset/web-7f9c', 'replicaset-controller', 'Created pod: web-7f9c-k4x9q'),
    ev(-4000, 'Normal', 'SuccessfulCreate', 'replicaset/web-7f9c', 'replicaset-controller', 'Created pod: web-7f9c-m2v7w'),
    ev(-4000, 'Normal', 'SuccessfulCreate', 'replicaset/web-7f9c', 'replicaset-controller', 'Created pod: web-7f9c-r8t1z')
  ];
  var EVICTION = ev(-2, 'Normal', 'Killing', 'pod/web-7f9c-r8t1z', 'kubelet', 'Stopping container web (node eviction from ip-10-0-3-17)');

  return [
    // ---------- Chapter 1 ----------
    {
      id: 'rec-1',
      h: 'RECONCILER',
      n: 1,
      title: 'The Gap',
      skill: 'Read desired vs actual state. Watch a controller close a gap one step at a time.',
      intro: [
        'The pager fires at 02:14. The shop web store says 2 of 3 available. You are the on-call engineer for the shop namespace, and the first thing you need to know is whether this is a fire or a gap.',
        'The web app is declared in git: /work/shop/deployment.yaml. The cluster is where it runs. Compare the two.'
      ],
      concept: 'A controller runs a **loop**. It reads the **desired state** (what the spec asks for), reads the **actual state** (what exists), acts to close the difference, and repeats. Nothing is done once. **The loop never stops.**',
      tasks: ['rec-t-01', 'rec-t-02', 'rec-t-03'],
      learned: [
        'Desired state is what you wrote down. Actual state is what runs.',
        'The READY column (ready/desired) is the gap in one number.',
        'The loop closes gaps without anyone typing a fix. Watch it, do not panic.'
      ],
      outro: [
        'The third pod came back by itself. Nobody typed a fix. The loop compared 3 (git) with 2 (cluster), made a pod, and waited for it to be ready.',
        'But something opened the gap in the first place. The events may say what.'
      ],
      start: function () {
        var d = deployment(3);
        return {
          files: clone(GIT_FILES),
          cwd: '/work',
          ns: NS,
          cluster: {
            objects: [d, replicaSet(3, d), pod('web-7f9c-k4x9q', -4000), pod('web-7f9c-m2v7w', -4000)],
            events: clone(EARLIER.concat([EVICTION])),
            suffixes: ['p7d3c', 'zz1']
          }
        };
      }
    },

    // ---------- Chapter 2 ----------
    {
      id: 'rec-2',
      h: 'RECONCILER',
      n: 2,
      title: 'Owners',
      skill: 'Read events. Follow an owner chain (pod to ReplicaSet to Deployment). Change actual state and watch the loop answer.',
      intro: [
        'The gap is closed. The events show what happened: at 01:58 a node was drained, and a web pod was evicted. A new pod, p7d3c, was created in its place.',
        'Who created the new pod? And if you delete a pod on purpose, what happens to the count?'
      ],
      concept: 'Pods have **owners**. A ReplicaSet creates pods and keeps the count. A Deployment owns the ReplicaSet. The owner is recorded in `ownerReferences`, and `describe` shows it as `Controlled By`. **Deleting a pod changes actual state, not desired state**, so the loop makes a new one.',
      tasks: ['rec-t-04', 'rec-t-05', 'rec-t-06'],
      learned: [
        'Pods are owned: pod, then ReplicaSet, then Deployment.',
        'describe shows "Controlled By". ownerReferences is the same fact in YAML.',
        'Deleting a pod does not lower the desired count. The loop replaces it.'
      ],
      outro: [
        'You know who creates pods now. The ReplicaSet owns them, and the Deployment owns the ReplicaSet.',
        'Deleting a pod changed the actual count for one tick. The loop changed it back. That is the loop, working.'
      ],
      start: function () {
        var d = deployment(3);
        return {
          files: clone(GIT_FILES),
          cwd: '/work',
          ns: NS,
          cluster: {
            objects: [d, replicaSet(3, d), pod('web-7f9c-k4x9q', -4000), pod('web-7f9c-m2v7w', -4000), pod('web-7f9c-p7d3c', -1)],
            events: clone(EARLIER.concat([EVICTION, ev(-1, 'Normal', 'SuccessfulCreate', 'replicaset/web-7f9c', 'replicaset-controller', 'Created pod: web-7f9c-p7d3c')])),
            suffixes: ['q9r2e']
          }
        };
      }
    },

    // ---------- Chapter 3 ----------
    {
      id: 'rec-3',
      h: 'RECONCILER',
      n: 3,
      title: 'The Drift',
      skill: 'Find drift between git and the cluster. Restore desired state with apply, not scale. Write down what you did.',
      intro: [
        'It is 02:40. Before you go back to bed you check the rest of the namespace. The web Deployment says 5 replicas. Git says 3.',
        'Someone scaled it by hand at 01:40 for a flash sale. The sale ended at 02:00. The sale note is in the same folder.'
      ],
      concept: '`kubectl scale` changes the **desired state in the cluster only**. Git still says 3, so the two now disagree, and the next sync from git will fight you. **`kubectl apply -f` writes the file\'s desired state into the cluster.** Then the loop removes the extra pods, one per tick.',
      tasks: ['rec-t-07', 'rec-t-08', 'rec-t-09', 'rec-t-10', 'rec-t-11'],
      learned: [
        'Drift: the cluster and git disagree about desired state.',
        'Git is the source of truth. kubectl apply -f makes the cluster match a file.',
        'Scaling down happens one pod per tick. Wait for the count, not just the spec.',
        'An incident note says what the desired state is and where it lives.'
      ],
      outro: [
        'The Reconciler never tried to be clever. It made the cluster match whatever the Deployment said. The real question was never what the loop does. It was which desired state is correct, and where it is written down.',
        'The store is green. The note is written. The loop was never the problem.',
        'End of chapter three, and the end of The Reconciler. Next: LIFEGIVER, the pod that would not start.'
      ],
      start: function () {
        var d = deployment(5);
        var extra = {
          '/work/shop/SALE-NOTE.txt': 'Flash sale 00:00-02:00.\nScaled web to 5 by hand at 01:40 so checkout would not queue.\nSale ended 02:00. Git says 3 replicas. Put the cluster back to what git says.\n'
        };
        var files = clone(GIT_FILES);
        Object.keys(extra).forEach(function (k) { files[k] = extra[k]; });
        return {
          files: files,
          cwd: '/work',
          ns: NS,
          cluster: {
            objects: [
              d,
              replicaSet(5, d),
              pod('web-7f9c-k4x9q', -4000),
              pod('web-7f9c-m2v7w', -4000),
              pod('web-7f9c-p7d3c', -1),
              pod('web-7f9c-h2w8k', -20),
              pod('web-7f9c-n6c4d', -20)
            ],
            events: clone(EARLIER.concat([
              EVICTION,
              ev(-1, 'Normal', 'SuccessfulCreate', 'replicaset/web-7f9c', 'replicaset-controller', 'Created pod: web-7f9c-p7d3c'),
              ev(-21, 'Normal', 'ScalingReplicaSet', 'deployment/web', 'deployment-controller', 'Scaled up replica set web-7f9c to 5'),
              ev(-20, 'Normal', 'SuccessfulCreate', 'replicaset/web-7f9c', 'replicaset-controller', 'Created pod: web-7f9c-h2w8k'),
              ev(-20, 'Normal', 'SuccessfulCreate', 'replicaset/web-7f9c', 'replicaset-controller', 'Created pod: web-7f9c-n6c4d')
            ])),
            suffixes: []
          }
        };
      }
    }
  ];
})());
