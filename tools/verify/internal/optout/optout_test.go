package optout

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var now = time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC)

func freshKey(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	return pub, priv
}

// sign does what the README specifies an operator must produce: the node
// id from the public key, an ed25519 signature over the month's message,
// and the three values as base64 and hex.
func sign(pub ed25519.PublicKey, priv ed25519.PrivateKey, month time.Time) Proof {
	id := NodeID(pub)
	return Proof{
		NodeID:    id,
		PubKey:    base64.StdEncoding.EncodeToString(pub),
		Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(priv, []byte(Message(id, month)))),
	}
}

func TestNodeIDMatchesPinnedDerivation(t *testing.T) {
	pub, _ := freshKey(t)
	sum := sha256.Sum256(pub)
	want := hex.EncodeToString(sum[:20])
	id := NodeID(pub)
	assert.Equal(t, want, id)
	assert.Len(t, id, 40, "20 bytes as hex")
	assert.Equal(t, strings.ToLower(id), id)
}

func TestMessageFormat(t *testing.T) {
	assert.Equal(t, "delist abc123 from nodemap 2026-09", Message("ABC123", now))
	assert.Equal(t, "delist abc123 from nodemap 2026-08", Message("abc123", now.AddDate(0, -1, 0)))
	// The month is taken in UTC regardless of the caller's zone.
	late := time.Date(2026, 9, 30, 23, 30, 0, 0, time.FixedZone("west", -3*3600))
	assert.Equal(t, "delist x from nodemap 2026-10", Message("x", late))
}

func TestVerifyRoundTrip(t *testing.T) {
	pub, priv := freshKey(t)
	p := sign(pub, priv, now)
	id, err := Verify(p, now)
	require.NoError(t, err)
	assert.Equal(t, NodeID(pub), id)

	// The proof is a plain JSON object with exactly three string fields.
	raw, err := json.Marshal(p)
	require.NoError(t, err)
	var generic map[string]string
	require.NoError(t, json.Unmarshal(raw, &generic))
	assert.Len(t, generic, 3)
	for _, k := range []string{"node_id", "pubkey", "signature"} {
		assert.Contains(t, generic, k)
	}
}

func TestVerifyAcceptsPreviousMonthOnly(t *testing.T) {
	pub, priv := freshKey(t)
	p := sign(pub, priv, now)
	_, err := Verify(p, now.AddDate(0, 1, 0))
	assert.NoError(t, err, "a proof from last month is still good")
	_, err = Verify(p, now.AddDate(0, 2, 0))
	assert.ErrorIs(t, err, ErrInvalid, "two months old is expired")
	_, err = Verify(p, now.AddDate(0, -1, 0))
	assert.ErrorIs(t, err, ErrInvalid, "a proof from the future is not accepted")
}

func TestVerifyAcceptsUpperCaseNodeID(t *testing.T) {
	pub, priv := freshKey(t)
	p := sign(pub, priv, now)
	p.NodeID = strings.ToUpper(p.NodeID)
	id, err := Verify(p, now)
	require.NoError(t, err)
	assert.Equal(t, strings.ToLower(p.NodeID), id, "canonical lower-case hex comes back")
}

func TestVerifyRejectsEverythingElseWithOneError(t *testing.T) {
	pubA, privA := freshKey(t)
	pubB, privB := freshKey(t)
	good := sign(pubA, privA, now)
	other := sign(pubB, privB, now)

	flip := func(b64 string, i int) string {
		raw, err := base64.StdEncoding.DecodeString(b64)
		require.NoError(t, err)
		raw[i] ^= 0x01
		return base64.StdEncoding.EncodeToString(raw)
	}
	cases := map[string]Proof{
		"empty":                    {},
		"tampered signature":       {NodeID: good.NodeID, PubKey: good.PubKey, Signature: flip(good.Signature, 3)},
		"tampered pubkey":          {NodeID: good.NodeID, PubKey: flip(good.PubKey, 0), Signature: good.Signature},
		"node id of another key":   {NodeID: other.NodeID, PubKey: good.PubKey, Signature: good.Signature},
		"signature of another key": {NodeID: good.NodeID, PubKey: good.PubKey, Signature: other.Signature},
		"pubkey not base64":        {NodeID: good.NodeID, PubKey: "!!", Signature: good.Signature},
		"signature not base64":     {NodeID: good.NodeID, PubKey: good.PubKey, Signature: "!!"},
		"short pubkey":             {NodeID: good.NodeID, PubKey: base64.StdEncoding.EncodeToString(pubA[:31]), Signature: good.Signature},
		"short signature":          {NodeID: good.NodeID, PubKey: good.PubKey, Signature: base64.StdEncoding.EncodeToString([]byte("x"))},
		"wrong node id":            {NodeID: "00", PubKey: good.PubKey, Signature: good.Signature},
		"wrong message":            {NodeID: good.NodeID, PubKey: good.PubKey, Signature: signedText(privA, "delist me")},
	}
	for name, p := range cases {
		t.Run(name, func(t *testing.T) {
			id, err := Verify(p, now)
			assert.ErrorIs(t, err, ErrInvalid)
			assert.Equal(t, ErrInvalid.Error(), err.Error(), "the error carries no detail")
			assert.Empty(t, id)
		})
	}
}

func signedText(priv ed25519.PrivateKey, text string) string {
	return base64.StdEncoding.EncodeToString(ed25519.Sign(priv, []byte(text)))
}
