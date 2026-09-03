// Package optout implements the maintainer's half of proof of control of a
// node's P2P identity key: an operator signs a fixed message with node_key,
// and the maintainer verifies the signature and that the public key really
// is the node id being delisted. Nothing in this package signs; how an
// operator signs is their business.
//
// The node id derivation is pinned to CometBFT v0.38.22: p2p.PubKeyToID is
// the hex encoding of PubKey.Address(), which is tmhash.SumTruncated of the
// raw 32-byte ed25519 public key, that is the first 20 bytes of its SHA-256.
//
// Nothing here touches a consensus key. node_key is the peer identity key;
// it cannot sign blocks.
package optout

import (
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

const (
	// idBytes is tmhash.TruncatedSize.
	idBytes = 20
	// monthLayout is the month stamp in the signed message.
	monthLayout = "2006-01"
)

// ErrInvalid is the only error Verify returns. It carries no detail on
// purpose: which check failed must not be observable.
var ErrInvalid = errors.New("verification failed")

// Proof is what an operator produces and a maintainer verifies. It is
// sensitive as a whole: the public key alone yields the node id, so a Proof
// is only ever transported encrypted and never logged.
type Proof struct {
	NodeID    string `json:"node_id"`
	PubKey    string `json:"pubkey"`    // base64, 32 bytes
	Signature string `json:"signature"` // base64, 64 bytes
}

// Message is the fixed text an operator signs. The month stamp bounds how
// long a proof stays usable; Verify accepts the current and the previous
// month so a proof signed near month end does not expire in transit.
func Message(nodeID string, month time.Time) string {
	return "delist " + strings.ToLower(nodeID) + " from nodemap " + month.UTC().Format(monthLayout)
}

// NodeID derives the CometBFT node id from an ed25519 public key.
func NodeID(pub ed25519.PublicKey) string {
	sum := sha256.Sum256(pub)
	return hex.EncodeToString(sum[:idBytes])
}

// Verify checks that p proves control of p.NodeID as of now, accepting a
// message stamped with the current or the previous UTC month, and returns
// the node id in canonical lower-case hex. Every failure is ErrInvalid.
func Verify(p Proof, now time.Time) (string, error) {
	pub, err := base64.StdEncoding.DecodeString(p.PubKey)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return "", ErrInvalid
	}
	sig, err := base64.StdEncoding.DecodeString(p.Signature)
	if err != nil || len(sig) != ed25519.SignatureSize {
		return "", ErrInvalid
	}
	id := strings.ToLower(strings.TrimSpace(p.NodeID))
	if subtle.ConstantTimeCompare([]byte(id), []byte(NodeID(pub))) != 1 {
		return "", ErrInvalid
	}
	now = now.UTC()
	for _, month := range []time.Time{now, now.AddDate(0, -1, 0)} {
		if ed25519.Verify(pub, []byte(Message(id, month)), sig) {
			return id, nil
		}
	}
	return "", ErrInvalid
}
