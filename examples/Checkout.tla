---------------------------- MODULE Checkout ----------------------------
EXTENDS Naturals
CONSTANTS Deduplicate, Cleanup
VARIABLES phase, reserved, captures, refunds, attempts, lastEvent

vars == <<phase, reserved, captures, refunds, attempts, lastEvent>>

Init ==
  /\ phase = "Waiting"
  /\ reserved = TRUE
  /\ captures = 0
  /\ refunds = 0
  /\ attempts = 0
  /\ lastEvent = "stock reserved"

Pay(replyLost) ==
  /\ phase = "Waiting"
  /\ attempts < 2
  /\ attempts' = attempts + 1
  /\ captures' = IF Deduplicate THEN 1 ELSE captures + 1
  /\ refunds' = refunds
  /\ phase' = IF replyLost THEN "Waiting" ELSE "Paid"
  /\ reserved' = IF replyLost THEN reserved ELSE FALSE
  /\ lastEvent' = IF replyLost THEN "provider accepted; response lost"
                  ELSE "provider accepted; response received"

Cancel ==
  /\ phase = "Waiting"
  /\ phase' = "Cancelled"
  /\ reserved' = IF Cleanup THEN FALSE ELSE reserved
  /\ captures' = captures
  /\ refunds' = IF Cleanup THEN captures ELSE refunds
  /\ attempts' = attempts
  /\ lastEvent' = "cancelled"

Finished == /\ phase # "Waiting" /\ UNCHANGED vars
Next == (\E replyLost \in BOOLEAN : Pay(replyLost)) \/ Cancel \/ Finished

NoDoubleCharge == captures <= 1
TerminalReleasesStock == (phase = "Waiting") \/ ~reserved
CancelledRefunded == (phase # "Cancelled") \/ (captures = refunds)
Safety == NoDoubleCharge /\ TerminalReleasesStock /\ CancelledRefunded
=============================================================================
