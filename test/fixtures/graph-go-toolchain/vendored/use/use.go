// Package use calls into a vendored module (go build -mod=vendor).
package use

import "example.com/dep"

func Run() string { return dep.New().Do() }
