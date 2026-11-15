//go:build windows

package native

// Windows-only: outside the host configuration on any other OS.
func Platform() string { return Engine{}.Start() + "-windows" }
