# Connecting

```mermaid

sequenceDiagram
    participant User
    participant Server
    participant Entity

    User->>Server: Open Connection

    Server->>Entity: Create Connected
    Server->>Entity: Create Authenticating

    Server->>Server: Wait for Auth

    User->>Server: Send authentication

    Server->>Server: Do authentication

    Server->>Entity: Remove Authenticating
    Server->>Entity: Add Authenticated

```

Alice->>Bob: Hello Bob, how are you ?
Bob->>Alice: Fine, thank you. And you?
create participant Carl
Alice->>Carl: Hi Carl!
create actor D as Donald
Carl->>D: Hi!
destroy Carl
Alice-xCarl: We are too many
destroy Bob
Bob->>Alice: I agree
