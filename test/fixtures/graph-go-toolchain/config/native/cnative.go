package native

/*
int answer(void) { return 42; }
*/
import "C"

// Answer needs cgo: with cgo off this file is outside the configuration.
func Answer() int { return int(C.answer()) + len(Engine{}.Start()) }
