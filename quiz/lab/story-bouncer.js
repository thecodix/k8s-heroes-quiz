// Hero 9 - BOUNCER. Story in three chapters: Who Can Do What, Secrets, Pod Security.
// Tasks are in lab/backlog/09-bouncer.js. Each chapter's start() builds its fixture.
window.LAB_CHAPTERS = (window.LAB_CHAPTERS || []).concat((function () {
  'use strict';

  var NS = 'shop';
  var YAML = window.LabEngine;

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  // The web Deployment, as git holds it. extra goes under the pod template spec.
  function manifest(extra) {
    return [
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
      '      serviceAccountName: web'
    ].concat(extra || []).concat([
      '      containers:',
      '      - name: web',
      '        image: shop/web:1.4',
      '        ports:',
      '        - containerPort: 8080',
      ''
    ]).join('\n');
  }

  var MANIFEST = manifest([]);
  var SECURE = manifest(['      securityContext:', '        runAsNonRoot: true']);

  var ROOT_POD = [
    'apiVersion: v1',
    'kind: Pod',
    'metadata:',
    '  name: web-root-test',
    '  namespace: shop',
    'spec:',
    '  containers:',
    '  - name: web',
    '    image: shop/web:1.4',
    '    securityContext:',
    '      runAsUser: 0',
    ''
  ].join('\n');

  // base64 of "super-secret" and of "app"
  var DB_SECRET = { 'db-password': 'c3VwZXItc2VjcmV0', 'db-user': 'YXBw' };

  // Who may do what. The learner and the web service account are the two subjects here.
  var RBAC = {
    learner: { pods: ['get', 'list'], deployments: ['get', 'list'], secrets: ['get', 'list'] },
    'system:serviceaccount:shop:web': { pods: ['get', 'list'], configmaps: ['get'] }
  };

  function deployment() {
    var spec = YAML.parseYaml(MANIFEST).spec;
    return { kind: 'Deployment', metadata: { name: 'web', namespace: NS, labels: { app: 'web' } }, spec: spec, status: {}, _born: -4320 };
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
      spec: { serviceAccountName: 'web', containers: [{ name: 'web', image: 'shop/web:1.4', ports: [{ containerPort: 8080 }] }] },
      status: { phase: 'Running', ready: true },
      _born: -4000,
      _t: 10
    };
  }

  function namespace() {
    return {
      kind: 'Namespace',
      metadata: {
        name: NS,
        labels: {
          'pod-security.kubernetes.io/enforce': 'restricted',
          'pod-security.kubernetes.io/warn': 'restricted'
        }
      },
      _cells: ['shop', 'Active'],
      _describe: [
        'Name:         shop',
        'Labels:       pod-security.kubernetes.io/enforce=restricted',
        '               pod-security.kubernetes.io/warn=restricted',
        'Status:       Active'
      ],
      _born: -9000
    };
  }

  function roleBinding(name, role, subjectKind, subjectName, born) {
    return {
      kind: 'RoleBinding',
      metadata: { name: name, namespace: NS },
      spec: { roleRef: { kind: 'Role', name: role }, subjects: [{ kind: subjectKind, name: subjectName, namespace: subjectKind === 'ServiceAccount' ? NS : undefined }] },
      _cells: [name, role],
      _describe: [
        'Name:         ' + name,
        'Namespace:    shop',
        'Role:',
        '  Kind:       Role',
        '  Name:       ' + role,
        'Subjects:',
        '  Kind            Name     Namespace',
        '  ----            ----     ---------',
        '  ' + subjectKind + '  ' + subjectName + '  ' + (subjectKind === 'ServiceAccount' ? NS : '')
      ],
      _born: born
    };
  }

  function clusterRoleBinding(name, role, group, born) {
    return {
      kind: 'ClusterRoleBinding',
      metadata: { name: name },
      spec: { roleRef: { kind: 'ClusterRole', name: role }, subjects: [{ kind: 'Group', name: group }] },
      _cells: [name, role],
      _describe: ['Name:         ' + name, 'Role:', '  Kind:       ClusterRole', '  Name:       ' + role, 'Subjects:', '  Group  ' + group],
      _born: born
    };
  }

  function secret() {
    return {
      kind: 'Secret',
      metadata: { name: 'db', namespace: NS },
      type: 'Opaque',
      spec: {},
      data: clone(DB_SECRET),
      _cells: ['db', 'Opaque', '2'],
      _describe: ['Name:         db', 'Namespace:    shop', 'Type:         Opaque', '', 'Data', '====', 'db-password:  12 bytes', 'db-user:      3 bytes'],
      _born: -2000
    };
  }

  function serviceAccount() {
    var arn = 'arn:aws:iam::123456789012:role/shop-web';
    return {
      kind: 'ServiceAccount',
      metadata: { name: 'web', namespace: NS, annotations: { 'eks.amazonaws.com/role-arn': arn } },
      _cells: ['web', '0'],
      _describe: ['Name:                web', 'Namespace:           shop', 'Annotations:         eks.amazonaws.com/role-arn: ' + arn, 'Mountable secrets:   <none>'],
      _born: -4000
    };
  }

  function bindings() {
    return [
      roleBinding('web-pods', 'pod-reader', 'ServiceAccount', 'web', -3000),
      roleBinding('ops-deployers', 'deployer', 'Group', 'ops', -2500)
    ];
  }

  function clusterBindings() {
    return [
      clusterRoleBinding('cluster-admins', 'cluster-admin', 'platform-admins', -5000),
      clusterRoleBinding('view-all', 'view', 'system:authenticated', -5000)
    ];
  }

  var FILES = {
    '/work/shop/deployment.yaml': MANIFEST,
    '/work/shop/fix/deployment.yaml': SECURE,
    '/work/shop/root-pod.yaml': ROOT_POD,
    '/work/shop/README.md': '# shop\n\nWeb replicas live in deployment.yaml. Git is the source of truth.\n'
  };

  function start(objs) {
    return {
      files: clone(FILES),
      cwd: '/work',
      ns: NS,
      rbac: clone(RBAC),
      cluster: { objects: objs, events: [], suffixes: [] }
    };
  }

  function base() {
    var d = deployment();
    return [d, replicaSet(), pod('web-7f9c-k4x9q'), pod('web-7f9c-m2v7w'), namespace(), serviceAccount()];
  }

  return [
    // ---------- Chapter 1 ----------
    {
      id: 'bou-1',
      h: 'BOUNCER',
      n: 1,
      title: 'Who Can Do What',
      skill: 'Ask whether a subject can do a verb. List role bindings and cluster role bindings. Find who is a subject.',
      intro: [
        'A teammate says the web pods can read every secret in the namespace. Before anyone changes anything, find out who may do what.',
        'Ask the API server directly with auth can-i. Then read the bindings that give the web service account its role.'
      ],
      concept: 'RBAC works in three parts: a **Role** lists verbs on resources, a **binding** gives a role to a **subject** (a user, a group, or a service account), and a **ClusterRoleBinding** does the same across the whole cluster. `kubectl auth can-i` asks the API server, so the answer is the real one.',
      tasks: ['bou-t-01', 'bou-t-02', 'bou-t-03', 'bou-t-15'],
      learned: [
        '`kubectl auth can-i VERB RESOURCE` asks the API server what you may do.',
        'A binding names a role and a subject. Read the subjects, not only the role.',
        'A ClusterRoleBinding applies everywhere. Look for cluster-admin in it.'
      ],
      outro: [
        'The web service account can get and list pods, through the pod-reader binding. The cluster-admin binding belongs to the platform team only.',
        'Next: check what the web pods can read, and where their secrets come from.'
      ],
      start: function () { return start(base().concat(bindings(), clusterBindings(), [secret()])); }
    },

    // ---------- Chapter 2 ----------
    {
      id: 'bou-2',
      h: 'BOUNCER',
      n: 2,
      title: 'Secrets',
      skill: 'List secrets without values. Decode a secret value with base64 -d. Find the service account of the pods. Read its role annotation.',
      intro: [
        'The database password is in a secret called db. Someone asked whether the secret is safe because it is "encoded". Before you answer, read the value the way a person with access would.',
        'List the secrets, decode one value, then find which service account the web pods use and what it may assume.'
      ],
      concept: 'A **Secret** stores values in **base64**. base64 is an encoding, not encryption: anyone who can read the Secret can decode it with one command. A pod runs as a **service account**, and on EKS an annotation on it can name an IAM role (IRSA).',
      tasks: ['bou-t-04', 'bou-t-05', 'bou-t-06', 'bou-t-07', 'bou-t-08'],
      learned: [
        'Listing secrets shows names only. Reading one shows the values.',
        'base64 -d turns a stored value back into the text the app reads.',
        'A pod runs as a service account. Describe the pod to find it.',
        'The role annotation on a service account is the IAM role its pods can assume.'
      ],
      outro: [
        'The database password is in base64, so anyone with read access to the secret can read it. Restrict who can get secrets, and rotate the value if it was shared.',
        'Next: the namespace rule that decides which pods are allowed to run at all.'
      ],
      start: function () { return start(base().concat(bindings(), clusterBindings(), [secret()])); }
    },

    // ---------- Chapter 3 ----------
    {
      id: 'bou-3',
      h: 'BOUNCER',
      n: 3,
      title: 'Pod Security',
      skill: 'Read the Pod Security labels of a namespace. Watch admission reject a root pod. Set runAsNonRoot and apply. Check a permission with --as.',
      intro: [
        'A debug pod that runs as root was refused by the cluster. The namespace has a rule for that, and the rule is the reason, not a bug.',
        'Read the rule, see the rejection, fix the manifest, and check what the web service account may read.'
      ],
      concept: 'A namespace label such as **pod-security.kubernetes.io/enforce: restricted** makes the API server refuse pods that break the rule, at admission. The fix is in the pod: **runAsNonRoot: true**. `auth can-i` with `--as` checks a service account as well as a user.',
      tasks: ['bou-t-09', 'bou-t-10', 'bou-t-11', 'bou-t-12', 'bou-t-13'],
      learned: [
        'A namespace label sets the Pod Security level. The enforce label decides what is refused.',
        'Admission refuses a pod before it runs. The message names the rule it broke.',
        'Set runAsNonRoot in the pod spec, not in the app.',
        '`--as` lets you check what a service account may do.'
      ],
      outro: [
        'The namespace enforces the restricted level, so the root pod was refused before it could start. Setting runAsNonRoot in the template made the web pods pass. The web service account cannot read secrets, which is what the team wanted.',
        'End of BOUNCER, for now. You can ask what a subject may do, read secrets safely, and tell when admission is the reason a pod does not start.'
      ],
      start: function () { return start(base()); }
    }
  ];
})());
