// restic internal/ui/termstatus shape: a user-declared new with value arguments.
package restic

import "io"

type terminal struct{ rd io.ReadCloser }

func (t *terminal) ReadPassword() (string, error) { return "", nil }

func new(rd io.ReadCloser, wr io.Writer, errWriter io.Writer, disableStatus bool) *terminal {
	return &terminal{rd: rd}
}
