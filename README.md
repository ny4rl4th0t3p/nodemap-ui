# nodemap-ui

A running instance of [nodemap](https://github.com/ny4rl4th0t3p/nodemap): an aggregate, public map of the reachable node
population of Cosmos SDK / CometBFT chains. This repository holds everything that makes one map: which chains, the
opt-out list, the delisting key, the page, the workflow that crawls every four hours and publishes. The crawler itself is consumed
as a pinned release and carries no data of its own.

## Chains

| Chain                      | Seeds                           |
|----------------------------|---------------------------------|
| Cosmos Hub (`cosmoshub-4`) | `instance/seeds/cosmoshub.json` |
| Injective (`injective-1`)  | `instance/seeds/injective.json` |
| Celestia (`celestia`)      | `instance/seeds/celestia.json`  |
| dYdX (`dydx-mainnet-1`)    | `instance/seeds/dydx.json`      |

Adding a chain is one file: `instance/seeds/<name>.json` in the chain-registry `chain.json` shape with its
`chain_id` and its `apis.rpc[].address` list. The next run picks it up.

## What is published

Only what the crawler's field policy allows: node counts, country and hosting-provider concentration, client version
adoption as a network-wide share, two mesh-health scalars, and a directory of self-advertised public RPC endpoints. No
node ids, no monikers, no per-node versions, no peer graph, no validator, no city. The policy and its reasoning are in
the crawler's README.

Geolocation uses the DB-IP Lite databases, CC BY 4.0: IP geolocation by [DB-IP](https://db-ip.com).

## Opting out

Operators of a self-advertised RPC node can have its individual record removed from this map. Removal requires proof of
control of the node's `node_key`: the P2P identity key, not the consensus key. It cannot sign blocks.

1. Sign, with the node's `node_key`, the exact text

   ```
   delist <node_id> from nodemap <YYYY-MM>
   ```

   where `<node_id>` is the node id in lower-case hex and `<YYYY-MM>` the current UTC month. The signature is a plain
   ed25519 signature over those bytes, no hashing, no framing. Package it as

   ```
   {"node_id":"<hex>","pubkey":"<base64 of the 32-byte public key>","signature":"<base64 of the 64-byte signature>"}
   ```

   How you sign is up to you and your tooling; nothing from this repository runs on your node.

2. Encrypt the object to this instance's key, `instance/delist.asc`. The public key alone identifies the node, so the
   proof must not travel in the clear:

   ```
   gpg --import instance/delist.asc
   gpg --encrypt --armor --recipient <the key's id> proof.json
   ```

3. Open a discussion in this repository's **delist** category, titled exactly `delist`, and paste the content of
   `proof.json.asc`, the block from `-----BEGIN PGP MESSAGE-----` to `-----END PGP MESSAGE-----`, into the body.
   Pasting is the point: an attached file is not read; a code fence around the block is fine. A workflow picks it up
   within minutes, posts one reply, and deletes the thread.
   The reply is the same whether the proof verified or not; a valid proof shows as the record disappearing after the
   next run, and nothing else.

   The thread names the account that opened it for as long as it exists. An operator who needs to be unlinkable even
   from the maintainer can use a throwaway account; the proof verifies on its own, so a relay through someone else
   works too.

The workflow decrypts the proof with the instance key, runs it through `tools/verify`, which checks the signature and
that the public key hashes to the claimed node id, and turns the id into a salted entry in `instance/suppression.txt`
through the crawler's `-hash`. The plaintext lives in a pipe between those three programs and nowhere else; the log
records only whether an entry was added. The salt is never committed. A proof is valid for the month it names and the
month after. There is no manual path: if the workflow is unavailable for long, the map is paused instead.

Opt-out removes the endpoint record; the node still counts in anonymous aggregates. It hides the node from this map, not
from anyone running their own crawler.

What the intake trusts, and what it does not. Decryption is not authentication: anyone can encrypt anything to the
instance key, so the plaintext is treated as hostile and only the signature decides. The id that reaches the list is
byte-equal to the derivation from the public key in the proof, the list only ever receives hash digests, and the crawler
refuses a list with any other line. The stated residual risk is `gpg` itself: it parses attacker-chosen input on a
runner that holds, for the life of the job, a token with write access to this repository, the salt, and the delisting
key. A code-execution bug in that parser would expose all three. It is accepted: the exploit needs a bug that is not
known to exist, the repository holds nothing of value to take, and an instance with users to protect belongs on a
machine of its own rather than in a hosted workflow.

## Operations

- `crawl.yml` runs every four hours (GitHub's scheduler is best effort; runs can be late or missing under load):
  installs the pinned crawler, crawls every chain in `instance/seeds/`, commits the three output files per chain to the
  `data` branch, and deploys the page. A chain that fails keeps its last good files.
- Kill switch, in this order: set the repository variable `NODEMAP_PAUSED` to `1` (the scheduled crawl then exits
  before any dial), then run `takedown.yml` (the site becomes a notice). Without the first step the next scheduled run
  puts the map back. Nothing is deleted: the `data` branch keeps every snapshot and the history. To come back: remove
  the variable, then dispatch `crawl` or wait for the next slot. The history shows a gap for the paused period.
- `delist.yml` runs on every new discussion in the `delist` category with the title `delist`, and only on those.
- Secrets: `NODEMAP_SALT`, the opt-out list salt; `DELIST_GPG_KEY`, the armored private half of `instance/delist.asc`,
  used only inside `delist.yml`. It can decrypt proofs and nothing else.
