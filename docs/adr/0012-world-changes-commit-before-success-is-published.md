# World changes commit before success is published

The Elixir server durably commits a World change before publishing output that confirms its success. The current implementation can send output before its subsequent flush, allowing a crash to erase a change already announced to a player. The new guarantee makes received success survive a normal server restart.

The boundary is each committed step, not an entire command or Script that may wait and resume later. A crash can still prevent delivery of a committed result. ADR 0013 defines reconnect behaviour and treatment of commands with uncertain outcomes; this is not an exactly-once delivery guarantee. ADR 0014 defines what a restart keeps: timers recover with the World and waiting Scripts are abandoned.
