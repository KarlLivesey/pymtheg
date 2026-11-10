// Review 30 CommonJS fixtures, retained with executable runtime ground truth.
const VALUE = { one: 1, two: 2, seven: 7, eight: 8 };
const A = `function one() { return 1; }\nexports.f = one;`;
const AM = `function one() { return 1; }\nmodule.exports = { f: one };`;
const SEVEN = `function seven() { return 7; }\n`;
const B = (m) =>
  `const { f } = require("${m}");\nexports.run = function () { return f(); };`;
const BA = (m) =>
  `const a = require("${m}");\nexports.run = function () { return a.f(); };`;
const BL = (m) => `exports.run = function () { return require("${m}").f(); };`;
const MAIN = (load) =>
  load.map((m) => `require("./${m}");`).join("\n") +
  `\nlet v; try { v = require("./b.js").run(); } catch (e) { v = "throws"; }\nprocess.stdout.write(String(v));`;
// [name, files, load-order for runtime entry (writers first), expectation: "any" | "control"]
const rows = [
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
];

export { rows };
