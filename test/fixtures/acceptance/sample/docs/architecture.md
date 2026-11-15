# Architecture

The web front end (`web/`) formats totals computed by the Go pricing service
(`service/`). Discounts are applied by the Rust engine (`engine/`).
The order lifecycle is designed in `designs/order.pym`.
