# One authority orders changes to the World

The initial Elixir Mua deployment runs one persistent shared World on one server node, targeting dozens of simultaneous players. One authority orders changes to that World so that competing actions, such as two Characters taking the same item, produce a consistent result.

Distributing a World across nodes is deferred until correct shared-world behaviour is established and capacity has been measured. This choice does not require connections or independent work to execute serially; the concrete process model and transaction boundaries remain to be designed.
