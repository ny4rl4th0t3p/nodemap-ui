package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ny4rl4th0t3p/nodemap-ui/tools/verify/internal/optout"
)

var now = time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)

func TestVerifyPrintsTheNodeIDForAValidProof(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	id := optout.NodeID(pub)
	proof, err := json.Marshal(optout.Proof{
		NodeID:    strings.ToUpper(id),
		PubKey:    base64.StdEncoding.EncodeToString(pub),
		Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(priv, []byte(optout.Message(id, now)))),
	})
	require.NoError(t, err)

	got, ok := verify(strings.NewReader(string(proof)), now)
	require.True(t, ok)
	assert.Equal(t, id, got, "canonical lower-case id")

	_, ok = verify(strings.NewReader(string(proof)), now.AddDate(0, 1, 0))
	assert.True(t, ok, "still valid the month after")
	_, ok = verify(strings.NewReader(string(proof)), now.AddDate(0, 2, 0))
	assert.False(t, ok, "expired")
}

func TestVerifyRejectsEverythingElse(t *testing.T) {
	inputs := []string{
		"", "{", "[]", `{"node_id":"x"}`,
		`{"node_id":"aa","pubkey":"!!","signature":"!!"}`,
		strings.Repeat("{", maxInput+10),
	}
	for _, in := range inputs {
		id, ok := verify(strings.NewReader(in), now)
		assert.False(t, ok, "%q", in)
		assert.Empty(t, id)
	}
}
