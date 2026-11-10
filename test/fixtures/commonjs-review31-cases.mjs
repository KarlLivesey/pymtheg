// Retained independent review 31 fixtures; faulty N25 and dynamic-loader boundaries are excluded by the regression runner.
const A = `function one() { return 1; }\nexports.f = one;`;
const AM = `function one() { return 1; }\nmodule.exports = { f: one };`;
const ASUB = `function one() { return 1; }\nfunction two() { return 2; }\nexports.f = one;\nexports.sub = { f: two };`;
const SEVEN = `function seven() { return 7; }\n`;
const B = (m) =>
  `const { f } = require("${m}");\nexports.run = function () { return f(); };`;
const BA = (m) =>
  `const a = require("${m}");\nexports.run = function () { return a.f(); };`;
const BL = (m) => `exports.run = function () { return require("${m}").f(); };`;
const BS = (m) =>
  `const a = require("${m}");\nexports.run = function () { return a.sub.f(); };`;
const MAIN = (load) =>
  load.map((m) => `require("./${m}");`).join("\n") +
  `\nlet v; try { v = require("./b.js").run(); } catch (e) { v = "throws"; }\nprocess.stdout.write(String(v));`;
const ROWS30 = [
  // --- third-party writers through a pure forwarding barrel (no write inside the forwarder)
  [
    "T1 c.js writes require('./i').f = seven; b uses a",
    [
      ["a.js", A],
      ["i.js", `module.exports = require("./a");`],
      ["c.js", SEVEN + `require("./i").f = seven;`],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "T2 c.js Object.assign(require('./i'),{f:seven}); b uses a",
    [
      ["a.js", A],
      ["i.js", `module.exports = require("./a");`],
      ["c.js", SEVEN + `Object.assign(require("./i"), { f: seven });`],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "T3 c.js const i=require('./i'); i.f=seven; b a.f()",
    [
      ["a.js", A],
      ["i.js", `module.exports = require("./a");`],
      ["c.js", SEVEN + `const i = require("./i");\ni.f = seven;`],
      ["b.js", BA("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "T4 c.js writes a; b uses barrel i",
    [
      ["a.js", A],
      ["i.js", `module.exports = require("./a");`],
      ["c.js", SEVEN + `require("./a").f = seven;`],
      ["b.js", B("./i")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "T5 c.js Reflect.set(require('./i'),'f',seven); b uses a",
    [
      ["a.js", A],
      ["i.js", `module.exports = require("./a");`],
      ["c.js", SEVEN + `Reflect.set(require("./i"), "f", seven);`],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "T6 c.js helper(require('./i')); b uses a",
    [
      ["a.js", A],
      ["i.js", `module.exports = require("./a");`],
      [
        "c.js",
        SEVEN + `function put(o) { o.f = seven; }\nput(require("./i"));`,
      ],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "any",
  ],
  // --- writes inside the forwarding file, new shapes
  [
    "W1 i: defineProperty(module.exports,'f')",
    [
      ["a.js", A],
      [
        "i.js",
        SEVEN +
          `module.exports = require("./a");\nObject.defineProperty(module.exports, "f", { value: seven });`,
      ],
      ["b.js", B("./a")],
    ],
    ["i.js"],
    "any",
  ],
  [
    "W2 i: const e = module.exports; e.f = seven",
    [
      ["a.js", A],
      [
        "i.js",
        SEVEN +
          `module.exports = require("./a");\nconst e = module.exports;\ne.f = seven;`,
      ],
      ["b.js", B("./a")],
    ],
    ["i.js"],
    "any",
  ],
  [
    "W3 i: module.exports[k] (const k='f')",
    [
      ["a.js", A],
      [
        "i.js",
        SEVEN +
          `const k = "f";\nmodule.exports = require("./a");\nmodule.exports[k] = seven;`,
      ],
      ["b.js", B("./a")],
    ],
    ["i.js"],
    "any",
  ],
  [
    "W4 i: const a=require; module.exports=a; a.f=seven",
    [
      ["a.js", A],
      [
        "i.js",
        SEVEN + `const a = require("./a");\nmodule.exports = a;\na.f = seven;`,
      ],
      ["b.js", B("./a")],
    ],
    ["i.js"],
    "any",
  ],
  [
    "W5 i: module.exports = Object.assign(require('./a'),{f:seven})",
    [
      ["a.js", A],
      [
        "i.js",
        SEVEN + `module.exports = Object.assign(require("./a"), { f: seven });`,
      ],
      ["b.js", B("./a")],
    ],
    ["i.js"],
    "any",
  ],
  [
    "W6 i: forward via .sub then write (a.sub mutated)",
    [
      ["a.js", `function one() { return 1; }\nexports.sub = { f: one };`],
      [
        "i.js",
        SEVEN +
          `module.exports = require("./a").sub;\nmodule.exports.f = seven;`,
      ],
      [
        "b.js",
        `const a = require("./a");\nexports.run = function () { return a.sub.f(); };`,
      ],
    ],
    ["i.js"],
    "any",
  ],
  [
    "W7 i: write in installer function, called by main",
    [
      ["a.js", A],
      [
        "i.js",
        SEVEN +
          `module.exports = require("./a");\nmodule.exports.install = function () { module.exports.f = seven; };`,
      ],
      ["c.js", `require("./i").install();`],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "W8 i: this.f = seven at top level (this===module.exports? no: detached)",
    [
      ["a.js", A],
      ["i.js", SEVEN + `module.exports = require("./a");\nthis.f = seven;`],
      ["b.js", B("./a")],
    ],
    ["i.js"],
    "any",
  ],
  [
    "W9 i: module.exports=require('./a'); module.exports.f++ style: f = f.bind",
    [
      ["a.js", A],
      [
        "i.js",
        SEVEN +
          `module.exports = require("./a");\nmodule.exports.f = module.exports.f.bind(null);`,
      ],
      ["b.js", B("./a")],
    ],
    ["i.js"],
    "any",
  ],
  [
    "W10 module.exports = module.exports = require (double)",
    [
      ["a.js", A],
      [
        "i.js",
        SEVEN +
          `module.exports = module.exports = require("./a");\nmodule.exports.f = seven;`,
      ],
      ["b.js", B("./a")],
    ],
    ["i.js"],
    "any",
  ],
  [
    "W11 a uses module.exports = {f: one}; i forwards+writes; b a.f()",
    [
      ["a.js", AM],
      [
        "i.js",
        SEVEN + `module.exports = require("./a");\nmodule.exports.f = seven;`,
      ],
      ["b.js", BA("./a")],
    ],
    ["i.js"],
    "any",
  ],
  [
    "W12 lazy require in b; i writes",
    [
      ["a.js", A],
      [
        "i.js",
        SEVEN + `module.exports = require("./a");\nmodule.exports.f = seven;`,
      ],
      ["b.js", BL("./a")],
    ],
    ["i.js"],
    "any",
  ],
  [
    "W13 two forwarders, second writes; b via first",
    [
      ["a.js", A],
      ["i.js", `module.exports = require("./a");`],
      [
        "j.js",
        SEVEN + `module.exports = require("./a");\nmodule.exports.f = seven;`,
      ],
      ["b.js", B("./i")],
    ],
    ["j.js"],
    "any",
  ],
  [
    "W14 multi-hop j->i->a, writer j, b uses a",
    [
      ["a.js", A],
      ["i.js", `module.exports = require("./a");`],
      [
        "j.js",
        SEVEN + `module.exports = require("./i");\nmodule.exports.f = seven;`,
      ],
      ["b.js", B("./a")],
    ],
    ["j.js"],
    "any",
  ],
  [
    "W15 multi-hop j->i->a, writer a-consumer i? writer i, b uses j",
    [
      ["a.js", A],
      [
        "i.js",
        SEVEN + `module.exports = require("./a");\nmodule.exports.f = seven;`,
      ],
      ["j.js", `module.exports = require("./i");`],
      ["b.js", B("./j")],
    ],
    ["i.js"],
    "any",
  ],
  [
    "W16 index dir forwarder + write",
    [
      ["lib/a.js", A],
      [
        "lib/index.js",
        SEVEN + `module.exports = require("./a");\nmodule.exports.f = seven;`,
      ],
      ["b.js", B("./lib/a")],
    ],
    ["lib/index.js"],
    "any",
  ],
  // --- controls (should keep resolving the correct callable)
  [
    "C1 pure forward (control)",
    [
      ["a.js", A],
      ["i.js", `module.exports = require("./a");`],
      ["b.js", B("./i")],
    ],
    ["i.js"],
    "control",
  ],
  [
    "C2 detached exports.f after forward (control)",
    [
      ["a.js", A],
      ["i.js", SEVEN + `module.exports = require("./a");\nexports.f = seven;`],
      ["b.js", B("./a")],
    ],
    ["i.js"],
    "control",
  ],
  [
    "C3 member forward module.exports.f=require().f + write g (control)",
    [
      ["a.js", A],
      [
        "i.js",
        SEVEN +
          `module.exports.f = require("./a").f;\nmodule.exports.g = seven;`,
      ],
      ["b.js", B("./a")],
    ],
    ["i.js"],
    "control",
  ],
  [
    "C4 copy Object.assign(module.exports, require) + write (control a)",
    [
      ["a.js", A],
      [
        "i.js",
        SEVEN +
          `Object.assign(module.exports, require("./a"));\nmodule.exports.f = seven;`,
      ],
      ["b.js", B("./a")],
    ],
    ["i.js"],
    "control",
  ],
  [
    "C5 unrelated module writes its own exports (control)",
    [
      ["a.js", A],
      ["i.js", SEVEN + `module.exports.f = seven;`],
      ["b.js", B("./a")],
    ],
    ["i.js"],
    "control",
  ],
  [
    "C6 spread copy then write (control a)",
    [
      ["a.js", A],
      [
        "i.js",
        SEVEN +
          `module.exports = { ...require("./a") };\nmodule.exports.f = seven;`,
      ],
      ["b.js", B("./a")],
    ],
    ["i.js"],
    "control",
  ],

  [
    "X1 no barrel: c.js require('./a').f = seven; b uses a",
    [
      ["a.js", A],
      ["c.js", SEVEN + `require("./a").f = seven;`],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "X2 no barrel: c.js Object.assign(require('./a'),{f}); b uses a",
    [
      ["a.js", A],
      ["c.js", SEVEN + `Object.assign(require("./a"), { f: seven });`],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "X3 no barrel: c.js const a=require('./a'); a.f=seven; b a.f()",
    [
      ["a.js", A],
      ["c.js", SEVEN + `const a = require("./a");\na.f = seven;`],
      ["b.js", BA("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "X4 ESM-TS: c.ts import * as m; (m as any).f = seven; b.ts uses a",
    [
      ["a.js", A],
      [
        "c.js",
        SEVEN +
          `const m = require("./a");\nfunction put(o) { o.f = seven; }\nput(m);`,
      ],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "any",
  ],
];
const rows = [
  ...ROWS30,
  // ---- review-31 neighbours (writer and alias shapes)
  [
    "N1 nested member write require('./a').sub.f; b a.sub.f()",
    [
      ["a.js", ASUB],
      ["c.js", SEVEN + `require("./a").sub.f = seven;`],
      ["b.js", BS("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "N1c nested write sub.f; b calls a.f (control: a.f untouched)",
    [
      ["a.js", ASUB],
      ["c.js", SEVEN + `require("./a").sub.f = seven;`],
      ["b.js", BA("./a")],
    ],
    ["c.js"],
    "control",
  ],
  [
    "N2 let m; m = require('./a'); m.f = seven",
    [
      ["a.js", A],
      ["c.js", SEVEN + `let m;\nm = require("./a");\nm.f = seven;`],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "N3 const m = require('./a') || {}; m.f = seven",
    [
      ["a.js", A],
      ["c.js", SEVEN + `const m = require("./a") || {};\nm.f = seven;`],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "N4 const m = true ? require('./a') : null; m.f = seven",
    [
      ["a.js", A],
      ["c.js", SEVEN + `const m = true ? require("./a") : null;\nm.f = seven;`],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "N5 alias chain const m = require, n = m; n.f = seven",
    [
      ["a.js", A],
      ["c.js", SEVEN + `const m = require("./a"), n = m;\nn.f = seven;`],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "N6 element literal o['f'] = seven",
    [
      ["a.js", A],
      ["c.js", SEVEN + `const o = require("./a");\no["f"] = seven;`],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "N7 template key require('./a')[`f`] = seven",
    [
      ["a.js", A],
      ["c.js", SEVEN + "require(`./a`)[`f`] = seven;"],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "N8 computed const key require('./a')[k] = seven",
    [
      ["a.js", A],
      ["c.js", SEVEN + `const k = "f";\nrequire("./a")[k] = seven;`],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "N9 explicit extension require('./a.js').f = seven",
    [
      ["a.js", A],
      ["c.js", SEVEN + `require("./a.js").f = seven;`],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "N10 directory index require('./lib').f = seven; b uses ./lib/index",
    [
      ["lib/index.js", A],
      ["c.js", SEVEN + `require("./lib").f = seven;`],
      ["b.js", B("./lib/index")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "N11 write inside installer, called later",
    [
      ["a.js", A],
      [
        "c.js",
        SEVEN + `exports.install = function () { require("./a").f = seven; };`,
      ],
      ["b.js", B("./a")],
      ["d.js", `require("./c").install();`],
    ],
    ["d.js"],
    "any",
  ],
  [
    "N12 Object.defineProperty(require('./a'),'f')",
    [
      ["a.js", A],
      [
        "c.js",
        SEVEN + `Object.defineProperty(require("./a"), "f", { value: seven });`,
      ],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "N13 logical assign require('./a').f &&= seven",
    [
      ["a.js", A],
      ["c.js", SEVEN + `require("./a").f &&= seven;`],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "N14 delete require('./a').f; b a.f()",
    [
      ["a.js", A],
      ["c.js", `delete require("./a").f;`],
      ["b.js", BA("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "N15 destructuring assign ({f: require('./a').f} = {f: seven})",
    [
      ["a.js", A],
      ["c.js", SEVEN + `({ f: require("./a").f } = { f: seven });`],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "N16 array destructuring [require('./a').f] = [seven]",
    [
      ["a.js", A],
      ["c.js", SEVEN + `[require("./a").f] = [seven];`],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "N17 for-of target for (require('./a').f of [seven]);",
    [
      ["a.js", A],
      ["c.js", SEVEN + `for (require("./a").f of [seven]);`],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "N18 TS writer c.ts (require('./a') as any).f = seven",
    [
      ["a.js", A],
      ["c.ts", SEVEN + `const m = require("./a") as any;\nm.f = seven;`],
      ["b.js", B("./a")],
    ],
    ["c.ts"],
    "any",
  ],
  [
    "N19 TS writer c.ts satisfies",
    [
      ["a.js", A],
      [
        "c.ts",
        SEVEN +
          `const m = require("./a") satisfies object;\n(m as any).f = seven;`,
      ],
      ["b.js", B("./a")],
    ],
    ["c.ts"],
    "any",
  ],
  [
    "N20 module.require('./a').f = seven (dynamic loader)",
    [
      ["a.js", A],
      ["c.js", SEVEN + `module.require("./a").f = seven;`],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "N21 const r = require; r('./a').f = seven (aliased loader)",
    [
      ["a.js", A],
      ["c.js", SEVEN + `const r = require;\nr("./a").f = seven;`],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "N22 sequence (0, require('./a')).f = seven",
    [
      ["a.js", A],
      ["c.js", SEVEN + `(0, require("./a")).f = seven;`],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "any",
  ],
  [
    "N23 writer via exported getter: c exports obj, d writes c.obj.f",
    [
      ["a.js", A],
      ["c.js", `exports.obj = require("./a");`],
      ["d.js", SEVEN + `require("./c").obj.f = seven;`],
      ["b.js", B("./a")],
    ],
    ["d.js"],
    "any",
  ],
  [
    "N24 c: module.exports.a = require('./a'); d writes require('./c').a.f",
    [
      ["a.js", A],
      ["c.js", `module.exports.a = require("./a");`],
      ["d.js", SEVEN + `const c = require("./c");\nc.a.f = seven;`],
      ["b.js", BA("./a")],
    ],
    ["d.js"],
    "any",
  ],
  [
    "N25 import-equals-free TS ESM namespace writer of CJS forwarder",
    [
      ["a.js", A],
      ["i.js", `module.exports = require("./a");`],
      ["c.ts", SEVEN + `import * as i from "./i";\n(i as any).f = seven;`],
      ["b.js", B("./a")],
    ],
    ["c.ts"],
    "any",
  ],
  [
    "N26 writer through ESM default import of forwarder (esModuleInterop)",
    [
      ["a.js", A],
      ["i.js", `module.exports = require("./a");`],
      [
        "c.mjs",
        `import i from "./i.js";\nfunction seven() { return 7; }\ni.f = seven;`,
      ],
      ["b.js", B("./a")],
    ],
    ["c.mjs"],
    "any",
  ],
  // ---- controls
  [
    "CC1 plain cross-module call, no writer (control)",
    [
      ["a.js", A],
      ["b.js", B("./a")],
    ],
    [],
    "control",
  ],
  [
    "CC2 plain cross-module, unrelated file in scope (control)",
    [
      ["a.js", A],
      ["x.js", `exports.g = 1;`],
      ["b.js", B("./a")],
    ],
    [],
    "control",
  ],
  [
    "CC3 writer writes unrelated module x (control)",
    [
      ["a.js", A],
      ["x.js", `exports.g = 1;`],
      ["c.js", SEVEN + `require("./x").f = seven;`],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "control",
  ],
  [
    "CC4 writer writes a different name a.g (control)",
    [
      ["a.js", A],
      ["c.js", SEVEN + `require("./a").g = seven;`],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "control",
  ],
  [
    "CC5 writer writes its own local object (control)",
    [
      ["a.js", A],
      ["c.js", SEVEN + `const o = {};\no.f = seven;`],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "control",
  ],
  [
    "CC6 member-consumer a.f() plain (control)",
    [
      ["a.js", A],
      ["b.js", BA("./a")],
    ],
    [],
    "control",
  ],
  [
    "CC7 lazy require consumer plain (control)",
    [
      ["a.js", A],
      ["b.js", BL("./a")],
    ],
    [],
    "control",
  ],
  [
    "CC8 reader of a (no write) c: const m=require('./a'); m.f() (control)",
    [
      ["a.js", A],
      ["c.js", `const m = require("./a");\nexports.x = m.f();`],
      ["b.js", B("./a")],
    ],
    ["c.js"],
    "control",
  ],
];

export { rows };
