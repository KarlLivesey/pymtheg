// Package p converts to pointer types (pebble's `var _ Writer = (*Batch)(nil)`).
package p

// Writer is satisfied by *Batch.
type Writer interface{ Apply() }

// Batch is converted to with (*Batch)(x).
type Batch struct{ n int }

// Apply is called on a converted value.
func (b *Batch) Apply() {}

var _ Writer = (*Batch)(nil)

// Use calls a method on a converted value.
func Use() { (*Batch)(nil).Apply() }
