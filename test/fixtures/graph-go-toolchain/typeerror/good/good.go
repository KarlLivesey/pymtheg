// Package good is clean and imports nothing broken.
package good

type Speaker interface{ Speak() string }

type Dog struct{}

func (Dog) Speak() string { return "woof" }

func Talk(s Speaker) string { return s.Speak() }

func Pet() string { return Talk(Dog{}) }
