// Hero 2 - LIFEGIVER. Story in three chapters: Pending, Not Ready, CrashLoop.
// Tasks are in lab/backlog/02-lifegiver.js. Each chapter's start() builds its fixture.
window.LAB_CHAPTERS = (window.LAB_CHAPTERS || []).concat((function () {
  'use strict';

  var NS = 'shop';

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function deployment() {
    return {
      kind: 'Deployment',
      metadata: { name: 'web', namespace: NS, labels: { app: 'web' } },
      spec: {
        replicas: 3,
        selector: { matchLabels: { app: 'web' } },
        template: { metadata: { labels: { app: 'web' } }, spec: { containers: [{ name: 'web', image: 'shop/web:1.4', ports: [{ containerPort: 8080 }] }] } }
      },
      status: {},
      _born: -4320
    };
  }

  function replicaSet(replicas) {
    return {
      kind: 'ReplicaSet',
      metadata: { name: 'web-7f9c', namespace: NS, labels: { app: 'web' }, ownerReferences: [{ kind: 'Deployment', name: 'web' }] },
      spec: { replicas: replicas, template: clone(deployment().spec.template) },
      status: {},
      _born: -4300
    };
  }

  // opts holds the pinned state: _phase, _reason, _notReady, _restarts, _last, _logs, _logsPrevious, _born, image
  function pod(name, opts) {
    opts = opts || {};
    var p = {
      kind: 'Pod',
      metadata: { name: name, namespace: NS, labels: { app: 'web' }, ownerReferences: [{ kind: 'ReplicaSet', name: 'web-7f9c' }] },
      spec: { containers: [{ name: 'web', image: opts.image || 'shop/web:1.4', ports: [{ containerPort: 8080 }] }] },
      status: opts._reason ? { phase: opts._phase || 'Pending', ready: false, reason: opts._reason } : { phase: 'Running', ready: !opts._notReady },
      _born: opts._born || -4000,
      _t: 10
    };
    Object.keys(opts).forEach(function (k) {
      if (k !== 'image' && k !== '_born') p[k] = clone(opts[k]);
    });
    return p;
  }

  function ev(ts, type, reason, object, from, message) {
    return { ts: ts, type: type, reason: reason, object: object, from: from, message: message };
  }

  var MANIFEST = [
    'apiVersion: apps/v1', 'kind: Deployment', 'metadata:', '  name: web', '  namespace: shop',
    '  labels:', '    app: web', 'spec:', '  replicas: 3', '  selector:', '    matchLabels:', '      app: web',
    '  template:', '    metadata:', '      labels:', '        app: web', '    spec:', '      containers:',
    '      - name: web', '        image: shop/web:1.4', '        ports:', '        - containerPort: 8080', ''
  ].join('\n');

  // The fix: the same manifest with DB_HOST set. Learners copy it over the old one with cp.
  var FIXED = MANIFEST.replace('        ports:', '        env:\n        - name: DB_HOST\n          value: db.shop\n        ports:');

  var FILES = {
    '/work/shop/deployment.yaml': MANIFEST,
    '/work/shop/fix/deployment.yaml': FIXED,
    '/work/shop/README.md': '# shop\n\nWeb replicas live in deployment.yaml. Git is the source of truth for this namespace.\n'
  };

  return [
    // ---------- Chapter 1 ----------
    {
      id: 'lif-1',
      h: 'LIFEGIVER',
      n: 1,
      title: 'Pending',
      skill: 'Read pod phases and reasons. Tell a phase (Pending) from a reason (ErrImagePull). Read events for a stuck container.',
      intro: [
        'The pager fires at 09:12. Two web pods are fine, but the third one has been stuck since the last release. It is not crashing. It has not started at all.',
        'Start with the list. Which pod is **not** Running, and what does its status say?'
      ],
      concept: 'A pod has a **phase** (Pending, Running, Succeeded, Failed) and a **reason** that says why it is stuck, such as `ErrImagePull`. The reason is what you read in the STATUS column. The **events** tell the story: what the kubelet tried, and what failed.',
      tasks: ['lif-t-01', 'lif-t-02', 'lif-t-03', 'lif-t-04'],
      learned: [
        'A pod in Pending has not started. The reason says why.',
        'The STATUS column shows the reason when there is one.',
        'Events are the timeline. Read them when the status is not enough.'
      ],
      outro: [
        'The pod could not pull its image. The tag 1.5 does not exist in the registry, so the kubelet kept retrying with a growing back-off.',
        'Pending plus a reason is a different problem from Running but not Ready. The next chapter covers that.'
      ],
      start: function () {
        return {
          files: clone(FILES),
          cwd: '/work',
          ns: NS,
          cluster: {
            objects: [
              deployment(), replicaSet(3),
              pod('web-7f9c-k4x9q', {}),
              pod('web-7f9c-m2v7w', {}),
              pod('web-7f9c-q5p1z', { image: 'shop/web:1.5', _phase: 'Pending', _reason: 'ErrImagePull', _t: 0, _born: -6 })
            ],
            events: [
              ev(-6, 'Normal', 'Pulling', 'pod/web-7f9c-q5p1z', 'kubelet', 'Pulling image "shop/web:1.5"'),
              ev(-6, 'Warning', 'Failed', 'pod/web-7f9c-q5p1z', 'kubelet', 'Failed to pull image "shop/web:1.5": not found'),
              ev(-5, 'Normal', 'BackOff', 'pod/web-7f9c-q5p1z', 'kubelet', 'Back-off pulling image "shop/web:1.5"')
            ],
            suffixes: []
          }
        };
      }
    },

    // ---------- Chapter 2 ----------
    {
      id: 'lif-2',
      h: 'LIFEGIVER',
      n: 2,
      title: 'Not Ready',
      skill: 'Tell Running from Ready. Read the Ready condition and a failed readiness probe in the events.',
      intro: [
        'The image is fixed. The release is rolling out, and now one pod is Running, but customers still get errors from it. Its READY column says 0/1.',
        'Running is not the same as serving. Find out why this pod is kept out of traffic.'
      ],
      concept: '**Running is not Ready.** A pod is Ready only when its **readiness probe** passes. A failed readiness probe takes the pod out of traffic, but it does **not** restart the pod. The **Ready condition** in `describe` and the **Unhealthy** events show why.',
      tasks: ['lif-t-05', 'lif-t-06', 'lif-t-07', 'lif-t-08'],
      learned: [
        'Running says the container started. Ready says it can serve.',
        'A failed readiness probe removes the pod from traffic and keeps it running.',
        '`describe` shows the Ready condition. Events show the probe result.'
      ],
      outro: [
        'The app answered the readiness probe with HTTP 503, so the pod was left out of traffic while it was still running. Two pods kept serving, so customers saw a slower store, not a dead one.',
        'Next: a pod that does not stay up at all.'
      ],
      start: function () {
        return {
          files: clone(FILES),
          cwd: '/work',
          ns: NS,
          cluster: {
            objects: [
              deployment(), replicaSet(3),
              pod('web-7f9c-k4x9q', {}),
              pod('web-7f9c-m2v7w', {}),
              pod('web-7f9c-r3t8x', { _notReady: true, _born: -12 })
            ],
            events: [
              ev(-12, 'Normal', 'Pulled', 'pod/web-7f9c-r3t8x', 'kubelet', 'Container image "shop/web:1.4" already present on machine'),
              ev(-9, 'Warning', 'Unhealthy', 'pod/web-7f9c-r3t8x', 'kubelet', 'Readiness probe failed: HTTP probe failed with statuscode: 503')
            ],
            suffixes: []
          }
        };
      }
    },

    // ---------- Chapter 3 ----------
    {
      id: 'lif-3',
      h: 'LIFEGIVER',
      n: 3,
      title: 'CrashLoop',
      skill: 'Read restart counts and the last termination. Use logs --previous to see the run that crashed. Fix config and apply.',
      intro: [
        'Last shift someone changed the config. Now one pod restarts again and again. Its status says **CrashLoopBackOff**.',
        'The logs of the run that is running right now are short. The clue is in the run that already crashed.'
      ],
      concept: '**CrashLoopBackOff** means the container keeps exiting, and the kubelet waits longer before each restart. `kubectl logs` shows the **current** run. **`kubectl logs --previous`** shows the run that crashed, which is usually where the error is. The **exit code** says how it died.',
      tasks: ['lif-t-09', 'lif-t-10', 'lif-t-11', 'lif-t-12', 'lif-t-13'],
      learned: [
        'RESTARTS above zero means the container has died before.',
        '`--previous` (or `-p`) shows the logs of the run that crashed.',
        'The exit code and the last state say how the container died.',
        'Fix the config in git, then apply the file. Copy the fix into place first.'
      ],
      outro: [
        'DB_HOST was missing from the manifest, so the app stopped on start. The fix lives in git now, and `apply` writes it into the Deployment. New pods start with the variable set.',
        'Two pods still serve traffic while the new ones roll out. You read a crash from the logs of the run that already died. That is the skill.'
      ],
      start: function () {
        return {
          files: clone(FILES),
          cwd: '/work',
          ns: NS,
          cluster: {
            objects: [
              deployment(), replicaSet(3),
              pod('web-7f9c-k4x9q', {}),
              pod('web-7f9c-m2v7w', {}),
              pod('web-7f9c-b6h2c', {
                _reason: 'CrashLoopBackOff', _phase: 'Running', _restarts: 4, _born: -40,
                _last: { reason: 'Error', exitCode: 1 },
                _logs: ['Starting web 1.4'],
                _logsPrevious: ['Starting web 1.4', 'Loading config', 'Error: DB_HOST is not set']
              })
            ],
            events: [
              ev(-3, 'Warning', 'BackOff', 'pod/web-7f9c-b6h2c', 'kubelet', 'Back-off restarting failed container web in pod web-7f9c-b6h2c'),
              ev(-1, 'Warning', 'BackOff', 'pod/web-7f9c-b6h2c', 'kubelet', 'Back-off restarting failed container web in pod web-7f9c-b6h2c')
            ],
            suffixes: []
          }
        };
      }
    }
  ];
})());
