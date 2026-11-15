// Package q dot-imports p. On linux, Helper is p.Helper; on windows, q's own
// helper_windows.go would redeclare it (a compile error there), so the file
// is valid for linux/amd64 only.
package q

import . "example.com/dis/p"

func Call() string { return Helper() }
