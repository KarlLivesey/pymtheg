// Package uses imports the broken package: its closure has an error.
package uses

import "example.com/te/bad"

func Hello() string { return bad.Name() }
