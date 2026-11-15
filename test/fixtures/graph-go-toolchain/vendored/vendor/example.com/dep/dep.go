// Package dep, vendored.
package dep

type Client struct{}

func New() *Client { return &Client{} }

func (*Client) Do() string { return "done" }
