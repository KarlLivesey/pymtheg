package store

import "testing"

type fakePinger struct{}

func (fakePinger) Ping() {}

func TestPing(t *testing.T) {
	PingIt(fakePinger{})
	if ShutAll(&Pool[int]{}) != nil {
		t.Fatal("shut")
	}
}
