const { format } = require("./lib/api");

function legacy() {
  return format("x");
}

module.exports = { legacy };
