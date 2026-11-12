// A locally declared require: the compiler sees it renamed, facts keep the name.
function require(name) {
  return { name };
}
export const loaded = require("./lib/api");
