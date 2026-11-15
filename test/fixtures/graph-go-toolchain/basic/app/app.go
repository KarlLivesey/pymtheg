// Package app calls through interfaces, generics and promotion.
package app

import "example.com/tc/store"

// Save dispatches through store.Writer.
func Save(w store.Writer) { w.Write(nil) }

func Use() {
	f := &store.File{}
	Save(f)
	files := []*store.File{f}
	store.First(files).Write(nil)
	b := store.NewBox(f)
	b.Get().Write(nil)
	c := store.Open()
	c.Close()
	m := map[string]*store.File{}
	for _, v := range m {
		v.Write(nil)
	}
	var l store.Logger
	l.Write("x")
}
