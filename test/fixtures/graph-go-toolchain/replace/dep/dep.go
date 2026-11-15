// Package dep is a local replace target outside the app module.
package dep

// Marker is the interface the app's types are checked against.
type Marker interface{ Mark() }
