// Command verify is this instance's delisting check: a decrypted proof
// arrives on stdin, and if it proves control of the node it names, the node
// id leaves on stdout in canonical form, ready for the crawler's -hash.
//
// Every failure, including a panic while decoding, is the same constant
// message on stderr and exit status 1. Nothing from the input is echoed:
// the proof identifies a node, and which check failed is not for a log.
//
// The instance owns this policy. Replacing it with another kind of proof
// changes this program and nothing in the crawler.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/ny4rl4th0t3p/nodemap-ui/tools/verify/internal/optout"
)

// maxInput bounds what is read from stdin; a proof is a few hundred bytes.
const maxInput = 64 << 10

const failed = "verification failed"

func main() {
	id, ok := verify(os.Stdin, time.Now())
	if !ok {
		fmt.Fprintln(os.Stderr, failed)
		os.Exit(1)
	}
	fmt.Println(id)
}

// verify reads one proof and returns the node id it proves, or false.
func verify(in io.Reader, now time.Time) (id string, ok bool) {
	defer func() {
		if r := recover(); r != nil {
			id, ok = "", false
		}
	}()
	raw, err := io.ReadAll(io.LimitReader(in, maxInput))
	if err != nil {
		return "", false
	}
	var proof optout.Proof
	if err := json.Unmarshal(raw, &proof); err != nil {
		return "", false
	}
	id, err = optout.Verify(proof, now)
	if err != nil {
		return "", false
	}
	return id, true
}
