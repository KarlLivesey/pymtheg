//go:build windows

package o

type HRESULT uint32

func (h HRESULT) Short() string { return "hr" }
