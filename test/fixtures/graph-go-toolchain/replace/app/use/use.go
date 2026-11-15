// Package use: A implements dep.Marker (verified by the toolchain).
package use

import "example.com/dep"

type A struct{}

func (A) Mark() {}

type I interface{ dep.Marker }

func Use(m I) { m.Mark() }

func Run() { Use(A{}) }
