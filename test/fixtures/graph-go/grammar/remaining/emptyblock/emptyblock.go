package emptyblock

func G() {}

func F(b bool) {
	if b { ; G() }
}
