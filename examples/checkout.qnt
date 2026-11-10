// One checkout, one reservation, and at most two payment attempts.
// This models provider acceptance separately from receiving its response.
module checkout {
  var phase: str
  var reserved: bool
  var captures: int
  var refunds: int
  var attempts: int
  var lastEvent: str

  action init = all {
    phase' = "Waiting",
    reserved' = true,
    captures' = 0,
    refunds' = 0,
    attempts' = 0,
    lastEvent' = "stock reserved",
  }

  // The provider always accepts in this small model; the response may be lost.
  // A stable idempotency key means subsequent attempts reuse the first capture.
  action pay(deduplicate: bool): bool = {
    nondet replyLost = Set(true, false).oneOf()
    all {
      phase == "Waiting",
      attempts < 2,
      attempts' = attempts + 1,
      captures' = if (deduplicate) 1 else captures + 1,
      refunds' = refunds,
      phase' = if (replyLost) "Waiting" else "Paid",
      reserved' = if (replyLost) reserved else false,
      lastEvent' = if (replyLost) "provider accepted; response lost"
                   else "provider accepted; response received",
    }
  }

  action cancel(cleanup: bool): bool = all {
    phase == "Waiting",
    phase' = "Cancelled",
    reserved' = if (cleanup) false else reserved,
    captures' = captures,
    refunds' = if (cleanup) captures else refunds,
    attempts' = attempts,
    lastEvent' = "cancelled",
  }

  // Terminal states stutter so safety checking does not report normal completion
  // as a deadlock. This does not establish eventual completion.
  action finished = all {
    phase != "Waiting",
    phase' = phase,
    reserved' = reserved,
    captures' = captures,
    refunds' = refunds,
    attempts' = attempts,
    lastEvent' = lastEvent,
  }

  action buggyStep = any { pay(false), cancel(false), finished }
  action idempotentStep = any { pay(true), cancel(false), finished }
  action fixedStep = any { pay(true), cancel(true), finished }

  val noDoubleCharge = captures <= 1
  val terminalReleasesStock = (phase == "Waiting") or not(reserved)
  val cancelledRefunded = (phase != "Cancelled") or (captures == refunds)
  val safety = noDoubleCharge and terminalReleasesStock and cancelledRefunded
}
