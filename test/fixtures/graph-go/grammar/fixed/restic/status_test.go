package restic

import (
	"io"
	"strings"
	"testing"
)

func TestReadPasswordTerminal(t *testing.T) {
	term := new(io.NopCloser(strings.NewReader("password")), io.Discard, io.Discard, false)
	if _, err := term.ReadPassword(); err != nil {
		t.Fatal(err)
	}
}
