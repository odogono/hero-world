# Phoenix connects the Preact client to Mua

Phoenix handles HTTP, Google sign-in integration, browser sessions and WebSocket Channels. Preact owns the browser interface. The reusable ECS and Mua gameplay logic remain independent of Phoenix, so transport and session handling do not define the World model.

On reconnect, the browser fetches a fresh view of the Character's room, inventory and available actions. It may retain its existing transcript across a brief interruption but marks the gap; complete missed-output replay and durable transcript history across reloads or devices are not initial requirements.

The client reconnects automatically but does not automatically resubmit gameplay commands with uncertain outcomes. A change may have committed before its reply was lost, so the client labels the outcome unconfirmed and refreshes state. Durable command receipts and safe automatic retries are deferred. Transport reconnection alone does not provide application delivery guarantees.
