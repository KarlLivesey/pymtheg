package app

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"os/exec"
	"strings"
	"sync"
)

type guarded struct {
	sync.Mutex
	n int
}

func Use(r io.Reader, resp *http.Response, p []byte) (int, error) {
	var buf bytes.Buffer
	buf.Write(p)
	g := &guarded{}
	g.Lock()
	defer g.Unlock()
	var exitErr *exec.ExitError
	if err := exec.Command("true").Run(); errors.As(err, &exitErr) {
		_ = exitErr.ExitCode()
	}
	_, _ = r.Read(p)
	defer resp.Body.Close()
	return strings.Count(buf.String(), "x") + len(p), nil
}
