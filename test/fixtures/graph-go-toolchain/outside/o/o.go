// Package o: Shortener is implemented by a type declared only for Windows.
package o

type Shortener interface{ Short() string }

func Log(s Shortener) string { return s.Short() }
