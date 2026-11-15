// Package bad has a type error (an int initialised with a string): go build
// rejects it, so its links and its importers' links stay source-only.
package bad

var Count int = "three"

func Name() string { return "bad" }
