package optout

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestPrintSampleProof is a test-only affordance for exercising the intake
// workflow end to end: when NODEMAP_SAMPLE_PROOF is set, it prints a valid
// proof for a throwaway key in the test output, to be copied from there.
// Nothing here is a signing tool for operators; the key never leaves the
// test process and nothing is written to disk.
//
//	NODEMAP_SAMPLE_PROOF=1 go test -run TestPrintSampleProof -v ./verify/internal/optout/
func TestPrintSampleProof(t *testing.T) {
	if os.Getenv("NODEMAP_SAMPLE_PROOF") == "" {
		t.Skip("set NODEMAP_SAMPLE_PROOF=1 to print a sample proof")
	}
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	id := NodeID(pub)
	proof, err := json.Marshal(Proof{
		NodeID:    id,
		PubKey:    base64.StdEncoding.EncodeToString(pub),
		Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(priv, []byte(Message(id, time.Now())))),
	})
	require.NoError(t, err)
	t.Logf("sample proof for node %s:\n%s", id, proof)
}
