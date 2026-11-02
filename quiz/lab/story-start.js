// Get started: one chapter that teaches the terminal before any hero. Tasks are in lab/backlog/00-start.js.
window.LAB_CHAPTERS = (window.LAB_CHAPTERS || []).concat([
{
  id: 'start-1',
  h: 'START',
  n: 1,
  title: 'Using the terminal',
  skill: 'Type commands, read output, combine commands with a pipe, save output to a file, and ask the cluster a question.',
  intro: [
    'Welcome to the on-call rota for the **shop** namespace. Before the first page comes in, you need to be able to work in this terminal.',
    'The terminal is a **sandbox**. It knows a small set of commands. Type `help` to see them. Anything else gets an error, so you can try again without harm.'
  ],
  concept: 'You type a **command** and press **Enter**. The output appears below it. A command has a **name**, **flags** (like `-n shop`) and **files** it reads or writes. **kubectl** commands follow one shape: `kubectl <verb> <kind> <name> -n <namespace>`, for example `kubectl describe pod web-7f9c-k4x9q -n shop`. Use **↑** and **↓** to repeat earlier commands, and **Ctrl+L** to clear the screen.',
  tasks: ['start-t-01', 'start-t-02', 'start-t-03', 'start-t-04', 'start-t-05', 'start-t-06', 'start-t-07', 'start-t-09', 'start-t-10', 'start-t-11', 'start-t-12', 'start-t-08'],
  learned: [
    'Type a command, press **Enter**, read the output.',
    '`help` lists what the sandbox understands.',
    '**↑** and **↓** repeat commands. **Ctrl+L** clears the screen.',
    '`|` sends one command\'s output into another. `>` saves output into a file.',
    '`kubectl` talks to the cluster. `-n shop` picks the namespace.'
  ],
  outro: [
    'You can move around, read files, combine commands, save output and ask the cluster a question. That is all an on-call engineer needs to start.',
    'Next, **choose a hero**. Each hero is a story about one part of Kubernetes, told in chapters.'
  ],
  start: function () {
    var dep = {
      kind: 'Deployment',
      metadata: { name: 'web', namespace: 'shop', labels: { app: 'web' } },
      spec: { replicas: 2, selector: { matchLabels: { app: 'web' } }, template: { metadata: { labels: { app: 'web' } }, spec: { containers: [{ name: 'web', image: 'shop/web:1.4' }] } } },
      status: {}, _born: -4320
    };
    var rs = {
      kind: 'ReplicaSet',
      metadata: { name: 'web-7f9c', namespace: 'shop', labels: { app: 'web' }, ownerReferences: [{ kind: 'Deployment', name: 'web' }] },
      spec: { replicas: 2, template: { metadata: { labels: { app: 'web' } }, spec: { containers: [{ name: 'web', image: 'shop/web:1.4' }] } } },
      status: {}, _born: -4300
    };
    function pod(name) {
      return {
        kind: 'Pod',
        metadata: { name: name, namespace: 'shop', labels: { app: 'web' }, ownerReferences: [{ kind: 'ReplicaSet', name: 'web-7f9c' }] },
        spec: { containers: [{ name: 'web', image: 'shop/web:1.4' }] },
        status: { phase: 'Running', ready: true }, _born: -4000, _t: 10
      };
    }
    return {
      files: {
        '/work/START.md': [
          '# Welcome to the on-call shift',
          '',
          'Your job tonight: keep the shop web store running.',
          'Useful commands:',
          '- kubectl get pods -n shop   lists the pods',
          '- grep                       searches text',
          'Good luck.',
          ''
        ].join('\n')
      },
      cwd: '/work',
      ns: 'shop',
      cluster: {
        objects: [dep, rs, pod('web-7f9c-k4x9q'), pod('web-7f9c-m2v7w')],
        events: [],
        suffixes: []
      }
    };
  }
}
]);
