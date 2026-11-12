package store

type Store struct{}

func (st *Store) Name() string { return "store" }

func Save(value string) error { return nil }
